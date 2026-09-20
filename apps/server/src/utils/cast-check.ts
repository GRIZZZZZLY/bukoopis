import type { Database as DatabaseType } from "better-sqlite3";
import { runCastCheck } from "@book-forge/agents";
import type { StructuredUsage } from "@book-forge/llm";
import {
  castCheckBasisOf,
  castCheckReportSchema,
  castCheckToolSchema,
  isCastCheckStale,
  renderCastForCheck,
  type CastCheckReport,
} from "@book-forge/shared";

/**
 * Проверка различий состава (ТЗ 9.1, этап 5 слайс 4).
 *
 * Отчёт ничего не меняет: героев правит только автор. Сервер отвечает за
 * два свойства, которых у модельного ответа нет:
 *
 * 1. **Номера героев сверяются с составом.** Пара с выдуманным id
 *    выбрасывается целиком — «похожи Нина и кто-то» нечитаемо.
 * 2. **Отчёт знает, про какой состав он написан.** В нём лежат герои с их
 *    ревизиями, поэтому правка героя делает его устаревшим явно, а не молча.
 */

export interface CastRow {
  id: number;
  canonical_name: string;
  profile_json: string | null;
  revision: number;
}

export interface CastCheckResult {
  report: CastCheckReport;
  /** Пар, выброшенных из-за номера, которого в составе нет. */
  droppedPairs: number;
}

export function loadCast(sqlite: DatabaseType, bookId: number): CastRow[] {
  return sqlite
    .prepare(
      "SELECT id, canonical_name, profile_json, revision FROM characters WHERE book_id = ? ORDER BY id",
    )
    .all(bookId) as CastRow[];
}

/** Профиль разбирается врукопашную: нужны несколько полей, а бросок схемы на
 *  одной негодной строке лишил бы проверки весь состав — та же причина, что
 *  у `loadCanonCast` в studio-context. */
function profileOf(row: CastRow): Record<string, unknown> {
  if (!row.profile_json) return {};
  try {
    const parsed = JSON.parse(row.profile_json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readStoredCastCheck(
  sqlite: DatabaseType,
  bookId: number,
): { report: CastCheckReport | null; stale: boolean } {
  const row = sqlite
    .prepare("SELECT cast_check_json FROM books WHERE id = ?")
    .get(bookId) as { cast_check_json: string | null } | undefined;
  if (!row?.cast_check_json) return { report: null, stale: false };
  const parsed = castCheckReportSchema.safeParse(JSON.parse(row.cast_check_json));
  // Негодная строка — то же, что её отсутствие: показывать половину отчёта
  // хуже, чем предложить проверить заново.
  if (!parsed.success) return { report: null, stale: false };
  const cast = loadCast(sqlite, bookId);
  return { report: parsed.data, stale: isCastCheckStale(parsed.data, cast) };
}

export async function performCastCheck(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    bookTitle: string;
    premise: string | null;
    onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
  },
): Promise<CastCheckResult> {
  const cast = loadCast(sqlite, args.bookId);
  const castBlock = renderCastForCheck(
    cast.map((c) => ({ id: c.id, name: c.canonical_name, profile: profileOf(c) })),
  );

  const raw = await runCastCheck({
    bookTitle: args.bookTitle,
    premise: args.premise,
    castBlock,
    ...(args.onUsage ? { onUsage: args.onUsage } : {}),
  });
  const parsed = castCheckToolSchema.parse(raw);

  const known = new Set(cast.map((c) => c.id));
  const kept = parsed.pairs.filter((p) => p.characterIds.every((id) => known.has(id)));
  const droppedPairs = parsed.pairs.length - kept.length;
  if (droppedPairs > 0) {
    console.warn(
      `[cast-check] книга ${args.bookId}: пар с номерами вне состава — ${droppedPairs}`,
    );
  }

  const report: CastCheckReport = {
    generatedAt: new Date().toISOString(),
    basis: castCheckBasisOf(cast),
    pairs: kept,
    notes: parsed.notes,
  };
  sqlite
    .prepare("UPDATE books SET cast_check_json = ? WHERE id = ?")
    .run(JSON.stringify(report), args.bookId);
  return { report, droppedPairs };
}
