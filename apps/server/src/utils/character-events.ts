import type { Database as DatabaseType } from "better-sqlite3";
import {
  defaultVerificationFor,
  normalizeEventData,
  IMPLICIT_SCENE_ORDINAL,
  type CharacterEventKind,
  type ExtractedCharacterEvent,
} from "@book-forge/shared";
import { resolveEntity } from "./entity-resolve.js";

/** Слой событий персонажа (ТЗ индивидуальности, разделы 6, 12). */

/**
 * Доказательство — точная цитата и диапазон в НЕИЗМЕНЯЕМОМ `content_text`
 * указанной версии. Проверка буквальная: `slice(start, end) === quote`.
 * Модельный ответ не считается доверенным только потому, что он правильной
 * формы (раздел 14), а событие без сошедшегося доказательства не
 * активируется (AC-25).
 *
 * Координаты — UTF-16 offsets, как их считает JavaScript. Это
 * задокументированная система: смешивать её с индексами TipTap нельзя.
 */
export function verifyEvidence(
  contentText: string,
  quote: string,
  start: number,
  end: number,
): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end <= start) return false;
  if (end > contentText.length) return false;
  // Пробел или одиночный символ сходится где угодно: такая «цитата»
  // подтверждает любое утверждение и делает проверку бессмысленной.
  if (quote.trim().length < 2) return false;
  return contentText.slice(start, end) === quote;
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
  /** Уже было — повторная обработка (AC-21). */
  duplicates: number;
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
    duplicates: 0,
  };
  // `INSERT OR IGNORE` гасит и нарушения CHECK, а не только конфликт
  // уникального индекса: с extractorVersion = 0 весь прогон вернул бы
  // «всё дубликаты» и был бы неотличим от идемпотентного повтора.
  if (!Number.isInteger(args.extractorVersion) || args.extractorVersion < 1) {
    throw new Error(`extractorVersion должен быть целым >= 1, получено ${args.extractorVersion}`);
  }
  const version = sqlite
    .prepare("SELECT content_text FROM chapter_versions WHERE id = ?")
    .get(args.sourceVersionId) as { content_text: string } | undefined;
  if (!version) {
    throw new Error(`версия ${args.sourceVersionId} не найдена`);
  }
  const contentText = version.content_text;
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
    // Доказательство проверяется первым: это сравнение строк, а разбор имени
    // идёт в базу. Порядок ещё и честнее в подсчёте — выдуманная цитата
    // ложится в `rejectedEvidence`, а не прячется в `unresolved`.
    if (!verifyEvidence(contentText, e.evidenceQuote, e.evidenceStart, e.evidenceEnd)) {
      out.rejectedEvidence += 1;
      continue;
    }
    const subject = resolveEntity(sqlite, args.bookId, "character", e.subjectName);
    if (!subject) {
      // Неоднозначное или неизвестное имя. Резолвер намеренно возвращает
      // `null` вместо первого попавшегося — пришить событие чужому герою
      // хуже, чем не пришить никому (AC-04, этап 2).
      out.unresolved += 1;
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
        out.unresolved += 1;
        continue;
      }
      addresseeId = addressee.entityId;
    }

    const info = insert.run(
      args.bookId,
      subject.entityId,
      addresseeId,
      e.kind,
      JSON.stringify(e.data),
      args.chapterId,
      // Одна неявная сцена на главу (этап 3). В ключ порядковый номер не
      // входит: варьировать его пока нечему, а войдя, он развёл бы то же
      // событие по сценам, как только их станет больше одной.
      IMPLICIT_SCENE_ORDINAL,
      args.sourceVersionId,
      e.evidenceQuote,
      e.evidenceStart,
      e.evidenceEnd,
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
