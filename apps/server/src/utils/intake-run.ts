import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookOutlineSchema,
  mergeOutlineVariants,
  summarizeIntake,
  type BookOutline,
  type BookOutlineVariant,
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

/** Разбор идёт минутами и молча, а его решения («замысел не взят», «фрагмент
 *  никуда не лёг») не видны ни в ответе, ни на экране — их видно только здесь.
 *  Формат тот же, что у остального сервера: `[тег] текст` в консоль. */
function log(message: string): void {
  console.info(`[intake] ${message}`);
}

/** «world×3, plot×1» — куда классификатор разложил файл, одной строкой. */
function countByTarget(fragments: Array<{ target: string }>): string {
  const counts = new Map<string, number>();
  for (const f of fragments) counts.set(f.target, (counts.get(f.target) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${t}×${n}`).join(", ") || "пусто";
}

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
  /** Сколько авторских оглавлений легло вариантами в books.outline_json. */
  planVariants: number;
  failures: Array<{ filename: string; message: string }>;
  /** Легло, но требует взгляда автора: текст главы, переписанный
   *  классификатором, не совпал с исходным файлом дословно (F03). */
  warnings: Array<{ title: string; message: string }>;
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
interface IntakeJournalAfter extends Omit<IntakeResponseBody, "planVariants" | "warnings"> {
  /** Нет у событий, записанных до фазы 5. */
  planVariants?: number;
  /** Нет у событий, записанных до F03. */
  warnings?: Array<{ title: string; message: string }>;
  /** Нет у событий, записанных до появления дочитывания. */
  processedFiles?: string[];
  landed?: IntakeLanded[];
  /** Классифицировано, но не доставлено: запись глав или плана упала после
   *  того, как файлы уже засчитаны прочитанными (F13 ревью 2026-09-22).
   *  Повтор того же перетаскивания доставляет их, не зовя классификатор, —
   *  иначе он проигрывал старый отказ, а автору обещано «перетащите ещё раз». */
  undelivered?: {
    chapters?: Array<{ title: string; body: string }>;
    planVariants?: BookOutlineVariant[];
  };
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
    // У событий, записанных до фазы 5, поля нет вовсе — это не ноль по ошибке,
    // а «тогда планов ещё не приземляли».
    planVariants: after.planVariants ?? 0,
    failures: after.failures,
    warnings: after.warnings ?? [],
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
  log(
    `book ${bookId}: файлов ${readable.length} → единиц разбора ${units.length}, ключ ${requestKey}` +
      (prior ? `, прошлый прогон найден (прочитано ${priorProcessed.size})` : "") +
      (failures.length > 0 ? `, не прочитано ${failures.length}` : ""),
  );

  if (prior) {
    // У события без processedFiles (записано до дочитывания) нет способа
    // узнать, что именно оно разобрало. Верим ему как раньше — целиком:
    // иначе повтор удвоил бы всё, что уже легло.
    const retryCount =
      (prior.undelivered?.chapters?.length ?? 0) + (prior.undelivered?.planVariants?.length ?? 0);
    if ((prior.processedFiles === undefined || queue.length === 0) && retryCount === 0) {
      log(
        `book ${bookId}: всё уже разобрано этим ключом — отвечаем из журнала, классификатор не зовём`,
      );
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
  /** Исходный текст файла, из которого пришёл фрагмент: по нему проверяется,
   *  что классификатор перенёс главу дословно, а не пересказал (F03). */
  const sourceOf = new Map<object, string>();

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

    const startedAt = Date.now();
    log(
      `book ${bookId}: ${index + 1}/${queue.length} «${file.filename}» — ${file.content.length} символов, вызываем классификатор`,
    );
    try {
      const out = await runMaterialClassifier({
        filename: file.filename,
        content: file.content,
        ...(idea.length > 0 ? { bookIdea: idea } : {}),
        ...(existingStages.length > 0 ? { existingStages } : {}),
      });
      fragments.push(...out.fragments);
      for (const f of out.fragments) sourceOf.set(f, file.content);
      processedNow.push(key);
      if (foundIdea === undefined && out.bookIdea && out.bookIdea.trim().length > 0) {
        foundIdea = out.bookIdea.trim();
      }
      log(
        `book ${bookId}: ${index + 1}/${queue.length} «${file.filename}» готов за ${Math.round((Date.now() - startedAt) / 1000)} с — ` +
          `фрагментов ${out.fragments.length} [${countByTarget(out.fragments)}], bookIdea ${out.bookIdea?.trim() ? `${out.bookIdea.trim().length} символов` : "нет"}`,
      );
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
      log(
        `book ${bookId}: ${index + 1}/${queue.length} «${file.filename}» упал за ${Math.round((Date.now() - startedAt) / 1000)} с — ${message}`,
      );
      emitFile(onFile, {
        index,
        total: queue.length,
        filename: file.filename,
        status: "failed",
        message,
      });
    }
  }

  // Классификатору велено класть формулировку замысла в отдельное поле
  // bookIdea, но он с тем же основанием считает её фрагментом с целью
  // `concept` — цель есть в каталоге, и в инструкции она описана. Такой
  // фрагмент landFragments выбрасывает (в studio_state ему места нет), и
  // замысел исчезал молча: ни в сводке, ни в отказах, нигде. Берём его как
  // запасной источник — это ровно тот текст, который автор и ждёт увидеть в
  // поле «Замысел книги».
  const conceptFragments = fragments.filter((f) => f.target === "concept");
  if (foundIdea === undefined && conceptFragments.length > 0) {
    const body = conceptFragments[0]!.body.trim();
    if (body.length > 0) {
      // Схема замысла держит 8000 символов; длинный «концепт-раздел» режем, а
      // не теряем целиком.
      foundIdea = body.slice(0, 8000);
      log(
        `book ${bookId}: bookIdea классификатор не вернул — берём фрагмент concept «${conceptFragments[0]!.title}» (${body.length} символов)`,
      );
    }
  }

  const now = new Date().toISOString();
  const landedFresh = landFragments(state, fragments, now);
  const { landed } = landedFresh;
  const retryChapters = prior?.undelivered?.chapters ?? [];
  const retryPlans = prior?.undelivered?.planVariants ?? [];
  const chapterFragments = [
    ...retryChapters,
    ...landedFresh.chapterFragments.map((f) => ({ title: f.title, body: f.body })),
  ];
  // F03 ревью 2026-09-22: текст главы — ответ модели, которой велено
  // переносить дословно, но равенство исходнику ничто не проверяло. Глава
  // всё равно ложится черновиком (ниже), а расхождение называется вслух.
  const warnings: Array<{ title: string; message: string }> = [];
  const squash = (t: string): string => t.replace(/\s+/g, " ").trim();
  for (const f of landedFresh.chapterFragments) {
    const source = sourceOf.get(f);
    if (source !== undefined && !squash(source).includes(squash(f.body))) {
      warnings.push({
        title: f.title,
        message:
          "текст главы не совпал с исходным файлом дословно — сверьте черновик с файлом, прежде чем сохранять",
      });
    }
  }
  const planVariants = [...retryPlans, ...landedFresh.planVariants];
  const undelivered: NonNullable<IntakeJournalAfter["undelivered"]> = {};
  log(
    `book ${bookId}: фрагментов всего ${fragments.length} [${countByTarget(fragments)}] → аспектов ${landed.length}, глав ${chapterFragments.length}, планов ${planVariants.length}` +
      (conceptFragments.length > 0 ? `, concept-фрагментов ${conceptFragments.length}` : ""),
  );

  // В2 ревью 2026-09-19: состояние перечитывается ПЕРЕД записью и фрагменты
  // раскладываются на свежее. `state` прочитан до разбора, который идёт
  // десятками минут, и любое действие автора за это время (принял аспект,
  // поправил вариант, запустил быстрый сбор) поднимало ревизию — разбор
  // отвечал 409, и не приземлялось НИЧЕГО: ни аспекты, ни главы, ни план, ни
  // замысел, и журнал не писался, так что повтор стоил полной цены заново.
  // `landFragments` чистая, поэтому переложить её на другое состояние можно
  // столько раз, сколько нужно.
  let revision = state.revision;
  if (landed.length > 0) {
    const MAX_LANDING_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      const fresh = repo.loadStudioState(bookId);
      const relanded = landFragments(fresh, fragments, now);
      try {
        revision = repo.patchStudioState(bookId, {
          expectedRevision: fresh.revision,
          next: relanded.next,
        }).revision;
        break;
      } catch (e) {
        if (!(e instanceof StudioConflictError) || attempt >= MAX_LANDING_ATTEMPTS) throw e;
        log(
          `book ${bookId}: состояние Мастерской изменилось во время разбора — перекладываем (попытка ${attempt + 1})`,
        );
      }
    }
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
      const inserted = await insertChapters(
        sqlite,
        hasVec,
        bookId,
        chapterFragments,
        // Черновиком: до сохранения автором текст модели не становится
        // версией и не участвует ни в поиске, ни в памяти (F03).
        { asDraft: true },
      );
      chapters = inserted.created;
      // Глава, отсеянная как повтор по названию, обязана быть названа:
      // иначе она исчезает молча, а в авторском документе две сцены с
      // одинаковым заголовком — обычное дело.
      for (const s of inserted.skipped) {
        failures.push({ filename: s.title, message: `Глава не добавлена: ${s.reason}` });
      }
    } catch (e) {
      undelivered.chapters = chapterFragments;
      failures.push({
        filename: "Главы",
        message: `Не удалось сохранить главы (${chapterFragments.map((f) => f.title).join(", ")}): ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // Варианты из авторских оглавлений дописываются к уже существующим, а не
  // заменяют их: сгенерированные варианты автор мог отбирать неделю.
  // Выбор не сдвигается — новый вариант ничего за автора не решает.
  let planVariantsLanded = 0;
  if (planVariants.length > 0) {
    try {
      const row = sqlite
        .prepare("SELECT outline_json FROM books WHERE id = ?")
        .get(bookId) as { outline_json: string | null } | undefined;
      let outline: BookOutline | null = null;
      if (row?.outline_json) {
        const parsed = bookOutlineSchema.safeParse(JSON.parse(row.outline_json));
        if (parsed.success) outline = parsed.data;
      }
      // Выбор автора и авторские варианты не вытесняются (F04).
      const { outline: next, dropped } = mergeOutlineVariants(outline, planVariants, now);
      sqlite
        .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(next), now, bookId);
      if (dropped > 0) {
        failures.push({
          filename: "План книги",
          message: `В плане уже ${next.variants.length} вариантов, все авторские или выбранные: ${dropped} из материалов не добавлены. Удалите ненужные варианты и перетащите материал ещё раз.`,
        });
      }
      planVariantsLanded = planVariants.length - dropped;
      log(
        `book ${bookId}: планов из материалов ${planVariants.length} (не влезло ${dropped}) → в outline_json вариантов ${next.variants.length}`,
      );
    } catch (e) {
      undelivered.planVariants = planVariants;
      failures.push({
        filename: "План книги",
        message: `Не удалось сохранить план из материалов: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  let ideaSet = false;
  if (foundIdea === undefined) {
    log(`book ${bookId}: замысел не заполнен — в материалах его формулировки не нашлось`);
  } else {
    try {
      // К3: концепт перечитывается ПЕРЕД записью. `concept` прочитан до
      // разбора, который идёт минутами, и автор за это время мог сгенерировать
      // питчи, утвердить замысел или напечатать его сам. Снимок начала прогона
      // вернул бы концепт к тому, чем он был до всей этой работы.
      const fresh = repo.loadConcept(bookId);
      const freshIdea = (fresh.idea ?? "").trim();
      if (freshIdea.length > 0) {
        log(
          `book ${bookId}: замысел не трогаем — в концепте уже ${freshIdea.length} символов`,
        );
      } else {
        repo.patchConcept(bookId, { ...fresh, idea: foundIdea });
        ideaSet = true;
        log(`book ${bookId}: замысел заполнен из материалов (${foundIdea.length} символов)`);
      }
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
    // Повторная доставка сама отвечает за прежний отказ записи.
    ...(retryChapters.length > 0 ? ["Главы"] : []),
    ...(retryPlans.length > 0 ? ["План книги"] : []),
  ]);
  const landedAll = [...(prior?.landed ?? []), ...landedNow];
  const response: IntakeResponseBody = {
    summary: summarizeIntake(landedAll),
    ideaSet: (prior?.ideaSet ?? false) || ideaSet,
    chapters: [...(prior?.chapters ?? []), ...chapters],
    planVariants: (prior?.planVariants ?? 0) + planVariantsLanded,
    warnings: [...(prior?.warnings ?? []), ...warnings],
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
  const retried = retryChapters.length + retryPlans.length > 0;
  if (landedNow.length > 0 || processedNow.length > 0 || retried) {
    const after: IntakeJournalAfter = {
      ...response,
      processedFiles: [...priorProcessed, ...processedNow],
      landed: landedAll,
      ...(undelivered.chapters || undelivered.planVariants ? { undelivered } : {}),
    };
    repo.events.log({
      bookId,
      eventType: "import_merge",
      payload: { note: requestKey, after },
      revisionBefore: state.revision,
      revisionAfter: revision,
    });
  }

  log(
    `book ${bookId}: прогон закончен — прочитано ${processedNow.length}/${queue.length}, легло ${landedNow.length}, глав ${chapters.length}, планов ${planVariantsLanded}, ` +
      `замысел ${ideaSet ? "заполнен" : "нет"}, отказов ${response.failures.length}${cancelled ? ", остановлен автором" : ""}`,
  );

  return {
    ...response,
    cancelled,
    requestKey,
    replayed: false,
  };
}
