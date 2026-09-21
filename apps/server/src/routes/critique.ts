import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  runCritiqueInputSchema,
  runRepairInputSchema,
  fullCritiqueReportSchema,
  REPAIR_BRANCH_PREFIX,
  REPAIR_MAX_ITERATIONS,
  ALL_CRITIC_TYPES,
  issueIdFor,
  type CritiqueReport,
  type CritiqueReportStatus,
  type FullCritiqueReport,
} from "@book-forge/shared";
import {
  runCritique,
  reviseChapter,
  type CriticInput,
} from "@book-forge/agents";
import { countWords, prosePlainTextToProseMirror } from "../utils/prosemirror.js";
import { loadChapterProseContext } from "../utils/chapter-prose-context.js";
import { requiredOverflowMessage } from "../utils/context-compiler.js";
import {
  locateProtectedFragments,
  survivingFragments,
} from "../utils/protected-fragments.js";
import { recordContextManifest, compareWithWriterBase } from "../utils/context-manifests.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import {
  createProposal,
  finishProposal,
  loadProposal,
} from "../utils/prose-proposals.js";
import type { ProposalCancelRegistry } from "../utils/proposal-cancel.js";
import { judgeProseCompletion } from "@book-forge/shared";
import { isConfirmedCompletion } from "@book-forge/llm";
import { loadStyleContext } from "../utils/style-context.js";
import { measureStructuralTells, renderStructuralTells } from "@book-forge/style-engine";
import { logUsage } from "../utils/usageLogger.js";
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../utils/studio-context.js";
import type {
  ChapterRow,
  ChapterVersionRow,
  BookRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";

interface CritiqueReportRow {
  id: number;
  chapter_version_id: number;
  status: string;
  report_json: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function toReport(row: CritiqueReportRow): CritiqueReport {
  let report: FullCritiqueReport | null = null;
  if (row.report_json) {
    try {
      report = fullCritiqueReportSchema.parse(JSON.parse(row.report_json));
    } catch {
      // tolerate malformed legacy rows by surfacing null + error_message
    }
  }
  return {
    id: row.id,
    chapterVersionId: row.chapter_version_id,
    status: row.status as CritiqueReportStatus,
    report,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function countRepairAncestors(
  sqlite: DatabaseType,
  versionId: number,
): number {
  let count = 0;
  let cursor: number | null = versionId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const row = sqlite
      .prepare(
        "SELECT parent_version_id, branch_label FROM chapter_versions WHERE id = ?",
      )
      .get(cursor) as
      | { parent_version_id: number | null; branch_label: string | null }
      | undefined;
    if (!row) break;
    if (row.branch_label && row.branch_label.startsWith(REPAIR_BRANCH_PREFIX)) {
      count++;
    }
    cursor = row.parent_version_id;
  }
  return count;
}


export function createCritiqueRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
  cancels: ProposalCancelRegistry,
  memoryWorker?: Pick<MemoryWorker, "kick">,
): Hono {
  const r = new Hono();

  r.get("/chapter-versions/:id/critique", (c) => {
    const id = Number(c.req.param("id"));
    const v = sqlite
      .prepare("SELECT id FROM chapter_versions WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!v) return notFound(c, "chapter_version");
    const row = sqlite
      .prepare(
        `SELECT * FROM critique_reports
         WHERE chapter_version_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id) as CritiqueReportRow | undefined;
    return c.json(row ? toReport(row) : null);
  });

  r.post("/chapter-versions/:id/critique", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = runCritiqueInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const version = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(id) as ChapterVersionRow | undefined;
    if (!version) return notFound(c, "chapter_version");
    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(version.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    // Та же история, что у Writer (AC-36): одна сборка, один бюджет.
    const {
      pov, emotionalGoal, beatSheet, bookContext, characterContext, loreContext,
      previousChaptersSummary: prevSummary, previousChapterTail, sceneState, retrievedContext, compiled, assembled,
      chapterContract,
    } = await loadChapterProseContext(sqlite, book, ch, version.content_text, { hasVec });
    if (compiled.requiredOverflow) {
      return badRequest(c, requiredOverflowMessage(compiled));
    }
    // Отпечаток базы критики против отпечатка, с которым версия писалась
    // (AC-13). Расхождение — сигнал автору в отчёте, не блокировка.
    const critiqueManifest = recordContextManifest(sqlite, {
      bookId: book.id,
      chapterId: ch.id,
      chapterVersionId: version.id,
      purpose: "critique",
      assembled,
    });
    const baseChanged = compareWithWriterBase(sqlite, version.id, critiqueManifest.fingerprint);

    // Style critic judges the chapter against the book's target style, not a
    // generic prose bar. Few-shot samples are excluded (0) — the critic needs
    // the fingerprint, and verbatim samples would invite copy-matching.
    const criticStyleContext = loadStyleContext(
      sqlite,
      book.style_profile_id,
      0,
    ).prompt;

    // Structural LLM tells are counted, not judged: the style critic gets the
    // per-1000-word counts with quotes as evidence (docs/prose-tells-baseline.md).
    const structuralTellsContext = renderStructuralTells(
      measureStructuralTells(version.content_text),
    );

    const criticInput: CriticInput = {
      chapterText: version.content_text,
      chapterTitle: ch.title,
      pov,
      emotionalGoal,
      beatSheet,
      bookContext,
      previousChaptersSummary: prevSummary,
      previousChapterTail,
      sceneState,
      retrievedContext,
      chapterContract,
      characterContext,
      loreContext,
      styleContext: criticStyleContext,
      structuralTellsContext,
      config: { variants: 1, model: book.critic_model as "sonnet" | "opus" },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: `critic.${usage.critic}`,
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: book.id,
          chapterId: ch.id,
          versionId: version.id,
        }),
    };

    // Insert pending row
    const now = new Date().toISOString();
    const insertInfo = sqlite
      .prepare(
        `INSERT INTO critique_reports (chapter_version_id, status, created_at)
         VALUES (?, 'pending', ?)`,
      )
      .run(id, now);
    const reportRowId = Number(insertInfo.lastInsertRowid);

    try {
      // Критик персонажей сравнивает героев между собой: на сцене с одним
      // названным участником сравнивать не с кем, и вызов тратится впустую.
      // Состав берётся из той же сборки контекста, что и карточки, — второй
      // поиск участников разошёлся бы с ней молча.
      const requested = parsed.data.critics ?? [...ALL_CRITIC_TYPES];
      const soloScene = assembled.participants.length < 2;
      const enabledCritics = soloScene
        ? requested.filter((c) => c !== "character")
        : requested;
      // Пропуск — третье состояние: не успех и не ошибка. Без него панель
      // рисовала бы непроверенное проверенным.
      const skippedCritics = requested.filter((c) => !enabledCritics.includes(c));
      const result = await runCritique({
        input: criticInput,
        enabledCritics,
        skippedCritics,
      });
      const completedAt = new Date().toISOString();
      const errorMessage =
        result.errors.length > 0
          ? result.errors
              .map((e) => `[${e.critic}] ${e.message}`)
              .join(" | ")
          : // Никто не упал, но и не запускался никто: набор целиком отсеян
            // условием сцены. Без этой строки отчёт молчал бы о том, что
            // проверки не было вовсе.
            result.report.critics.length === 0 && skippedCritics.length > 0
            ? `не запускались: ${skippedCritics.join(", ")}`
            : null;
      // Статус — от того, кого просили и кто выжил, а не от длины списка
      // успешных: прежняя формула на четырёх падениях из четырёх давала done.
      const status: CritiqueReportStatus =
        result.report.critics.length === 0
          ? "error"
          : result.report.failedCritics.length > 0
            ? "partial"
            : "done";
      sqlite
        .prepare(
          `UPDATE critique_reports
           SET status = ?, report_json = ?, error_message = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(
          status,
          JSON.stringify({
            ...result.report,
            contextFingerprint: critiqueManifest.fingerprint,
            baseChanged,
          }),
          errorMessage,
          completedAt,
          reportRowId,
        );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sqlite
        .prepare(
          `UPDATE critique_reports
           SET status = 'error', error_message = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(message, new Date().toISOString(), reportRowId);
    }

    const final = sqlite
      .prepare("SELECT * FROM critique_reports WHERE id = ?")
      .get(reportRowId) as CritiqueReportRow;
    return c.json(toReport(final));
  });

  // ─────────── Repair (SSE stream) ───────────

  r.post("/chapter-versions/:id/repair", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = runRepairInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const version = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(id) as
      | ChapterVersionRow
      | undefined;
    if (!version) return notFound(c, "chapter_version");
    const v = version;

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(v.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    // Iteration cap
    const iterationDone = countRepairAncestors(sqlite, v.id);
    if (iterationDone >= REPAIR_MAX_ITERATIONS) {
      return badRequest(
        c,
        `repair iteration cap reached (${REPAIR_MAX_ITERATIONS}). Этой ветке уже сделано ${iterationDone} repair-итераций.`,
      );
    }
    const nextIteration = iterationDone + 1;

    // Latest critique report
    const reportRow = sqlite
      .prepare(
        `SELECT * FROM critique_reports
         WHERE chapter_version_id = ? AND report_json IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(v.id) as CritiqueReportRow | undefined;
    if (!reportRow || !reportRow.report_json) {
      return badRequest(c, "no critique report exists for this version");
    }
    const report = fullCritiqueReportSchema.parse(JSON.parse(reportRow.report_json));

    // Выбор автора проверяется ДО вызова модели. Ссылка на замечание, которого
    // в отчёте нет, — отказ, а не тихое игнорирование: иначе автор ждёт
    // правку выбранного и получает правку пустого списка.
    const selectedIssueIds = parsed.data.selectedIssueIds;
    if (selectedIssueIds) {
      const known = new Set<string>();
      for (const critic of report.critics) {
        critic.issues.forEach((_, index) => known.add(issueIdFor(critic.critic, index)));
      }
      const unknown = selectedIssueIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return badRequest(
          c,
          `в отчёте нет таких замечаний: ${unknown.join(", ")}. Перечитайте критику — отчёт мог смениться.`,
        );
      }
    }

    // Защищённые фрагменты привязываются к тексту ЭТОЙ версии. Правило то же,
    // что у доказательства события: привязка либо однозначна, либо её нет.
    let protectedFragments: string[] = [];
    if (parsed.data.protectedFragments) {
      const located = locateProtectedFragments(
        v.content_text,
        parsed.data.protectedFragments,
      );
      if (located.rejected.length > 0) {
        const lines = located.rejected.map((r) =>
          r.reason === "ambiguous"
            ? `«${r.fragment}» встречается в главе дважды — привязка неоднозначна, возьмите кусок подлиннее`
            : `«${r.fragment}» в главе не найден`,
        );
        return badRequest(c, `Защитить не удалось: ${lines.join("; ")}`);
      }
      protectedFragments = located.accepted;
    }

    // Same context the critics saw — one assembly, so a field added for them
    // cannot silently miss the Reviser.
    const {
      pov, emotionalGoal, beatSheet, bookContext, characterContext, loreContext,
      previousChaptersSummary: prevSummary, previousChapterTail, sceneState, retrievedContext,
      architectureContext, compiled, assembled, chapterContract,
    } = await loadChapterProseContext(sqlite, book, ch, v.content_text, { hasVec });
    if (compiled.requiredOverflow) {
      return badRequest(c, requiredOverflowMessage(compiled));
    }
    const repairManifest = recordContextManifest(sqlite, {
      bookId: book.id,
      chapterId: ch.id,
      chapterVersionId: v.id,
      purpose: "repair",
      assembled,
    });
    const repairBaseChanged = compareWithWriterBase(sqlite, v.id, repairManifest.fingerprint);

    return streamSSE(c, async (stream) => {
      let fullText = "";
      let modelId = "";
      let stopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let finalized = false;
      const proposalId = createProposal(sqlite, {
        bookId: ch.book_id,
        chapterId: ch.id,
        kind: "repair",
        baseVersionId: v.id,
      });
      cancels.begin(proposalId);
      const signal = cancels.signal(proposalId);
      // В9: то же, что у Писателя — молчащее соединение рвут по дороге.
      let pending: Promise<void> = Promise.resolve();
      const keepalive = setInterval(() => {
        pending = pending
          .then(() => stream.writeSSE({ event: "ping", data: JSON.stringify({ at: Date.now() }) }))
          .catch(() => {});
      }, 20_000);
      try {
        await stream.writeSSE({
          event: "iteration",
          data: JSON.stringify({
            current: nextIteration,
            max: REPAIR_MAX_ITERATIONS,
          }),
        });
        await stream.writeSSE({
          event: "proposal",
          data: JSON.stringify({
            proposalId,
            baseVersionId: v.id,
            // База уехала с момента написания: замечания могли устареть.
            contextBaseChanged: repairBaseChanged,
          }),
        });

        const styleCtx = loadStyleContext(sqlite, book.style_profile_id);
        const gen = reviseChapter({
          bookContext,
          chapterTitle: ch.title,
          pov,
          emotionalGoal,
          beatSheet,
          architectureContext,
          chapterContract,
          characterContext,
          loreContext,
          styleContext: styleCtx.prompt,
          fatigueWords: styleCtx.fatigueBlacklist,
          previousChaptersSummary: prevSummary,
          previousChapterTail,
          sceneState,
          retrievedContext,
          originalText: v.content_text,
          critics: report.critics,
          severityFilter: parsed.data.severities,
          ...(selectedIssueIds ? { selectedIssueIds } : {}),
          ...(protectedFragments.length > 0 ? { protectedFragments } : {}),
          iteration: nextIteration,
          config: { variants: 1, model: book.writer_model as "sonnet" | "opus" },
          ...(signal !== undefined ? { signal } : {}),
        });

        while (true) {
          const next = await gen.next();
          if (next.done) {
            fullText = next.value.text;
            modelId = next.value.modelId;
            stopReason = next.value.stopReason;
            inputTokens = next.value.tokens.input;
            outputTokens = next.value.tokens.output;
            cacheCreationTokens = next.value.tokens.cacheCreation;
            cacheReadTokens = next.value.tokens.cacheRead;
            break;
          }
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ text: next.value }),
          });
        }

        // Второй рубеж: бэкенд подписки прервать нечем, и поздний ответ
        // приходит уже после отмены. Он не имеет права ничего записать.
        if (cancels.shouldStop(proposalId)) {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({
              proposal: loadProposal(sqlite, proposalId),
              cancelled: true,
            }),
          });
          return;
        }

        // Кандидат, не версия: ветка repair-N и коммит в чаптер появятся при
        // принятии — до тех пор ни версии, ни памяти, ни удаления черновика.
        // С5: бэкенд подписки причину остановки не сообщает вовсе, и
        // «не подтверждено» горело на КАЖДОЙ главе — предупреждение,
        // которое всегда горит, перестают читать. Когда причины нет,
        // судим по хвосту текста; `completion` остаётся честным.
        const verdict = judgeProseCompletion(stopReason, fullText);
        const confirmed = isConfirmedCompletion(stopReason);
        finishProposal(sqlite, proposalId, {
          status: verdict.looksComplete ? "ready" : "incomplete",
          contentText: fullText,
          contentJson: JSON.stringify(prosePlainTextToProseMirror(fullText)),
          wordCount: countWords(fullText),
          completion: confirmed ? "confirmed" : "unconfirmed",
          stopReason,
          modelId,
          // Настоящий бэкенд, а не константа: правка идёт тем же
          // маршрутизатором, что и всё остальное, и «anthropic» на
          // подписочном прогоне было неправдой в журнале (С5).
          backend: modelId.startsWith("subscription:") ? "subscription" : "anthropic",
        });
        finalized = true;

        logUsage(sqlite, {
          route: "reviser.repair",
          model: modelId,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
        });

        // Что из защищённого дожило. Потеря не отвергает кандидата — решать
        // автору, он видит текст целиком, — но молчать о ней нельзя: он
        // просил не трогать именно эти строки.
        const survived =
          protectedFragments.length > 0
            ? survivingFragments(fullText, protectedFragments)
            : null;
        if (survived && survived.lost.length > 0) {
          console.warn(
            `[repair] v${v.id}: правка тронула защищённые фрагменты (${survived.lost.length}): ${survived.lost.map((f) => `«${f.slice(0, 60)}»`).join("; ")}`,
          );
        }

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            proposal: loadProposal(sqlite, proposalId),
            iteration: nextIteration,
            ...(survived ? { protectedLost: survived.lost } : {}),
            tokens: {
              input: inputTokens,
              output: outputTokens,
              cacheCreation: cacheCreationTokens,
              cacheRead: cacheReadTokens,
            },
          }),
        });
      } catch (e) {
        if (cancels.shouldStop(proposalId)) {
          // Это не сбой, это наша же отмена: SDK бросает при аборте сигнала.
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({
              proposal: loadProposal(sqlite, proposalId),
              cancelled: true,
            }),
          });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        // Уже дописанный кандидат не понижаем: если logUsage или финальная
        // отправка упали ПОСЛЕ finishProposal, строка уже несёт готовый текст
        // и правильный статус — перезаписывать его в failed значило бы
        // потерять принимаемый прогон только из-за сбоя после генерации.
        if (!finalized) {
          finishProposal(sqlite, proposalId, {
            status: "failed",
            errorMessage: message,
            stopReason,
          });
        }
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message }),
        });
      } finally {
        clearInterval(keepalive);
        await pending;
        cancels.end(proposalId);
      }
    });
  });

  r.delete("/chapter-versions/:id/critique", (c) => {
    const id = Number(c.req.param("id"));
    const info = sqlite
      .prepare("DELETE FROM critique_reports WHERE chapter_version_id = ?")
      .run(id);
    if (info.changes === 0) return notFound(c, "critique_report");
    return c.body(null, 204);
  });

  return r;
}
