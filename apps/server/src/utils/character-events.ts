import type { Database as DatabaseType } from "better-sqlite3";
import {
  defaultVerificationFor,
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
 */
export function dedupKeyFor(
  kind: CharacterEventKind,
  data: unknown,
  addresseeCharacterId: number | null = null,
): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "string") return v.trim().replace(/\s+/g, " ").toLowerCase();
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
  return `${kind}:${addresseeCharacterId ?? "-"}:${JSON.stringify(norm(data))}`;
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
  sourceVersionId: number;
  /** Текст ИМЕННО той версии, из которой извлекали. */
  contentText: string;
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
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO character_events
       (book_id, subject_character_id, addressee_character_id, kind, data_json,
        chapter_id, scene_ordinal, source_version_id,
        evidence_quote, evidence_start, evidence_end,
        origin, verification, extractor_version, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'llm', ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();

  for (const e of args.events) {
    const subject = resolveEntity(sqlite, args.bookId, "character", e.subjectName);
    if (!subject) {
      // Неоднозначное или неизвестное имя. Резолвер намеренно возвращает
      // `null` вместо первого попавшегося — пришить событие чужому герою
      // хуже, чем не пришить никому (AC-04, этап 2).
      out.unresolved += 1;
      continue;
    }
    if (!verifyEvidence(args.contentText, e.evidenceQuote, e.evidenceStart, e.evidenceEnd)) {
      out.rejectedEvidence += 1;
      continue;
    }
    const addressee = e.addresseeName
      ? resolveEntity(sqlite, args.bookId, "character", e.addresseeName)
      : null;

    const info = insert.run(
      args.bookId,
      subject.entityId,
      addressee?.entityId ?? null,
      e.kind,
      JSON.stringify(e.data),
      args.chapterId,
      args.sourceVersionId,
      e.evidenceQuote,
      e.evidenceStart,
      e.evidenceEnd,
      defaultVerificationFor(e.kind),
      args.extractorVersion,
      dedupKeyFor(e.kind, e.data, addressee?.entityId ?? null),
      now,
    );
    if (info.changes > 0) out.inserted += 1;
    else out.duplicates += 1;
  }
  return out;
}
