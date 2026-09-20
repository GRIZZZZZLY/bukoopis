import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  normalizeConcept,
  type BookConcept,
} from "@book-forge/shared";

export interface StudioContextAspect {
  name: string;
  payload: string;
}

/** Строка канонического состава: имя и, если есть, роль одной строкой.
 *  Карточку героя со знаниями и целями собирает `gatherCharacterContext` на
 *  границе сцены; здесь нужен только список имён. */
export interface StudioContextCharacter {
  name: string;
  role: string | null;
}

export interface StudioContext {
  concept: BookConcept | null;
  /** Утверждённый состав книги (`characters`). Планировщик книги и главы
   *  видели только замысел, и питч с составом расходились в именах: план звал
   *  героиню как питч, канон — как состав, и события памяти отвергались с
   *  «имя героя не разрешилось» (живой прогон 2026-09-20). */
  characters: StudioContextCharacter[];
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
    return {
      concept: null,
      characters: [],
      worldAspects: [],
      loreAspects: [],
      plotAspects: [],
    };
  }
  let concept: BookConcept | null = null;
  if (row.concept) {
    try {
      concept = normalizeConcept(bookConceptSchema.parse(JSON.parse(row.concept)));
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
  return {
    concept,
    characters: loadCanonCast(sqlite, bookId),
    worldAspects,
    loreAspects,
    plotAspects,
  };
}

/** Профиль читается врукопашную, без `characterProfileV2Schema`: здесь нужны
 *  имя и роль, а одна негодная строка не должна лишать планировщик всего
 *  состава — ровно та потеря, из-за которой `toCharacter` когда-то ронял
 *  `GET /books/:id/characters` на всю книгу. */
function loadCanonCast(
  sqlite: DatabaseType,
  bookId: number,
): StudioContextCharacter[] {
  const rows = sqlite
    .prepare(
      "SELECT canonical_name, profile_json FROM characters WHERE book_id = ? ORDER BY id",
    )
    .all(bookId) as Array<{ canonical_name: string; profile_json: string | null }>;
  return rows.map((r) => {
    let role: string | null = null;
    if (r.profile_json) {
      try {
        const parsed = JSON.parse(r.profile_json) as { role?: unknown };
        if (typeof parsed.role === "string" && parsed.role.trim()) {
          role = parsed.role.trim();
        }
      } catch {
        // Имя — это всё, ради чего список собирается; роль необязательна.
      }
    }
    return { name: r.canonical_name, role };
  });
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

  if (ctx.characters.length > 0) {
    const lines = ctx.characters.map((ch) =>
      ch.role ? `- ${ch.name} — ${ch.role}` : `- ${ch.name}`,
    );
    parts.push(
      `## Персонажи книги (канон)\n${lines.join("\n")}\n` +
        "Звать героев только этими именами. Замысел выше мог называть их иначе — канон сильнее: имя из этого списка и есть имя героя в книге.",
    );
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
