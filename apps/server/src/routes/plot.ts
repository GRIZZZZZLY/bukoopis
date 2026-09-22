import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  generateBookOutlineInputSchema,
  selectBookOutlineInputSchema,
  bookOutlineSchema,
  mergeOutlineVariants,
  generateChapterPlanInputSchema,
  selectChapterPlanInputSchema,
  writeChapterInputSchema,
  type BookOutline,
  type ChapterPlan,
  boundaryForChapter,
  renderChapterContract,
  docToBlocks,
} from "@book-forge/shared";
import {
  runBookPlanning,
  runChapterPlan,
  runChapterWriter,
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
} from "@book-forge/agents";
import { loadStyleContext } from "../utils/style-context.js";
import {
  derivePremiseFromConcept,
  loadStudioContext,
  studioContextToPrompt,
} from "../utils/studio-context.js";
import { gatherRetrievedChunks } from "../utils/chapter-retrieval.js";
import {
  loadPreviousChapterTailWithOrder,
  loadRollingChapterContext,
} from "../utils/rolling-context.js";
import { requiredOverflowMessage } from "../utils/context-compiler.js";
import { assembleGenerationContext } from "../utils/generation-context.js";
import { recordContextManifest } from "../utils/context-manifests.js";
import { renderActiveFactsPrompt } from "../utils/book-facts.js";
import { loadStoredSceneIntent, prepareSceneIntent } from "../utils/scene-intent.js";
import { makeCharacterBoundaryReaders } from "../utils/character-events.js";
import { resolveEntity } from "../utils/entity-resolve.js";
import {
  gatherRelevantNotes,
  renderOpenNotesPrompt,
} from "../utils/book-notes.js";
import { logUsage } from "../utils/usageLogger.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import {
  toBook,
  toChapter,
  type BookRow,
  type ChapterRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { approvePlan, PlanApproveError } from "../utils/plan-approve.js";
import { countWords, prosePlainTextToProseMirror } from "../utils/prosemirror.js";
import {
  appendProposalProgress,
  createProposal,
  touchProposal,
  finishProposal,
  loadProposal,
} from "../utils/prose-proposals.js";
import type { ProposalCancelRegistry } from "../utils/proposal-cancel.js";
import { judgeProseCompletion } from "@book-forge/shared";
import { isConfirmedCompletion } from "@book-forge/llm";

export { loadBookContext, type BookContext } from "../utils/book-context.js";
import { loadBookContext } from "../utils/book-context.js";

// Phase 2: previous-chapters context moved to ../utils/rolling-context.ts
// (loadRollingChapterContext — bounded rolling window + meta-summary).


export function createPlotRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
  cancels: ProposalCancelRegistry,
  memoryWorker?: Pick<MemoryWorker, "kick">,
): Hono {
  const r = new Hono();

  // ───────── Book outline ─────────

  r.post("/books/:id/outline", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateBookOutlineInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ctx = loadBookContext(sqlite, id);
    if (!ctx) return notFound(c, "book");
    if (!ctx.premise || ctx.premise === "(премиса не задана)") {
      return badRequest(c, "premise required to generate outline");
    }

    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, id));
    const variants = await runBookPlanning({
      bookTitle: ctx.title,
      premise: ctx.premise,
      language: ctx.language,
      ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
      config: { variants: 2, ...parsed.data.config, model: parsed.data.config?.model ?? ctx.plotModel },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: "plot.book_outline",
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: id,
        }),
    });

    // Новая партия дописывается, а не заменяет прежнюю: заменой уходили и
    // выбор автора, и оглавления из его материалов (F04 ревью 2026-09-22).
    // Перечитываем перед записью — генерация шла минутами.
    const now = new Date().toISOString();
    const stored = sqlite
      .prepare("SELECT outline_json FROM books WHERE id = ?")
      .get(id) as { outline_json: string | null } | undefined;
    let current: BookOutline | null = null;
    if (stored?.outline_json) {
      const prev = bookOutlineSchema.safeParse(JSON.parse(stored.outline_json));
      if (prev.success) current = prev.data;
    }
    const { outline } = mergeOutlineVariants(current, variants, now);
    sqlite
      .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(outline), now, id);
    return c.json(outline);
  });

  r.post("/books/:id/outline/select", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = selectBookOutlineInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const row = sqlite
      .prepare("SELECT outline_json FROM books WHERE id = ?")
      .get(id) as { outline_json: string | null } | undefined;
    if (!row) return notFound(c, "book");
    if (!row.outline_json) return badRequest(c, "no outline generated yet");
    const outline = JSON.parse(row.outline_json) as BookOutline;
    if (!outline.variants[parsed.data.selectedIndex]) {
      return badRequest(c, "selectedIndex out of range");
    }
    outline.selectedIndex = parsed.data.selectedIndex;
    const now = new Date().toISOString();
    sqlite
      .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(outline), now, id);
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow;
    return c.json(toBook(book));
  });

  // Единственное место, где план становится главами. Раньше главы заводились
  // печатанием названия в форме, а намерение жило только побочным эффектом
  // генерации поглавного плана.
  r.post("/books/:id/plan/approve", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    try {
      const result = approvePlan(sqlite, id);
      const chapters = sqlite
        .prepare(
          "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
        )
        .all(id) as ChapterRow[];
      return c.json({ ...result, chapters: chapters.map(toChapter) });
    } catch (e) {
      if (e instanceof PlanApproveError) {
        return c.json(
          { error: "plan_not_approvable", details: { reason: e.reason, message: e.message } },
          400,
        );
      }
      throw e;
    }
  });

  // ───────── Chapter plan ─────────

  r.post("/chapters/:id/plan", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateChapterPlanInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const ctx = loadBookContext(sqlite, ch.book_id);
    if (!ctx) return notFound(c, "book");

    const prevSummary = loadRollingChapterContext(
      sqlite,
      ch.book_id,
      ch.order_index,
    );

    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, ch.book_id));
    const planRetrieved = await gatherRetrievedChunks(sqlite, {
      bookId: ch.book_id,
      queryText: `${ch.title}\n${parsed.data.intent}`,
      currentChapterOrder: ch.order_index,
      hasVec,
      // Планировщик получает только пересказы (окно), дословного текста у него
      // нет — значит, и повторять нечего: ищем по всем предыдущим главам.
      verbatimChapterOrders: [],
    });
    // Граница планировщика — строго ДО главы (В7): у неё может быть принятая
    // версия, и её заметки с фактами описывают текст, который план как раз
    // и переписывает.
    const planBoundary = Math.max(0, ch.order_index - 1);
    const planNotes = await gatherRelevantNotes(
      sqlite,
      ch.book_id,
      `${ch.title}\n${parsed.data.intent}`,
      planBoundary,
    );
    const planOpenThreads = renderOpenNotesPrompt(
      planNotes,
      "Открытые линии",
      planBoundary,
    );
    // Слайс 4.5: планировщик впервые видит действующий канон — иначе он может
    // назвать отменяемый факт только словами, без ссылки, и критику нечего
    // сопоставить. Граница та же, что у Writer: факты по состоянию ДО этой
    // главы — и это `order_index - 1`, а не сам `order_index`, который
    // включал бы факты уже принятой её версии (В7).
    const planActiveFacts = renderActiveFactsPrompt(
      sqlite,
      ch.book_id,
      planBoundary,
      { withIds: true },
    );
    const variants = await runChapterPlan({
      bookTitle: ctx.title,
      bookPremise: ctx.premise,
      bookOutline: ctx.outlineSelected,
      chapterTitle: ch.title,
      intent: parsed.data.intent,
      previousChaptersSummary: prevSummary,
      ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
      ...(planRetrieved.promptBlock !== null
        ? { retrievedContext: planRetrieved.promptBlock }
        : {}),
      ...(planOpenThreads !== null ? { openThreads: planOpenThreads } : {}),
      ...(planActiveFacts !== null ? { activeFacts: planActiveFacts } : {}),
      config: { variants: 2, ...parsed.data.config, model: parsed.data.config?.model ?? ctx.plotModel },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: "plot.chapter_plan",
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
        }),
    });

    const plan: ChapterPlan = {
      variants,
      selectedIndex: null,
      generatedAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE chapters SET plan_json = ?, intent = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(plan), parsed.data.intent, now, id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, ch.book_id);
    return c.json(plan);
  });

  r.post("/chapters/:id/plan/select", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = selectChapterPlanInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!row) return notFound(c, "chapter");
    if (!row.plan_json) return badRequest(c, "no plan generated yet");
    const plan = JSON.parse(row.plan_json) as ChapterPlan;
    if (!plan.variants[parsed.data.selectedIndex]) {
      return badRequest(c, "selectedIndex out of range");
    }
    plan.selectedIndex = parsed.data.selectedIndex;
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE chapters SET plan_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(plan), now, id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, row.book_id);
    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow;
    return c.json(toChapter(ch));
  });

  // ───────── Writer (SSE streaming) ─────────

  r.post("/chapters/:id/write", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = writeChapterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    if (!ch.plan_json) return badRequest(c, "no plan available");
    const plan = JSON.parse(ch.plan_json) as ChapterPlan;
    if (plan.selectedIndex === null) {
      return badRequest(c, "no plan variant selected");
    }
    const beatSheet = plan.variants[plan.selectedIndex];
    if (!beatSheet) return badRequest(c, "selected plan variant missing");

    const mode = parsed.data.mode;
    const fromBeat = parsed.data.fromBeat ?? 0;
    if (mode === "beats" && fromBeat >= beatSheet.beats.length) {
      return badRequest(c, `fromBeat ${fromBeat} за пределами плана (${beatSheet.beats.length} беатов)`);
    }
    // Дописать с беата: префикс — текст принятой версии, автор его уже принял.
    let prefixText = "";
    if (mode === "beats" && fromBeat > 0) {
      if (ch.current_version_id === null) {
        return badRequest(c, "дописать с беата можно только поверх принятой версии главы");
      }
      const v = sqlite
        .prepare("SELECT content_text, content_json FROM chapter_versions WHERE id = ?")
        .get(ch.current_version_id) as
        | { content_text: string; content_json: string }
        | undefined;
      // Абзацы берём из документа, а не из `content_text`: тот склеен
      // `extractText` в одну строку с пробелами, и дописанная глава начиналась
      // бы одним абзацем на всё принятое. Потолок здесь всё равно есть:
      // `docToBlocks` берёт ТЕКСТ любого верхнеуровневого узла, так что
      // заголовок, цитата и пункт списка возвращаются обычными абзацами, а
      // начертания теряются. Проза дописывается плоским текстом, и принятие
      // дописанного кандидата это форматирование в главе уносит — цена
      // режима «дописать с беата», а не дефект этого места. Битый JSON — не
      // повод срывать запуск, тогда склеенный текст лучше пустого.
      try {
        prefixText = v
          ? docToBlocks(JSON.parse(v.content_json))
              .filter((b) => b.trim().length > 0)
              .join("\n\n")
          : "";
      } catch {
        prefixText = v?.content_text ?? "";
      }
    }

    const ctx = loadBookContext(sqlite, ch.book_id);
    if (!ctx) return notFound(c, "book");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow;

    // Одна сборка на все роли (этап 4): история, участники на границе сцены,
    // лор, факты, студия, стиль, бюджет — и ссылки на источники для
    // отпечатка. Writer сканирует план и беат-лист, ищет по беат-листу.
    const beatBlob = beatSheet.beats
      .map((b) => `${b.summary} ${b.goal} ${b.conflict} ${b.outcome}`)
      .join("\n");
    const assembled = await assembleGenerationContext(sqlite, {
      book,
      chapter: ch,
      hasVec,
      scanTexts: [beatSheet.emotionalGoal, beatBlob],
      retrievalQuery: beatBlob,
      povName: beatSheet.pov,
      // В7: у главы может быть принятая версия, и её факты — утверждения
      // текста, который автор сейчас переписывает. Канон для Писателя
      // кончается ДО неё.
      factsBoundary: "before_chapter",
      // Регистр сцены из плана — по нему отбираются образцы речи (С3).
      ...(beatSheet.dialogueRegister
        ? { dialogueRegister: beatSheet.dialogueRegister }
        : {}),
      label: `writer ch#${ch.order_index}`,
    });
    if (assembled.compiled.requiredOverflow) {
      // Отказ до первого токена и до создания кандидата. Генерировать с
      // урезанным обязательным слоем значило бы выдать текст, нарушающий
      // ограничения, о которых модели не сказали, — и ничем это не пометить.
      return badRequest(c, requiredOverflowMessage(assembled.compiled));
    }
    // Беат-лист может звать POV псевдонимом, а карточка идёт под каноническим
    // именем. «POV: Ваня» и «### Иван» — для модели два человека, и знания
    // Ивана к Ване не относятся. Показываем каноническое, когда оно есть.
    const beatSheetForWriter =
      assembled.povCharacterId !== null ? { ...beatSheet, pov: assembled.pov } : beatSheet;
    // Манифест источников (этап 4): принятие кандидата привяжет его к
    // созданной версии, и критика сверит с ним свой отпечаток.
    const contextManifest = recordContextManifest(sqlite, {
      bookId: ch.book_id,
      chapterId: ch.id,
      chapterVersionId: null,
      purpose: "writer",
      assembled,
    });

    return streamSSE(c, async (stream) => {
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let modelId = "";
      let stopReason: string | null = null;
      let finalized = false;
      let held = false;
      // Объявлены здесь, а не в цикле: `catch` обязан знать, сколько беатов
      // уже легло в кандидата — от этого зависит, можно ли его принять.
      let beatsDone: number | null = null;
      const beatsTotal = mode === "beats" ? beatSheet.beats.length : null;

      // Кандидат заводится до первого токена: он же — то, что отменяют, и то,
      // что остаётся в базе, если процесс умрёт на середине.
      const proposalId = createProposal(sqlite, {
        bookId: ch.book_id,
        chapterId: ch.id,
        kind: "write",
        baseVersionId: ch.current_version_id,
        contextManifestId: contextManifest.id,
      });
      cancels.begin(proposalId);
      const signal = cancels.signal(proposalId);

      // В9: до первого токена подписочный бэкенд молчит минутами, а молчащее
      // соединение вправе закрыть кто угодно по дороге. Признак жизни раз в
      // 20 секунд — как у приёма материала; клиент неизвестные события
      // пропускает. Сами `ping` идут цепочкой друг за другом; с кадрами
      // тела они не пересекаются потому, что запись в поток уже
      // последовательна, а не потому, что цепочка общая.
      let pending: Promise<void> = Promise.resolve();
      const keepalive = setInterval(() => {
        // Пульс кандидата — отдельно от записи в поток: закрытая вкладка
        // обрывает SSE, но генерация идёт и должна считаться живой (F14).
        touchProposal(sqlite, proposalId);
        pending = pending
          .then(() => stream.writeSSE({ event: "ping", data: JSON.stringify({ at: Date.now() }) }))
          .catch(() => {});
      }, 20_000);

      try {
        await stream.writeSSE({
          event: "proposal",
          data: JSON.stringify({
            proposalId,
            baseVersionId: ch.current_version_id,
          }),
        });

        // Замысел сцены (этап 5). Внутри потока, а не до него: это вызов
        // модели на минуты, и снаружи автор смотрел бы в тишину, пока
        // соединение даже не открылось. Падение сюда не долетает —
        // `prepareSceneIntent` возвращает деградацию, а не бросает.
        //
        // «Дописать с беата» продолжает ТУ ЖЕ сцену того же плана, и замысел
        // для неё уже посчитан прогоном, который автор остановил. Живой
        // прогон 2026-09-22: подготовка 46–50 с при 31–37 с на сам беат —
        // больше половины ожидания уходило на пересчёт известного. Берём
        // сохранённое; если брать нечего, считаем обычным путём, потому что
        // тихо остаться без замысла хуже, чем заплатить за вызов.
        const stored =
          mode === "beats" && fromBeat > 0
            ? loadStoredSceneIntent(sqlite, {
                chapterId: ch.id,
                participants: assembled.participants,
                snapshotEventIds: assembled.sourceRefs
                  .filter((r) => r.kind === "event")
                  .map((r) => r.id),
              })
            : null;
        const sceneIntent = stored ?? (await prepareSceneIntent(sqlite, {
          bookId: ch.book_id,
          chapterId: ch.id,
          chapterOrder: ch.order_index,
          chapterTitle: ch.title,
          bookTitle: ctx.title,
          beatSheet: beatBlob,
          dialogueRegister: beatSheet.dialogueRegister ?? null,
          chapterContract: beatSheet.contract
            ? renderChapterContract(beatSheet.contract)
            : null,
          characterContext: assembled.characterContext,
          participants: assembled.participants,
          snapshotEventIds: assembled.sourceRefs
            .filter((r) => r.kind === "event")
            .map((r) => r.id),
          contextSnapshotId: contextManifest.id,
          onUsage: (usage) =>
            logUsage(sqlite, {
              route: "plot.scene_intent",
              model: usage.modelId,
              usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheCreationInputTokens: usage.cacheCreationInputTokens,
                cacheReadInputTokens: usage.cacheReadInputTokens,
              },
              bookId: ch.book_id,
              chapterId: ch.id,
            }),
        }));
        await stream.writeSSE({
          event: "scene_intent",
          data: JSON.stringify({
            prepared: sceneIntent.prompt !== null,
            // Деградация называется вслух: Писатель работает по тому же
            // снимку, но без намерений, и это видно в запуске.
            degraded: sceneIntent.degraded,
            droppedEventIds: sceneIntent.droppedEventIds.length,
          }),
        });

        const writerInput = {
          bookTitle: ctx.title,
          bookPremise: ctx.premise,
          bookOutline: ctx.outlineSelected,
          chapterTitle: ch.title,
          beatSheet: beatSheetForWriter,
          sceneIntent: sceneIntent.prompt,
          previousChaptersSummary: assembled.previousChapters,
          previousChapterTail: assembled.previousTail,
          sceneState: assembled.sceneState,
          characterContext: assembled.characterContext,
          loreContext: assembled.loreContext,
          styleContext: assembled.styleContext.prompt,
          studioContext: assembled.studioContext,
          retrievedContext: assembled.retrieval,
          fatigueWords: assembled.styleContext.fatigueBlacklist,
          config: {
            variants: 1,
            ...parsed.data.config,
            model: parsed.data.config?.model ?? ctx.writerModel,
          },
          provider: ctx.writerProvider,
          ...(ctx.writerLocalModel ? { localModelTag: ctx.writerLocalModel } : {}),
          ...(signal !== undefined ? { signal } : {}),
        };

        // Один проход Писателя: целая глава или один беат. Статистика
        // копится по всем проходам — расход главы считается разом.
        const runOnce = async (beat?: { index: number; textSoFar: string }): Promise<string> => {
          const gen = runChapterWriter(beat ? { ...writerInput, beat } : writerInput);
          let text = "";
          while (true) {
            const next = await gen.next();
            if (next.done) {
              text = next.value.text;
              modelId = next.value.modelId;
              stopReason = next.value.stopReason;
              inputTokens += next.value.tokens.input;
              outputTokens += next.value.tokens.output;
              cacheCreationTokens += next.value.tokens.cacheCreation;
              cacheReadTokens += next.value.tokens.cacheRead;
              break;
            }
            await stream.writeSSE({ event: "chunk", data: JSON.stringify({ text: next.value }) });
          }
          return text;
        };

        if (mode === "beats") {
          fullText = prefixText;
          for (let i = fromBeat; i < beatSheet.beats.length; i += 1) {
            await stream.writeSSE({
              event: "beat",
              data: JSON.stringify({ index: i, total: beatSheet.beats.length }),
            });
            const piece = (await runOnce({ index: i, textSoFar: fullText })).trim();
            fullText = fullText.trim().length > 0 ? `${fullText.trim()}\n\n${piece}` : piece;
            beatsDone = i + 1;
            // Кандидат растёт по ходу: падение процесса не теряет написанное.
            appendProposalProgress(sqlite, proposalId, {
              contentText: fullText,
              wordCount: countWords(fullText),
              beatsDone,
              beatsTotal: beatSheet.beats.length,
            });
            if (cancels.shouldStop(proposalId)) break;
            // На последнем беате удерживать нечего: кандидат и так дописан.
            if (cancels.shouldHold(proposalId) && i < beatSheet.beats.length - 1) {
              held = true;
              break;
            }
          }
        } else {
          fullText = await runOnce();
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

        // С5: бэкенд подписки причину остановки не сообщает вовсе, и
        // «не подтверждено» горело на КАЖДОЙ главе — предупреждение,
        // которое всегда горит, перестают читать. Когда причины нет,
        // судим по хвосту текста; `completion` остаётся честным.
        const verdict = judgeProseCompletion(stopReason, fullText);
        const confirmed = isConfirmedCompletion(stopReason);
        finishProposal(sqlite, proposalId, {
          // Удержание — не готовая глава: остаток беатов не написан, и автор
          // принимает кандидата осознанно, как всякий `incomplete`.
          status: held ? "incomplete" : verdict.looksComplete ? "ready" : "incomplete",
          contentText: fullText,
          contentJson: JSON.stringify(prosePlainTextToProseMirror(fullText)),
          wordCount: countWords(fullText),
          completion: confirmed && !held ? "confirmed" : "unconfirmed",
          stopReason: held ? "held" : stopReason,
          modelId,
          backend: ctx.writerProvider,
          beatsDone,
          beatsTotal,
        });
        finalized = true;

        logUsage(sqlite, {
          route: "writer.chapter",
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

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            proposal: loadProposal(sqlite, proposalId),
            ...(held ? { held: true } : {}),
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
          // Беаты уже легли в кандидата (`appendProposalProgress`), и назвать
          // такой прогон `failed` значило бы показать автору строку с текстом,
          // которую `acceptProposal` принять откажется — ровно то, ради чего
          // кандидат и растёт по ходу. Прогон обрывается, а не пропадает:
          // статус принимаемый, причина названа, ошибка по-прежнему видна.
          const partial = beatsDone !== null && beatsDone > 0;
          finishProposal(sqlite, proposalId, {
            status: partial ? "incomplete" : "failed",
            errorMessage: message,
            stopReason: partial ? "interrupted" : stopReason,
            beatsDone,
            beatsTotal,
          });
        }
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message, proposalId }),
        });
      } finally {
        clearInterval(keepalive);
        await pending;
        cancels.end(proposalId);
      }
    });
  });

  return r;
}
