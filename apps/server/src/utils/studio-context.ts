import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  type BookConcept,
} from "@book-forge/shared";

export interface StudioContextAspect {
  name: string;
  payload: string;
}

export interface StudioContext {
  concept: BookConcept | null;
  worldAspects: StudioContextAspect[];
  loreAspects: StudioContextAspect[];
}

export function loadStudioContext(
  sqlite: DatabaseType,
  bookId: number,
): StudioContext {
  const row = sqlite
    .prepare("SELECT concept, studio_state FROM books WHERE id = ?")
    .get(bookId) as
    | { concept: string | null; studio_state: string | null }
    | undefined;
  if (!row) {
    return { concept: null, worldAspects: [], loreAspects: [] };
  }
  let concept: BookConcept | null = null;
  if (row.concept) {
    try {
      concept = bookConceptSchema.parse(JSON.parse(row.concept));
    } catch {
      concept = null;
    }
  }
  let worldAspects: StudioContextAspect[] = [];
  let loreAspects: StudioContextAspect[] = [];
  if (row.studio_state) {
    try {
      const state = studioStateSchema.parse(JSON.parse(row.studio_state));
      worldAspects = extractMarkdownAspects(state.stages.world?.aspects ?? []);
      loreAspects = extractMarkdownAspects(state.stages.lore?.aspects ?? []);
    } catch {
      // ignore corrupt studio_state
    }
  }
  return { concept, worldAspects, loreAspects };
}

function extractMarkdownAspects(
  aspects: ReadonlyArray<{
    name: string;
    status: string;
    payloadKind: string;
    finalPayload?: unknown;
    order: number;
  }>,
): StudioContextAspect[] {
  return aspects
    .filter(
      (a) =>
        a.status === "accepted" &&
        a.payloadKind === "markdown" &&
        typeof a.finalPayload === "string",
    )
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ name: a.name, payload: a.finalPayload as string }));
}

export function studioContextToPrompt(ctx: StudioContext): string | null {
  const parts: string[] = [];

  if (ctx.concept) {
    const c = ctx.concept;
    const conceptLines: string[] = [];
    const allGenres = [...c.genres, ...(c.customGenres ?? [])];
    if (allGenres.length > 0) {
      conceptLines.push(`Жанры: ${allGenres.join(", ")}`);
    }
    const allTones = [...c.tones, ...(c.customTones ?? [])];
    if (allTones.length > 0) {
      conceptLines.push(`Тон: ${allTones.join(", ")}`);
    }
    conceptLines.push(`Аудитория: ${c.audience}`);
    if (c.premise.protagonist) {
      conceptLines.push(`Протагонист: ${c.premise.protagonist}`);
    }
    if (c.premise.conflict) {
      conceptLines.push(`Конфликт: ${c.premise.conflict}`);
    }
    if (c.premise.stakes) {
      conceptLines.push(`Ставки: ${c.premise.stakes}`);
    }
    if (c.premise.logline) {
      conceptLines.push(`Логлайн: ${c.premise.logline}`);
    }
    if (conceptLines.length > 0) {
      parts.push(`## Концепт\n${conceptLines.join("\n")}`);
    }
  }

  if (ctx.worldAspects.length > 0) {
    const blocks = ctx.worldAspects
      .map((a) => `### ${a.name}\n${a.payload}`)
      .join("\n\n");
    parts.push(`## Мир\n${blocks}`);
  }

  if (ctx.loreAspects.length > 0) {
    const blocks = ctx.loreAspects
      .map((a) => `### ${a.name}\n${a.payload}`)
      .join("\n\n");
    parts.push(`## Лор\n${blocks}`);
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
