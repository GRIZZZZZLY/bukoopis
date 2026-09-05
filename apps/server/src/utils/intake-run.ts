import type { Database as DatabaseType } from "better-sqlite3";
import {
  summarizeIntake,
  type IntakeLanded,
  type IntakeSummaryRow,
  type IntakeTarget,
} from "@book-forge/shared";
import {
  StudioBookNotFoundError,
  StudioConflictError,
  type StudioRepository,
} from "../db/studio.js";
import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { docxToPlainText } from "./docx.js";
import {
  describeExistingStages,
  intakeRequestKey,
  landFragments,
} from "./intake-landing.js";
import { insertChapters, type InsertedChapter } from "../routes/import-export.js";

// A file much past this size overflows the call outright rather than
// truncating, so it is rejected before the classifier ever sees it — as a
// per-file failure, not a whole-request 400 — and the rest of the batch still
// lands.
const MAX_INTAKE_FILE_CHARS = 40_000;

export interface IntakeFileEvent {
  index: number; // 0-based
  total: number;
  filename: string;
  status: "started" | "done" | "failed";
  /** Куда легли фрагменты этого файла; только при status "done". */
  targets?: IntakeTarget[];
  /** Причина; только при status "failed". */
  message?: string;
}

export interface RunIntakeDeps {
  sqlite: DatabaseType;
  hasVec: boolean;
  repo: StudioRepository;
  bookId: number;
}

export interface RunIntakeInput {
  files: Array<{ filename: string; content?: string; contentBase64?: string }>;
  onFile?: (e: IntakeFileEvent) => void;
  onBegin?: (e: { requestKey: string; total: number }) => void;
  shouldStop?: () => boolean;
}

export interface IntakeRunResult {
  summary: IntakeSummaryRow[];
  ideaSet: boolean;
  chapters: InsertedChapter[];
  failures: Array<{ filename: string; message: string }>;
  revision: number;
  cancelled: boolean;
  requestKey: string;
  /** Ответ взят из журнала, агент не вызывался. */
  replayed: boolean;
}

export class IntakeBookNotFoundError extends Error {
  constructor(bookId: number) {
    super(`book ${bookId} not found`);
    this.name = "IntakeBookNotFoundError";
  }
}

/** Раннер не ждёт потребителя и не должен из-за него падать: кривой onFile не
 *  роняет чужой импорт. */
function emitFile(onFile: ((e: IntakeFileEvent) => void) | undefined, e: IntakeFileEvent): void {
  if (!onFile) return;
  try {
    onFile(e);
  } catch {
    /* consumer's problem, not ours */
  }
}

export async function runIntake(
  deps: RunIntakeDeps,
  input: RunIntakeInput,
): Promise<IntakeRunResult> {
  const { sqlite, hasVec, repo, bookId } = deps;
  const { onFile, onBegin, shouldStop } = input;

  let concept;
  let state;
  try {
    concept = repo.loadConcept(bookId);
    state = repo.loadStudioState(bookId);
  } catch (e) {
    if (e instanceof StudioBookNotFoundError) throw new IntakeBookNotFoundError(bookId);
    throw e;
  }

  const failures: Array<{ filename: string; message: string }> = [];

  // .docx приходит как contentBase64 — сервер сам распаковывает его в текст
  // до классификации. Файл, который на деле не .docx (или иначе побитый),
  // становится обычным per-file failure, а не валит весь запрос.
  const readable: Array<{ filename: string; content: string }> = [];
  for (const f of input.files) {
    if (f.content !== undefined) {
      readable.push({ filename: f.filename, content: f.content });
      continue;
    }
    try {
      const text = await docxToPlainText(Buffer.from(f.contentBase64!, "base64"));
      if (text.trim().length === 0) throw new Error("файл пуст");
      readable.push({ filename: f.filename, content: text });
    } catch (e) {
      failures.push({
        filename: f.filename,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Повторное перетаскивание той же папки не должно удваивать черновики.
  // Ключ считается по readable (то, что реально пойдёт в классификатор), а
  // не по исходному телу запроса — иначе перетаскивание того же .docx с
  // одинаковыми байтами, но не совпавшее по requestKey, разбиралось бы
  // заново на каждый повтор.
  const requestKey = intakeRequestKey(readable);
  const prior = sqlite
    .prepare(
      `SELECT payload FROM studio_events
       WHERE book_id = ? AND event_type = 'import_merge'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(bookId) as { payload: string } | undefined;
  if (prior) {
    try {
      const p = JSON.parse(prior.payload) as { note?: string; after?: unknown };
      if (p.note === requestKey && p.after) {
        return {
          ...(p.after as Omit<IntakeRunResult, "cancelled" | "requestKey" | "replayed">),
          cancelled: false,
          requestKey,
          replayed: true,
        };
      }
    } catch {
      /* повреждённое старое событие — просто разбираем заново */
    }
  }

  if (onBegin) {
    try {
      onBegin({ requestKey, total: readable.length });
    } catch {
      /* consumer's problem, not ours */
    }
  }

  const existingStages = describeExistingStages(state);
  const idea = (concept.idea ?? "").trim();
  const fragments: Awaited<ReturnType<typeof runMaterialClassifier>>["fragments"] = [];
  let foundIdea: string | undefined;
  let cancelled = false;

  // Последовательно, а не пачкой: один файл — один вызов, и падение одного
  // не уносит остальные. shouldStop проверяется только перед началом
  // очередного файла — прервать LLM-вызов на середине нечем.
  for (let index = 0; index < readable.length; index++) {
    const file = readable[index]!;
    if (shouldStop?.()) {
      cancelled = true;
      break;
    }

    emitFile(onFile, {
      index,
      total: readable.length,
      filename: file.filename,
      status: "started",
    });

    if (file.content.length > MAX_INTAKE_FILE_CHARS) {
      const message = `Файл «${file.filename}» слишком велик, чтобы прочитать за один раз (${file.content.length} символов, предел ${MAX_INTAKE_FILE_CHARS}). Разделите его на части поменьше и загрузите снова.`;
      failures.push({ filename: file.filename, message });
      emitFile(onFile, {
        index,
        total: readable.length,
        filename: file.filename,
        status: "failed",
        message,
      });
      continue;
    }

    try {
      const out = await runMaterialClassifier({
        filename: file.filename,
        content: file.content,
        ...(idea.length > 0 ? { bookIdea: idea } : {}),
        ...(existingStages.length > 0 ? { existingStages } : {}),
      });
      fragments.push(...out.fragments);
      if (foundIdea === undefined && out.bookIdea && out.bookIdea.trim().length > 0) {
        foundIdea = out.bookIdea.trim();
      }
      emitFile(onFile, {
        index,
        total: readable.length,
        filename: file.filename,
        status: "done",
        targets: [...new Set(out.fragments.map((f) => f.target))],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ filename: file.filename, message });
      emitFile(onFile, {
        index,
        total: readable.length,
        filename: file.filename,
        status: "failed",
        message,
      });
    }
  }

  const now = new Date().toISOString();
  const { next, landed, chapterFragments } = landFragments(state, fragments, now);

  let revision = state.revision;
  if (landed.length > 0) {
    revision = repo.patchStudioState(bookId, {
      expectedRevision: state.revision,
      next,
    }).revision;
  }

  // Studio-state aspects are already durably committed above (if landed.length
  // > 0). From here on a thrown error must not escape as an uncaught 500: that
  // would skip the journal write below, and a retry would re-classify every
  // file and append the same aspects a second time via mergeAspectsIntoStage.
  // So the tail follows the same philosophy as the per-file loop — report a
  // failure and carry on, so the response (and the replay cache) describes
  // what actually landed.
  let chapters: InsertedChapter[] = [];
  if (chapterFragments.length > 0) {
    try {
      chapters = await insertChapters(
        sqlite,
        hasVec,
        bookId,
        chapterFragments.map((f) => ({ title: f.title, body: f.body })),
      );
    } catch (e) {
      failures.push({
        filename: "Главы",
        message: `Не удалось сохранить главы (${chapterFragments.map((f) => f.title).join(", ")}): ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  let ideaSet = false;
  if (idea.length === 0 && foundIdea !== undefined) {
    try {
      repo.patchConcept(bookId, { ...concept, idea: foundIdea });
      ideaSet = true;
    } catch (e) {
      failures.push({
        filename: "Задумка",
        message: `Не удалось сохранить замысел: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const allLanded: IntakeLanded[] = [
    ...(ideaSet ? [{ target: "concept" as const, title: "Задумка", kind: "idea" as const }] : []),
    ...landed,
    ...chapters.map((ch) => ({
      target: "chapters" as const,
      title: ch.title,
      kind: "chapter" as const,
    })),
  ];

  const response = {
    summary: summarizeIntake(allLanded),
    ideaSet,
    chapters,
    failures,
    revision,
  };

  // Журналим только прогон, который чего-то добился. Иначе прогон, где всё
  // упало (сломался ключ к API — и вот все файлы в failures), кешируется
  // навсегда: то же перетаскивание той же папки бесконечно проигрывает те же
  // отказы, ни разу не попробовав заново, — а сводка при этом обещает автору
  // «Их можно перетащить ещё раз». Ничего не добившийся прогон повторяем.
  if (landed.length > 0 || chapters.length > 0 || ideaSet) {
    repo.events.log({
      bookId,
      eventType: "import_merge",
      payload: { note: requestKey, after: response },
      revisionBefore: state.revision,
      revisionAfter: revision,
    });
  }

  return {
    ...response,
    cancelled,
    requestKey,
    replayed: false,
  };
}
