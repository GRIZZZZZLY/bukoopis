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
  plotAspects: StudioContextAspect[];
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
    return { concept: null, worldAspects: [], loreAspects: [], plotAspects: [] };
  }
  let concept: BookConcept | null = null;
  if (row.concept) {
    try {
      concept = bookConceptSchema.parse(JSON.parse(row.concept));
    } catch (e) {
      // Corrupt concept means the agent will generate without genre/tone/premise
      // and the author would never know. Surface it instead of swallowing.
      console.warn(
        `[studio-context] book ${bookId}: corrupt concept JSON — ignoring. Reason:`,
        e instanceof Error ? e.message : e,
      );
      concept = null;
    }
  }
  let worldAspects: StudioContextAspect[] = [];
  let loreAspects: StudioContextAspect[] = [];
  let plotAspects: StudioContextAspect[] = [];
  if (row.studio_state) {
    try {
      const state = studioStateSchema.parse(JSON.parse(row.studio_state));
      worldAspects = extractMarkdownAspects(state.stages.world?.aspects ?? []);
      loreAspects = extractMarkdownAspects(state.stages.lore?.aspects ?? []);
      plotAspects = extractMarkdownAspects(state.stages.plot?.aspects ?? []);
    } catch (e) {
      // Corrupt studio_state means chapters generate with no world/lore/plot context.
      // Log loudly so the degradation is visible rather than silent.
      console.warn(
        `[studio-context] book ${bookId}: corrupt studio_state JSON — world/lore/plot context dropped. Reason:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return { concept, worldAspects, loreAspects, plotAspects };
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

/** Studio never writes the legacy `books.premise` column, so its consumers
 *  (outline agent above all) see nothing unless the concept is folded in here.
 *  Logline first — that is the one premise field every aspect agent already
 *  reads; protagonist/conflict/stakes ride along when the author filled them. */
export function derivePremiseFromConcept(
  concept: BookConcept | null,
): string | null {
  if (!concept) return null;
  const p = concept.premise;
  const lines: string[] = [];
  if (p.logline?.trim()) lines.push(p.logline.trim());
  if (p.protagonist?.trim()) lines.push(`Протагонист: ${p.protagonist.trim()}`);
  if (p.conflict?.trim()) lines.push(`Конфликт: ${p.conflict.trim()}`);
  if (p.stakes?.trim()) lines.push(`Ставки: ${p.stakes.trim()}`);
  if (concept.hook?.trim()) lines.push(`Крючок: ${concept.hook.trim()}`);
  if (lines.length === 0) return null;
  return lines.join("\n");
}

export function studioContextToPrompt(ctx: StudioContext): string | null {
  const parts: string[] = [];

  if (ctx.concept) {
    const c = ctx.concept;
    const conceptLines: string[] = [];
    if (c.genre) conceptLines.push(`Жанр: ${c.genre}`);
    if (c.tone) conceptLines.push(`Тон: ${c.tone}`);
    conceptLines.push(`Аудитория: ${c.audience}`);
    if (c.hook) conceptLines.push(`Крючок: ${c.hook}`);
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

  if (ctx.plotAspects.length > 0) {
    const blocks = ctx.plotAspects
      .map((a) => `### ${a.name}\n${a.payload}`)
      .join("\n\n");
    parts.push(`## Сюжет\n${blocks}`);
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
