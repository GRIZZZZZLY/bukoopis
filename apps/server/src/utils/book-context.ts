import type { Database as DatabaseType } from "better-sqlite3";
import type { LocalModelRef } from "@book-forge/llm";
import type { BookOutline } from "@book-forge/shared";
import { derivePremiseFromConcept, loadStudioContext } from "./studio-context.js";
import type { BookRow } from "../db/rows.js";
import { aspectModelLabel } from "./aspect-model-label.js";

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
  studioProvider: "anthropic" | "ollama";
  studioLocalModel: string | null;
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
        // generatedBy — метка для автора, в промпты и хеш не идёт.
        const { generatedBy: _g, ...variant } = parsed.variants[
          parsed.selectedIndex
        ] as unknown as Record<string, unknown>;
        outlineSelected = JSON.stringify(variant);
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
    studioProvider: (row.studio_provider as "anthropic" | "ollama") ?? "anthropic",
    studioLocalModel: row.studio_local_model,
  };
}


/** Готовый фрагмент опций для агента мастерской: `{ local }` или `{}`. */
export function studioLocalOpt(
  sqlite: DatabaseType,
  bookId: number,
): { local?: LocalModelRef } {
  const ctx = loadBookContext(sqlite, bookId);
  const local = ctx ? studioLocal(ctx) : undefined;
  return local ? { local } : {};
}

/** Локальная модель для заданий мастерской: только когда книга выбрала
 *  Ollama и модель названа. Иначе `undefined` — задание идёт в Claude. */
export function studioLocal(ctx: BookContext): LocalModelRef | undefined {
  if (ctx.studioProvider !== "ollama") return undefined;
  const model = ctx.studioLocalModel?.trim();
  // Половина переключателя — ошибка, а не тихий уход в платный Claude.
  if (!model) {
    throw new Error(
      "Мастерская переключена на локальную модель, но название модели не задано: укажите его в настройках книги.",
    );
  }
  return { model };
}

/** Подпись модели для варианта аспекта: `ollama:<тег>` на локальной книге,
 *  иначе прежняя подпись Claude. */
export function aspectLabelFor(
  agent: Parameters<typeof aspectModelLabel>[0],
  local?: LocalModelRef,
): string {
  return local ? `ollama:${local.model}` : aspectModelLabel(agent);
}

/** Метка происхождения для питчей и вариантов плана: `ollama:<тег>`, когда их
 *  сочинила локальная модель. Без `local` объекты отдаются как есть. */
export function stampGeneratedBy<T extends object>(items: T[], local?: LocalModelRef): T[] {
  return local ? items.map((x) => ({ ...x, generatedBy: `ollama:${local.model}` })) : items;
}
