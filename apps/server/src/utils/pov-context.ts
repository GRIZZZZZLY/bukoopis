import type { Database as DatabaseType } from "better-sqlite3";
import {
  ACQUISITION_LABELS,
  acquisitionModeSchema,
  boundaryForChapter,
} from "@book-forge/shared";
import { resolveEntity } from "./entity-resolve.js";
import { loadKnowledgeAtBoundary } from "./character-events.js";

/**
 * ADR 0003 slice 3b — POV knowledge layer, переведён на события (этап 3).
 *
 * Объективный канон (`renderActiveFactsPrompt`) — то, что ИСТИННО в мире;
 * здесь — то, что POV-герой успел узнать. Писателю сказано, что вслух и в
 * мыслях герой может опираться только на это.
 *
 * Читается на границе сцены и ИСКЛЮЧАЮЩЕ: входя в главу N, герой ещё не
 * знает того, что узнает в ней самой (AC-07). Прежняя версия читала
 * `character_knowledge` с `order_index <= N` — включающе и из таблицы, в
 * которую после этапа 3 никто не пишет: авторская правка знаний не
 * доходила бы до Писателя вовсе, а удалённая — продолжала бы доходить.
 */

export interface PovKnowledge {
  povName: string;
  facts: string[];
}

export function loadPovKnowledge(
  sqlite: DatabaseType,
  bookId: number,
  povName: string,
  chapterId: number,
): PovKnowledge {
  const resolved = resolveEntity(sqlite, bookId, "character", povName);
  if (!resolved) return { povName, facts: [] };
  const events = loadKnowledgeAtBoundary(
    sqlite,
    resolved.entityId,
    boundaryForChapter(bookId, chapterId, null),
  );
  const facts = events.map((e) => {
    const d = e.data as { fact?: unknown; acquisition?: unknown; source?: unknown };
    const fact = typeof d.fact === "string" ? d.fact : "";
    // Как узнал — половина смысла этапа. Список без этого возвращает героя,
    // для которого услышанное и увиденное одно и то же.
    // `unknown` подписи не имеет: у перенесённых и введённых вручную знаний
    // происхождения нет, и «видел сам» вместо него — выдуманное сведение.
    const mode = acquisitionModeSchema.safeParse(d.acquisition);
    const how = mode.success ? ACQUISITION_LABELS[mode.data] || null : null;
    const from = typeof d.source === "string" && d.source.trim() ? d.source.trim() : null;
    const tail = [how, from].filter(Boolean).join(", ");
    return tail ? `${fact} (${tail})` : fact;
  });
  return { povName: resolved.canonicalName, facts: facts.filter((f) => f.length > 0) };
}

export function renderPovKnowledgePrompt(k: PovKnowledge): string | null {
  if (k.facts.length === 0) return null;
  const lines = k.facts.map((f) => `- ${f}`);
  return `## Известно POV-персонажу (${k.povName})\nТолько это персонаж знает и может думать/говорить как своё знание. В скобках — откуда знает: услышанное и выведенное не равны увиденному своими глазами.\n${lines.join("\n")}`;
}
