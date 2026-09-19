import type { Database as DatabaseType } from "better-sqlite3";
import type { BookOutline } from "@book-forge/shared";
import { derivePremiseFromConcept, loadStudioContext } from "./studio-context.js";
import type { BookRow } from "../db/rows.js";

/**
 * Книга глазами агентов: название, премиса (выведенная из замысла, когда
 * колонка пуста), выбранный outline, стиль и модели. Жила в маршруте сюжета;
 * вынесена, потому что общая сборка контекста (`generation-context.ts`)
 * тоже читает премису именно так — а импорт из маршрута в утилиту замыкал
 * бы цикл. Маршрут реэкспортирует её для прежних потребителей.
 */
export interface BookContext {
  title: string;
  premise: string;
  language: string;
  outlineSelected: string | null;
  styleProfileId: number | null;
  writerModel: "sonnet" | "opus";
  plotModel: "sonnet" | "opus";
  criticModel: "sonnet" | "opus";
  writerProvider: "anthropic" | "ollama";
  writerLocalModel: string | null;
}

/** Экспортируется ради быстрого сбора ([utils/quick-start-run.ts]): он обязан
 *  собирать вход плана ровно так же, как маршрут генерации, а копия этой
 *  сборки разошлась бы с оригиналом при первой же правке. */
export function loadBookContext(
  sqlite: DatabaseType,
  bookId: number,
): BookContext | null {
  const row = sqlite
    .prepare("SELECT * FROM books WHERE id = ?")
    .get(bookId) as BookRow | undefined;
  if (!row) return null;
  let outlineSelected: string | null = null;
  if (row.outline_json) {
    try {
      const parsed = JSON.parse(row.outline_json) as BookOutline;
      if (
        parsed.selectedIndex !== null &&
        parsed.variants[parsed.selectedIndex]
      ) {
        outlineSelected = JSON.stringify(parsed.variants[parsed.selectedIndex]);
      }
    } catch {
      /* ignore corrupt outline */
    }
  }
  const storedPremise = row.premise?.trim() ? row.premise : null;
  const conceptPremise =
    storedPremise === null
      ? derivePremiseFromConcept(loadStudioContext(sqlite, bookId).concept)
      : null;
  return {
    title: row.title,
    premise: storedPremise ?? conceptPremise ?? "(премиса не задана)",
    language: row.language,
    outlineSelected,
    styleProfileId: row.style_profile_id,
    writerModel: row.writer_model as "sonnet" | "opus",
    plotModel: row.plot_model as "sonnet" | "opus",
    criticModel: row.critic_model as "sonnet" | "opus",
    writerProvider: (row.writer_provider as "anthropic" | "ollama") ?? "anthropic",
    writerLocalModel: row.writer_local_model,
  };
}

