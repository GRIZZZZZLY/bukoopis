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
  intakeFileKey,
  intakeRequestKey,
  landFragments,
} from "./intake-landing.js";
import { insertChapters, type InsertedChapter } from "../routes/import-export.js";
import { splitIntakeFile } from "./intake-split.js";

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

/** Ответ прогона в том виде, в каком его отдают маршруты. */
type IntakeResponseBody = Omit<IntakeRunResult, "cancelled" | "requestKey" | "replayed">;

/** Что журнал помнит о разобранном перетаскивании: ответ, каким его увидел
 *  автор, плюс две служебные записи.
 *
 *  `processedFiles` — ключи файлов, которые классификатор действительно
 *  прочитал. Остановленный прогон записывает только их, поэтому повтор той же
 *  папки дочитывает остальные, а не проигрывает трёхфайловый ответ вместо
 *  одиннадцати файлов. Упавший файл в список не попадает — значит, получает
 *  вторую попытку.
 *
 *  `landed` — что легло, чтобы повтор собрал сводку заново вместе со своей
 *  добавкой: автор видит и старое, и новое одним списком.
 *
 *  Обе записи живут внутри `after`, который `studioEventPayloadSchema` держит
 *  как `z.unknown()` — расширять схему событий не требуется. */
interface IntakeJournalAfter extends IntakeResponseBody {
  /** Нет у событий, записанных до появления дочитывания. */
  processedFiles?: string[];
  landed?: IntakeLanded[];
}

/** Прошлый прогон ровно этой папки. Ищем по ключу, а не «последнее событие
 *  импорта»: между остановкой и повтором автор мог перетащить другую папку, и
 *  её событие затёрло бы след прерванного прогона — тогда повтор разобрал бы
 *  папку целиком заново и удвоил уже лежащие аспекты (mergeAspectsIntoStage
 *  дописывает без вопросов). LIKE — только предфильтр; решает разбор JSON. */
function readPriorRun(
  sqlite: DatabaseType,
  bookId: number,
  requestKey: string,
): IntakeJournalAfter | undefined {
  const row = sqlite
    .prepare(
      `SELECT payload FROM studio_events
       WHERE book_id = ? AND event_type = 'import_merge' AND payload LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(bookId, `%"note":${JSON.stringify(requestKey)}%`) as { payload: string } | undefined;
  if (!row) return undefined;
  try {
    const p = JSON.parse(row.payload) as { note?: unknown; after?: unknown };
    if (p.note !== requestKey || !p.after || typeof p.after !== "object") return undefined;
    const after = p.after as IntakeJournalAfter;
    // Событие скрипта импорта носит то же имя типа и совсем другую форму —
    // проверяем, что это действительно ответ приёма, прежде чем ему верить.
    if (!Array.isArray(after.summary) || !Array.isArray(after.failures)) return undefined;
    return after;
  } catch {
    /* повреждённое старое событие — просто разбираем заново */
    return undefined;
  }
}

function replayOf(after: IntakeJournalAfter, requestKey: string): IntakeRunResult {
  return {
    summary: after.summary,
    ideaSet: after.ideaSet,
    chapters: after.chapters,
    failures: after.failures,
    revision: after.revision,
    cancelled: false,
    requestKey,
    replayed: true,
  };
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
  const prior = readPriorRun(sqlite, bookId, requestKey);

  // Совпадение ключа — ещё не повод отвечать из журнала. Прогон мог быть
  // остановлен на третьем файле из одиннадцати, и тогда «проиграть» ответ
  // значит навсегда потерять оставшиеся восемь. Разбираем то, что до сих пор
  // не разобрано, и только то.
  // Файл крупнее одного вызова классификатора режется на части по границам
  // абзацев, и дальше часть живёт как самостоятельная единица разбора: своя
  // строка прогресса, свой отказ, свой ключ дочитывания. Файл, влезающий
  // целиком, проходит через сплиттер неизменным — вместе со своим именем, а
  // значит и со своим ключом в журнале.
  const units = readable.flatMap((f) => splitIntakeFile(f));

  const priorProcessed = new Set(prior?.processedFiles ?? []);
  const queue = units
    .map((f) => ({ file: f, key: intakeFileKey(f) }))
    .filter((entry) => !priorProcessed.has(entry.key));
  if (prior) {
    // У события без processedFiles (записано до дочитывания) нет способа
    // узнать, что именно оно разобрало. Верим ему как раньше — целиком:
    // иначе повтор удвоил бы всё, что уже легло.
    if (prior.processedFiles === undefined || queue.length === 0) {
      return replayOf(prior, requestKey);
    }
  }

  if (onBegin) {
    try {
      onBegin({ requestKey, total: queue.length });
    } catch {
      /* consumer's problem, not ours */
    }
  }

  const existingStages = describeExistingStages(state);
  const idea = (concept.idea ?? "").trim();
  const fragments: Awaited<ReturnType<typeof runMaterialClassifier>>["fragments"] = [];
  let foundIdea: string | undefined;
  let cancelled = false;
  /** Ключи файлов, которые классификатор прочитал в этом прогоне. */
  const processedNow: string[] = [];

  // Последовательно, а не пачкой: одна единица разбора (файл или его часть) —
  // один вызов, и падение одного не уносит остальные. shouldStop проверяется
  // только перед началом очередной — прервать LLM-вызов на середине нечем.
  for (let index = 0; index < queue.length; index++) {
    const { file, key } = queue[index]!;
    if (shouldStop?.()) {
      cancelled = true;
      break;
    }

    emitFile(onFile, {
      index,
      total: queue.length,
      filename: file.filename,
      status: "started",
    });

    try {
      const out = await runMaterialClassifier({
        filename: file.filename,
        content: file.content,
        ...(idea.length > 0 ? { bookIdea: idea } : {}),
        ...(existingStages.length > 0 ? { existingStages } : {}),
      });
      fragments.push(...out.fragments);
      processedNow.push(key);
      if (foundIdea === undefined && out.bookIdea && out.bookIdea.trim().length > 0) {
        foundIdea = out.bookIdea.trim();
      }
      emitFile(onFile, {
        index,
        total: queue.length,
        filename: file.filename,
        status: "done",
        targets: [...new Set(out.fragments.map((f) => f.target))],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ filename: file.filename, message });
      emitFile(onFile, {
        index,
        total: queue.length,
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

  const landedNow: IntakeLanded[] = [
    ...(ideaSet ? [{ target: "concept" as const, title: "Задумка", kind: "idea" as const }] : []),
    ...landed,
    ...chapters.map((ch) => ({
      target: "chapters" as const,
      title: ch.title,
      kind: "chapter" as const,
    })),
  ];

  // Дочитывание — продолжение того же перетаскивания, а не новый импорт: в
  // сводке автор должен увидеть и то, что легло сейчас, и то, что успело лечь
  // до остановки. Отказы прошлого прогона переносим только те, по которым этот
  // прогон ничего не решил: файл, который упал и был перечитан, отвечает за
  // себя сам, а «Главы» и «Задумка» никем не перечитываются.
  const processedNowSet = new Set(processedNow);
  const decidedNow = new Set([
    ...queue.filter((e) => processedNowSet.has(e.key)).map((e) => e.file.filename),
    ...failures.map((f) => f.filename),
  ]);
  const landedAll = [...(prior?.landed ?? []), ...landedNow];
  const response: IntakeResponseBody = {
    summary: summarizeIntake(landedAll),
    ideaSet: (prior?.ideaSet ?? false) || ideaSet,
    chapters: [...(prior?.chapters ?? []), ...chapters],
    failures: [
      ...(prior?.failures ?? []).filter((f) => !decidedNow.has(f.filename)),
      ...failures,
    ],
    revision,
  };

  // Журналим прогон, который чего-то добился: что-то легло или хотя бы один
  // файл действительно прочитан. Иначе прогон, где всё упало (сломался ключ к
  // API — и вот все файлы в failures), кешировался бы навсегда: то же
  // перетаскивание той же папки бесконечно проигрывает те же отказы, ни разу
  // не попробовав заново, — а сводка при этом обещает автору «Их можно
  // перетащить ещё раз». Ничего не добившийся прогон повторяем, и запись
  // прошлого прогона при этом остаётся нетронутой.
  if (landedNow.length > 0 || processedNow.length > 0) {
    const after: IntakeJournalAfter = {
      ...response,
      processedFiles: [...priorProcessed, ...processedNow],
      landed: landedAll,
    };
    repo.events.log({
      bookId,
      eventType: "import_merge",
      payload: { note: requestKey, after },
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
