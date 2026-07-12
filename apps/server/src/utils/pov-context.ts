import type { Database as DatabaseType } from "better-sqlite3";
import { resolveEntity } from "./entity-resolve.js";

/**
 * ADR 0003 slice 3b — POV knowledge layer.
 *
 * Objective canon (renderActiveFactsPrompt) is what's TRUE in the world; this
 * is what the POV character has actually learned by the current chapter
 * (character_knowledge, authored/extracted). The Writer is told it may voice
 * only this in the POV's thoughts, keeping author-only knowledge out of the
 * character's head. A knowledge row with no learned_in chapter counts as known
 * from the start.
 */

export interface PovKnowledge {
  povName: string;
  facts: string[];
}

export function loadPovKnowledge(
  sqlite: DatabaseType,
  bookId: number,
  povName: string,
  currentChapterOrder: number,
): PovKnowledge {
  const resolved = resolveEntity(sqlite, bookId, "character", povName);
  if (!resolved) return { povName, facts: [] };
  const rows = sqlite
    .prepare(
      `SELECT k.fact AS fact
       FROM character_knowledge k
       LEFT JOIN chapters c ON c.id = k.learned_in_chapter_id
       WHERE k.character_id = ?
         AND (c.order_index IS NULL OR c.order_index <= ?)
       ORDER BY (c.order_index IS NULL) DESC, c.order_index ASC, k.id ASC`,
    )
    .all(resolved.entityId, currentChapterOrder) as Array<{ fact: string }>;
  return { povName: resolved.canonicalName, facts: rows.map((r) => r.fact) };
}

export function renderPovKnowledgePrompt(k: PovKnowledge): string | null {
  if (k.facts.length === 0) return null;
  const lines = k.facts.map((f) => `- ${f}`);
  return `## Известно POV-персонажу (${k.povName})\nТолько это персонаж знает и может думать/говорить как своё знание:\n${lines.join("\n")}`;
}
