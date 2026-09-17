import type { Database as DatabaseType } from "better-sqlite3";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  selectVoiceSamples,
  VOICE_SITUATION_LABELS,
  RELATIONSHIP_QUALITY_LABELS,
  type Character,
  type CharacterKnowledge,
  type Relationship,
  type CharacterVoiceSample,
  type VoiceSampleSituation,
  type VoiceSampleOrigin,
  type VoiceSampleStatus,
  type RelationshipQualityKey,
} from "@book-forge/shared";

interface CharacterRow {
  id: number;
  book_id: number;
  canonical_name: string;
  profile_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
interface KnowledgeRow {
  id: number;
  character_id: number;
  fact: string;
  learned_in_chapter_id: number | null;
  created_at: string;
}
interface RelationshipRow {
  id: number;
  book_id: number;
  from_character_id: number;
  to_character_id: number;
  type: string;
  tension: number;
  notes: string | null;
  profile_json: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}
interface CharacterVoiceSampleRow {
  id: number;
  book_id: number;
  character_id: number;
  text: string;
  situation: string;
  addressee_character_id: number | null;
  note: string | null;
  origin: string;
  status: string;
  source_version_id: number | null;
  source_chapter_order: number | null;
  created_at: string;
  updated_at: string;
}

/** Та же защита, что в `db/rows.ts`: одна кривая строка профиля не должна
 *  срывать сбор контекста для генерации главы. Нечитаемый текст сохраняется —
 *  нормализатор положит его в `extra`. */
function parseJsonOrNull(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { rawProfileJson: json };
  }
}

function rowToCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    bookId: r.book_id,
    canonicalName: r.canonical_name,
    profile: normalizeCharacterProfile(parseJsonOrNull(r.profile_json)),
    revision: r.revision ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToKnowledge(r: KnowledgeRow): CharacterKnowledge {
  return {
    id: r.id,
    characterId: r.character_id,
    fact: r.fact,
    learnedInChapterId: r.learned_in_chapter_id,
    createdAt: r.created_at,
  };
}
function rowToRelationship(r: RelationshipRow): Relationship {
  return {
    id: r.id,
    bookId: r.book_id,
    fromCharacterId: r.from_character_id,
    toCharacterId: r.to_character_id,
    type: r.type,
    tension: r.tension,
    notes: r.notes,
    profile: normalizeRelationshipProfile(parseJsonOrNull(r.profile_json)),
    revision: r.revision ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToVoiceSample(r: CharacterVoiceSampleRow): CharacterVoiceSample {
  return {
    id: r.id,
    bookId: r.book_id,
    characterId: r.character_id,
    text: r.text,
    situation: r.situation as VoiceSampleSituation,
    addresseeCharacterId: r.addressee_character_id,
    note: r.note,
    origin: r.origin as VoiceSampleOrigin,
    status: r.status as VoiceSampleStatus,
    sourceVersionId: r.source_version_id,
    sourceChapterOrder: r.source_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CharacterContext {
  character: Character;
  knowledge: CharacterKnowledge[];
}

export interface CharacterAgentResult {
  characters: CharacterContext[];
  relationships: Relationship[];
  /** Принятые образцы речи всех участников, в стабильном порядке. */
  voiceSamples: CharacterVoiceSample[];
}

// Detect characters mentioned in any of the provided text blobs by canonical
// name substring match (case-insensitive). `alwaysIncludeIds` covers protagonist/POV.
export function gatherCharacterContext(
  sqlite: DatabaseType,
  bookId: number,
  texts: Array<string | null | undefined>,
  alwaysIncludeIds: number[] = [],
): CharacterAgentResult {
  const allCharacters = sqlite
    .prepare("SELECT * FROM characters WHERE book_id = ?")
    .all(bookId) as CharacterRow[];
  if (allCharacters.length === 0) {
    return { characters: [], relationships: [], voiceSamples: [] };
  }

  const blob = texts.filter(Boolean).join("\n").toLowerCase();
  const mentioned = new Set<number>(alwaysIncludeIds);
  for (const c of allCharacters) {
    const name = c.canonical_name.toLowerCase();
    if (!name) continue;
    if (blob.includes(name)) mentioned.add(c.id);
  }
  if (mentioned.size === 0) {
    return { characters: [], relationships: [], voiceSamples: [] };
  }

  const ids = [...mentioned];
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT * FROM characters WHERE id IN (${placeholders}) ORDER BY canonical_name ASC`,
    )
    .all(...ids) as CharacterRow[];
  const characters: CharacterContext[] = rows.map((r) => {
    const knowledge = sqlite
      .prepare(
        "SELECT * FROM character_knowledge WHERE character_id = ? ORDER BY created_at ASC",
      )
      .all(r.id) as KnowledgeRow[];
    return {
      character: rowToCharacter(r),
      knowledge: knowledge.map(rowToKnowledge),
    };
  });

  const rels = sqlite
    .prepare(
      `SELECT * FROM relationships
       WHERE book_id = ?
         AND (from_character_id IN (${placeholders}) OR to_character_id IN (${placeholders}))`,
    )
    .all(bookId, ...ids, ...ids) as RelationshipRow[];

  const voiceRows = sqlite
    .prepare(
      `SELECT * FROM character_voice_samples
       WHERE character_id IN (${placeholders}) AND status = 'accepted'
       ORDER BY id ASC`,
    )
    .all(...ids) as CharacterVoiceSampleRow[];

  return {
    characters,
    relationships: rels.map(rowToRelationship),
    voiceSamples: voiceRows.map(rowToVoiceSample),
  };
}

export function characterContextToPrompt(
  result: CharacterAgentResult,
  charNameById: Map<number, string>,
  options?: { situation?: VoiceSampleSituation; addresseeCharacterId?: number | null; chapterOrder?: number | null },
): string {
  if (result.characters.length === 0) return "";
  const lines: string[] = ["## Персонажи в сцене"];

  const samplesFor = (characterId: number) =>
    result.voiceSamples.filter((s) => s.characterId === characterId);

  for (const ctx of result.characters) {
    const c = ctx.character;
    lines.push(`### ${c.canonicalName}`);
    lines.push(`- Описание: ${c.profile.description}`);
    if (c.profile.want) lines.push(`- Хочет: ${c.profile.want}`);
    if (c.profile.need) lines.push(`- Нуждается: ${c.profile.need}`);
    if (c.profile.lie) lines.push(`- Самообман: ${c.profile.lie}`);
    if (c.profile.voice) lines.push(`- Голос/манера: ${c.profile.voice}`);
    if (c.profile.appearance)
      lines.push(`- Внешность: ${c.profile.appearance}`);
    if (ctx.knowledge.length > 0) {
      lines.push("- Знает:");
      for (const k of ctx.knowledge) lines.push(`  · ${k.fact}`);
    }

    const mine = selectVoiceSamples(samplesFor(c.id), {
      situation: options?.situation ?? "neutral",
      addresseeCharacterId: options?.addresseeCharacterId ?? null,
      excludeFromChapterOrder: options?.chapterOrder ?? null,
    });
    if (mine.length > 0) {
      lines.push("- Образцы речи (диапазон, не образец для копирования):");
      for (const s of mine) {
        lines.push(`  · [${VOICE_SITUATION_LABELS[s.situation]}] ${s.text}`);
      }
    }
  }
  if (result.relationships.length > 0) {
    lines.push("\n## Отношения");
    for (const r of result.relationships) {
      const from = charNameById.get(r.fromCharacterId) ?? `#${r.fromCharacterId}`;
      const to = charNameById.get(r.toCharacterId) ?? `#${r.toCharacterId}`;
      lines.push(
        `- ${from} → ${to}: ${r.type} (tension: ${r.tension.toFixed(2)})${
          r.notes ? ` — ${r.notes}` : ""
        }`,
      );
      for (const key of Object.keys(RELATIONSHIP_QUALITY_LABELS) as RelationshipQualityKey[]) {
        const value = r.profile[key];
        if (typeof value === "string" && value.trim()) {
          const label = RELATIONSHIP_QUALITY_LABELS[key];
          lines.push(`  · ${label}: ${value}`);
        }
      }
    }
  }
  return lines.join("\n");
}
