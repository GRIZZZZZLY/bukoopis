import type { Database as DatabaseType } from "better-sqlite3";
import {
  defaultVerificationFor,
  normalizeEventData,
  IMPLICIT_SCENE_ORDINAL,
  type CharacterEventKind,
  type ExtractedCharacterEvent,
  type SceneBoundary,
  type CharacterEvent,
  type ActiveState,
} from "@book-forge/shared";
import { toCharacterEvent, type CharacterEventRow } from "../db/rows.js";
import { resolveEntity } from "./entity-resolve.js";
import { chapterPositionLookup } from "./chapter-position.js";
import type { CharacterBoundaryReaders } from "@book-forge/agents";

/** Слой событий персонажа (ТЗ индивидуальности, разделы 6, 12). */

/**
 * Находит дословную цитату в НЕИЗМЕНЯЕМОМ `content_text` указанной версии.
 * Поиск буквальный: цитата либо есть в тексте ровно один раз, либо
 * доказательства нет. Модельный ответ не считается доверенным потому, что он
 * правильной формы (раздел 14), а событие без доказательства не
 * активируется (AC-25).
 *
 * Диапазон СЧИТАЕТ СЕРВЕР, а не модель. Просить у модели позиции символов
 * в главе на двадцать тысяч знаков — просить то, чего она не умеет: промах
 * на единицу отвергает событие, и весь разбор возвращается пустым, как если
 * бы в главе ничего не было. Цитату модель копирует, а это она умеет.
 *
 * Координаты на выходе — UTF-16 offsets, как их считает JavaScript. Это
 * задокументированная система: смешивать её с индексами TipTap нельзя.
 */
export function locateEvidence(
  contentText: string,
  quote: string,
): { start: number; end: number } | null {
  // Стадированный результат читается `JSON.parse(...) as T`, без схемы, так
  // что сюда может прийти что угодно. Без этой проверки `quote.trim()` бросил
  // бы TypeError внутри транзакции активации, а бросок там теряет память всей
  // версии молча и навсегда — задание к тому моменту уже `done`.
  if (typeof quote !== "string") return null;
  // Пробел или одиночный символ сходится где угодно: такая «цитата»
  // подтверждает любое утверждение и делает проверку бессмысленной.
  if (quote.trim().length < 2) return null;
  const start = contentText.indexOf(quote);
  if (start < 0) return null;
  // Второе вхождение — неоднозначная привязка. То же правило, что у
  // `resolveEntity` на двух тёзках: указать не туда хуже, чем не указать.
  if (contentText.indexOf(quote, start + 1) >= 0) return null;
  return { start, end: start + quote.length };
}

/**
 * Стабильный ключ события для идемпотентности (AC-21). Повторная обработка
 * той же версии тем же извлекателем не должна плодить долги и секреты, а
 * модель между прогонами переставляет ключи и меняет пробелы — поэтому
 * ключ считается по смыслу, а не по сырому JSON.
 *
 * Адресат входит в ключ отдельным аргументом, потому что он живёт колонкой
 * `addressee_character_id`, а не в `data`: у `relation_shift` данные — это
 * {quality, from, to}, и два сдвига из одной версии к разным героям без
 * него совпали бы ключом, а `INSERT OR IGNORE` выбросил бы второй молча.
 *
 * Данные сперва приводятся к форме своего вида. Схема извлечения — это
 * `z.record`: лишние ключи она пропускает, умолчания не подставляет. Модель
 * на первом прогоне вернёт {fact, acquisition}, на втором — то же плюс
 * `source: null`, и сырой ключ развёл бы одно событие на два.
 */
export function dedupKeyFor(
  kind: CharacterEventKind,
  data: unknown,
  addresseeCharacterId: number | null = null,
): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "string") {
      // NFC: «й» одной точкой и «и» с комбинирующей краткой — один символ
      // для читателя и два разных ключа без нормализации.
      return v.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    }
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = norm((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return `${kind}:${addresseeCharacterId ?? "-"}:${JSON.stringify(
    norm(normalizeEventData(kind, data)),
  )}`;
}

export interface PersistEventsOutcome {
  inserted: number;
  /** Отвергнуто из-за несошедшегося доказательства (AC-25). */
  rejectedEvidence: number;
  /** Имя субъекта не разрешилось в героя этой книги. */
  unresolved: number;
  /** Сами имена, по одному разу каждое. Число отказов говорит автору, что
   *  память не легла; что с этим делать, говорит только имя — расхождение
   *  между замыслом и составом лечится псевдонимом или переименованием
   *  героя, и искать его больше негде. */
  unresolvedNames: string[];
  /** Уже было — повторная обработка (AC-21). */
  duplicates: number;
  /** Снято прежним извлекателем по этой же версии главы и вытеснено новым
   *  разбором. Ноль при обычном повторе: вытесняет только БОЛЕЕ НОВАЯ версия
   *  извлекателя. */
  superseded: number;
}

export interface PersistEventsArgs {
  bookId: number;
  chapterId: number;
  /**
   * Версия-источник. Текст для сверки читается по ней здесь же и параметром
   * не принимается: гарантия AC-25 не должна зависеть от того, передал ли
   * вызывающий текст ИМЕННО этой версии, а не черновик рядом с ней.
   */
  sourceVersionId: number;
  events: ExtractedCharacterEvent[];
  extractorVersion: number;
}

/**
 * Пишет события. Вызывать ВНУТРИ транзакции активации: вместе с фактами и
 * заметками одной версии они активируются атомарно, иначе половина новых
 * отношений останется без остальной памяти (раздел 12, AC-22).
 */
export function persistCharacterEvents(
  sqlite: DatabaseType,
  args: PersistEventsArgs,
): PersistEventsOutcome {
  const out: PersistEventsOutcome = {
    inserted: 0,
    rejectedEvidence: 0,
    unresolved: 0,
    unresolvedNames: [],
    duplicates: 0,
    superseded: 0,
  };
  const noteUnresolved = (name: string): void => {
    out.unresolved += 1;
    if (!out.unresolvedNames.includes(name)) out.unresolvedNames.push(name);
  };
  // `INSERT OR IGNORE` гасит и нарушения CHECK, а не только конфликт
  // уникального индекса: с extractorVersion = 0 весь прогон вернул бы
  // «всё дубликаты» и был бы неотличим от идемпотентного повтора.
  if (!Number.isInteger(args.extractorVersion) || args.extractorVersion < 1) {
    throw new Error(`extractorVersion должен быть целым >= 1, получено ${args.extractorVersion}`);
  }
  const version = sqlite
    .prepare("SELECT content_text, chapter_id FROM chapter_versions WHERE id = ?")
    .get(args.sourceVersionId) as
    | { content_text: string; chapter_id: number }
    | undefined;
  if (!version) {
    throw new Error(`версия ${args.sourceVersionId} не найдена`);
  }
  // Глава приходит параметром, а версия знает свою сама. Расхождение значит,
  // что событие приписали бы не той главе — и граница сцены, ради которой
  // весь этап, считалась бы по чужому номеру.
  if (version.chapter_id !== args.chapterId) {
    throw new Error(
      `версия ${args.sourceVersionId} принадлежит главе ${version.chapter_id}, а не ${args.chapterId}`,
    );
  }
  const contentText = version.content_text;

  // Новый извлекатель вытесняет прежний по этой же версии главы. Без этого
  // `extractor_version` в уникальном ключе разводил повторный разбор в
  // ПАРАЛЛЕЛЬНЫЙ набор строк: герой знал одно и то же дважды, разными
  // словами, и обе записи считались действующими. Трогаются только машинные
  // (`origin = 'llm'`) события: авторские и перенесённые извлекатель не
  // ставил и снимать не вправе. Пустой разбор ничего не вытесняет — модель,
  // вернувшая ноль событий, не доказательство, что их нет.
  if (args.events.length > 0) {
    out.superseded = sqlite
      .prepare(
        `DELETE FROM character_events
         WHERE source_version_id = ? AND origin = 'llm' AND extractor_version < ?`,
      )
      .run(args.sourceVersionId, args.extractorVersion).changes;
  }

  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO character_events
       (book_id, subject_character_id, addressee_character_id, kind, data_json,
        chapter_id, scene_ordinal, source_version_id,
        evidence_quote, evidence_start, evidence_end,
        origin, verification, extractor_version, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'llm', ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();

  for (const e of args.events) {
    // Доказательство ищется первым: это поиск по строке, а разбор имени
    // идёт в базу. Порядок ещё и честнее в подсчёте — выдуманная цитата
    // ложится в `rejectedEvidence`, а не прячется в `unresolved`.
    const span = locateEvidence(contentText, e.evidenceQuote);
    if (!span) {
      out.rejectedEvidence += 1;
      continue;
    }
    const subject = resolveEntity(sqlite, args.bookId, "character", e.subjectName);
    if (!subject) {
      // Неоднозначное или неизвестное имя. Резолвер намеренно возвращает
      // `null` вместо первого попавшегося — пришить событие чужому герою
      // хуже, чем не пришить никому (AC-04, этап 2).
      noteUnresolved(e.subjectName);
      continue;
    }
    // Названный, но неразрешённый адресат — тот же отказ, а не NULL. Иначе
    // два сдвига к разным неизвестным героям сходятся ключом на «-», и
    // второй молча съедает `INSERT OR IGNORE`. Сдвиг отношения в никуда
    // всё равно не строка, которой можно пользоваться.
    let addresseeId: number | null = null;
    if (e.addresseeName) {
      const addressee = resolveEntity(sqlite, args.bookId, "character", e.addresseeName);
      if (!addressee) {
        noteUnresolved(e.addresseeName);
        continue;
      }
      addresseeId = addressee.entityId;
    }

    const info = insert.run(
      args.bookId,
      subject.entityId,
      addresseeId,
      e.kind,
      // Хранится ответ модели как есть, а ключ считается по нормализованной
      // форме. Отсюда следствие, которое стоит знать: если тот же смысл
      // придёт второй раз с более полными данными, ключ совпадёт и запись
      // останется прежней, победнее. Это и есть идемпотентность AC-21 —
      // «то же событие не плодит строк»; предпочесть более полный вариант
      // значило бы переписывать уже показанное автору при каждом разборе.
      JSON.stringify(e.data),
      args.chapterId,
      // Одна неявная сцена на главу (этап 3). В ключ порядковый номер не
      // входит: варьировать его пока нечему, а войдя, он развёл бы то же
      // событие по сценам, как только их станет больше одной.
      IMPLICIT_SCENE_ORDINAL,
      args.sourceVersionId,
      e.evidenceQuote,
      span.start,
      span.end,
      defaultVerificationFor(e.kind),
      args.extractorVersion,
      dedupKeyFor(e.kind, e.data, addresseeId),
      now,
    );
    if (info.changes > 0) out.inserted += 1;
    else out.duplicates += 1;
  }
  return out;
}

/** Только эти статусы считаются действующими знаниями. Гипотеза в контекст
 *  не идёт, отклонённое — тем более (AC-26). */
const ACTIVE_VERIFICATIONS = "('derived','confirmed')";

/**
 * События субъектов на начало сцены. Граница ИСКЛЮЧАЮЩАЯ: начальный контекст
 * строится из событий ДО неё, иначе герой входит в сцену, уже зная то, что
 * узнает в ней (раздел 7, AC-07).
 *
 * Порядок главы берётся **join'ом к `chapters`**, а не денормализованной
 * колонкой: перестановка глав иначе оставила бы тихо неверную границу, и
 * заметить это было бы нечем.
 *
 * Событие без главы (перенесённое ручное знание) видно всегда: автор ввёл
 * его вне повествования, и прятать его — потеря авторских сведений.
 */
export function loadEventsAtBoundary(
  sqlite: DatabaseType,
  subjectIds: number[],
  boundary: SceneBoundary,
): CharacterEvent[] {
  if (subjectIds.length === 0) return [];
  const placeholders = subjectIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT e.* FROM character_events e
       LEFT JOIN chapters ec ON ec.id = e.chapter_id
       WHERE e.subject_character_id IN (${placeholders})
         AND e.verification IN ${ACTIVE_VERIFICATIONS}
         AND (
           e.chapter_id IS NULL
           OR ec.order_index < (SELECT order_index FROM chapters WHERE id = ?)
         )
       ORDER BY e.id ASC`,
    )
    .all(...subjectIds, boundary.chapterId) as CharacterEventRow[];
  return rows.map(toCharacterEvent);
}

/** Знания одного героя на границе. Опровергнутое к этому моменту не
 *  возвращается: «знал, но уже знает, что это неправда» — не знание. */
export function loadKnowledgeAtBoundary(
  sqlite: DatabaseType,
  characterId: number,
  boundary: SceneBoundary,
): CharacterEvent[] {
  const order = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;
  // Позиция, а не `order_index`: все поля с суффиксом `ChapterOrder` в этом
  // этапе означают номер главы, как его видит автор. Сравнив позицию с
  // разрежённым индексом, фильтр молча считал бы опровергнутым почти всё.
  const boundaryPosition = order
    ? chapterPositionLookup(sqlite, boundary.bookId)(order.order_index)
    : null;
  return loadEventsAtBoundary(sqlite, [characterId], boundary).filter((e) => {
    if (e.kind !== "knowledge") return false;
    const d = e.data as { disprovedFromChapterOrder: number | null };
    if (d.disprovedFromChapterOrder === null || boundaryPosition === null) return true;
    return d.disprovedFromChapterOrder > boundaryPosition;
  });
}

/**
 * Эпизодические состояния персонажей на границе сцены. Состояние считается
 * свежим, если наблюдалось в одной из последних трёх глав относительно
 * границы, иначе — давним.
 *
 * Ponytail: пороговая константа 3 выбрана произвольно и должна быть
 * настраиваемой параметром, если появятся сцены с более длинной памятью.
 */
export function loadActiveStates(
  sqlite: DatabaseType,
  subjectIds: number[],
  boundary: SceneBoundary,
): ActiveState[] {
  if (subjectIds.length === 0) return [];
  const FRESHNESS_THRESHOLD = 3; // главы
  const placeholders = subjectIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT e.*, ec.order_index as chapter_order
       FROM character_events e
       LEFT JOIN chapters ec ON ec.id = e.chapter_id
       WHERE e.subject_character_id IN (${placeholders})
         AND e.kind = 'state'
         AND e.verification IN ('derived','confirmed')
         AND (
           e.chapter_id IS NULL
           OR ec.order_index < (SELECT order_index FROM chapters WHERE id = ?)
         )
       -- Позднейшее наблюдение выигрывает, и «позднейшее» — по главе, а не
       -- по порядку вставки: переразбор ранней главы после поздней записал бы
       -- строку с большим id, и состояние героя откатилось бы назад во времени.
       ORDER BY ec.order_index DESC, e.id DESC`,
    )
    .all(...subjectIds, boundary.chapterId) as Array<{
    subject_character_id: number;
    chapter_order: number | null;
    data_json: string;
    id: number;
  }>;

  const boundaryOrder = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;

  // `order_index` разрежённый — главы идут с шагом 10. Считать по нему
  // расстояние в главах нельзя: соседняя глава отличается на 10, и порог в
  // три главы не срабатывал никогда после четвёртой. Считаем по позициям.
  const positionOf = chapterPositionLookup(sqlite, boundary.bookId);
  const boundaryPosition = boundaryOrder ? positionOf(boundaryOrder.order_index) : null;

  const result: ActiveState[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    // `seen` отмечается ТОЛЬКО когда состояние действительно взято. Пометка
    // до проверок отдавала слот герою за отброшенной строкой: «в ярости»
    // (scope: scene, глава 9) занимало место и выбрасывалось, и рана из
    // второй главы, ещё действующая, не находилась уже никогда.
    if (seen.has(row.subject_character_id)) continue;

    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      data = {};
    }

    const d = normalizeEventData("state", data);
    const state = d.state;
    const endCondition = d.endCondition;

    if (!state) continue;

    const observedPosition =
      row.chapter_order === null ? null : positionOf(row.chapter_order);

    // Явный срок вышел — состояние больше не действует (AC-34).
    if (
      d.endsAtChapterOrder !== null &&
      boundaryPosition !== null &&
      d.endsAtChapterOrder <= boundaryPosition
    ) {
      continue;
    }
    // «Сцена» и «глава» без явного срока действуют только там, где
    // наблюдались. Граница исключающая, поэтому своя глава сюда и не
    // попадает: такое состояние живёт ровно одну сцену и дальше не идёт.
    if (
      (d.scope === "scene" || d.scope === "chapter") &&
      d.endsAtChapterOrder === null &&
      observedPosition !== null &&
      boundaryPosition !== null &&
      observedPosition < boundaryPosition
    ) {
      continue;
    }

    // Состояние без главы — ручное или перенесённое. Номера у него нет, и
    // «наблюдалось в главе 0» было бы выдумкой: отдаём `null`.
    const observedAtChapterOrder = observedPosition;
    const isFresh =
      boundaryPosition !== null &&
      observedAtChapterOrder !== null &&
      observedAtChapterOrder >= boundaryPosition - FRESHNESS_THRESHOLD;

    seen.add(row.subject_character_id);
    result.push({
      subjectCharacterId: row.subject_character_id,
      state,
      endCondition,
      observedAtChapterOrder,
      certainty: isFresh ? "fresh" : "stale",
    });
  }

  return result;
}

/**
 * Читатели границы для `gatherCharacterContext`. Существуют потому, что
 * `packages/agents` до `apps/server` не дотягивается, а второй экземпляр той
 * же SQL там уже появлялся: те же запросы, свой разбор строки, своя копия
 * фильтра опровергнутого. Разошлись бы они молча, и именно на том пути,
 * который идёт в Писателя.
 */
export function makeCharacterBoundaryReaders(
  sqlite: DatabaseType,
  boundary: SceneBoundary,
): CharacterBoundaryReaders {
  return {
    knowledge: (characterId) =>
      loadKnowledgeAtBoundary(sqlite, characterId, boundary).map((e) => {
        const d = normalizeEventData("knowledge", e.data);
        return {
          fact: d.fact,
          acquisition: d.acquisition,
          source: d.source,
          canonFactId: d.canonFactId,
          disprovedFromChapterOrder: d.disprovedFromChapterOrder,
        };
      }),
    states: (ids) => loadActiveStates(sqlite, ids, boundary),
  };
}
