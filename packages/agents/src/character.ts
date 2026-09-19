import type { Database as DatabaseType } from "better-sqlite3";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  selectVoiceSamples,
  VOICE_SITUATION_LABELS,
  RELATIONSHIP_QUALITY_LABELS,
  ACQUISITION_LABELS,
  type Character,
  type Relationship,
  type CharacterVoiceSample,
  type VoiceSampleSituation,
  type VoiceSampleOrigin,
  type VoiceSampleStatus,
  type RelationshipQualityKey,
  type SceneBoundary,
  type ActiveState,
  type CharacterEvent,
  type CharacterEventKind,
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

/**
 * События персонажа на начало сцены (читаются только если boundary задана).
 * Граница ИСКЛЮЧАЮЩАЯ: начальный контекст строится из событий ДО неё.
 */
function loadCharacterEventsAtBoundary(
  sqlite: DatabaseType,
  characterId: number,
  boundary: SceneBoundary,
): CharacterEvent[] {
  const placeholders = "?";
  const rows = sqlite
    .prepare(
      `SELECT e.* FROM character_events e
       LEFT JOIN chapters ec ON ec.id = e.chapter_id
       WHERE e.subject_character_id = ?
         AND e.verification IN ('derived','confirmed')
         AND (
           e.chapter_id IS NULL
           OR ec.order_index < (SELECT order_index FROM chapters WHERE id = ?)
         )
       ORDER BY e.id ASC`,
    )
    .all(characterId, boundary.chapterId) as Array<{
    id: number;
    book_id: number;
    subject_character_id: number;
    addressee_character_id: number | null;
    kind: string;
    data_json: string;
    chapter_id: number | null;
    scene_ordinal: number;
    source_version_id: number | null;
    evidence_quote: string | null;
    evidence_start: number | null;
    evidence_end: number | null;
    origin: string;
    verification: string;
    created_at: string;
  }>;

  return rows.map((r) => {
    let data: unknown;
    try {
      data = JSON.parse(r.data_json);
    } catch {
      data = {};
    }
    return {
      id: r.id,
      bookId: r.book_id,
      subjectCharacterId: r.subject_character_id,
      addresseeCharacterId: r.addressee_character_id,
      kind: r.kind as CharacterEventKind,
      data,
      chapterId: r.chapter_id,
      sceneOrdinal: r.scene_ordinal,
      sourceVersionId: r.source_version_id,
      evidenceQuote: r.evidence_quote,
      evidenceStart: r.evidence_start,
      evidenceEnd: r.evidence_end,
      origin: r.origin,
      verification: r.verification,
      createdAt: r.created_at,
    } as CharacterEvent;
  });
}

/**
 * Знания персонажа на границе сцены. Опровергнутое знание не возвращается.
 */
function loadCharacterKnowledgeAtBoundary(
  sqlite: DatabaseType,
  characterId: number,
  boundary: SceneBoundary,
): CharacterKnowledge[] {
  const events = loadCharacterEventsAtBoundary(sqlite, characterId, boundary);
  const order = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;

  return events
    .filter((e) => {
      if (e.kind !== "knowledge") return false;
      const d = e.data as { disprovedFromChapterOrder: number | null };
      if (d.disprovedFromChapterOrder === null || !order) return true;
      return d.disprovedFromChapterOrder > order.order_index;
    })
    .map((e) => {
      const d = e.data as {
        fact?: unknown;
        acquisition?: unknown;
        source?: unknown;
        canonFactId?: unknown;
        disprovedFromChapterOrder?: unknown;
      };
      return {
        fact: typeof d.fact === "string" ? d.fact : "",
        acquisition: typeof d.acquisition === "string" ? d.acquisition : "unknown",
        source: typeof d.source === "string" ? d.source : null,
        canonFactId: typeof d.canonFactId === "number" ? d.canonFactId : null,
        disprovedFromChapterOrder: typeof d.disprovedFromChapterOrder === "number" ? d.disprovedFromChapterOrder : null,
      };
    });
}

/**
 * Эпизодические состояния персонажа на границе сцены.
 * Состояние считается свежим, если наблюдалось в одной из последних трёх глав.
 */
function loadCharacterStatesAtBoundary(
  sqlite: DatabaseType,
  characterIds: number[],
  boundary: SceneBoundary,
): ActiveState[] {
  if (characterIds.length === 0) return [];
  const FRESHNESS_THRESHOLD = 3;
  const placeholders = characterIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT e.*, ec.order_index as chapter_order
       FROM character_events e
       LEFT JOIN chapters ec ON ec.id = e.chapter_id
       WHERE e.subject_character_id IN (${placeholders})
         AND e.kind = 'state'
         AND e.verification IN ('derived','confirmed')
         AND (
           e.chapter_id IS NULL
           OR ec.order_index < (SELECT order_index FROM chapters WHERE id = ?)
         )
       ORDER BY e.id DESC`,
    )
    .all(...characterIds, boundary.chapterId) as Array<{
    subject_character_id: number;
    chapter_order: number | null;
    data_json: string;
  }>;

  const boundaryOrder = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;

  const result: ActiveState[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    if (seen.has(row.subject_character_id)) continue;
    seen.add(row.subject_character_id);

    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      data = {};
    }

    const d = data as { state?: unknown; endCondition?: unknown };
    const state = typeof d.state === "string" ? d.state : "";
    const endCondition = typeof d.endCondition === "string" ? d.endCondition : null;

    if (!state) continue;

    const observedAtChapterOrder = row.chapter_order ?? 0;
    const isFresh =
      boundaryOrder &&
      observedAtChapterOrder >= boundaryOrder.order_index - FRESHNESS_THRESHOLD;

    result.push({
      subjectCharacterId: row.subject_character_id,
      state,
      endCondition,
      observedAtChapterOrder,
      certainty: isFresh ? "fresh" : "stale",
    });
  }

  return result;
}

/**
 * Знание персонажа как событие (ТЗ этап 3, раздел 12). Форма, которую
 * читает контекст из таблицы знаний, теперь замена на события.
 */
export interface CharacterKnowledge {
  fact: string;
  acquisition: string;
  source: string | null;
  canonFactId: number | null;
  disprovedFromChapterOrder: number | null;
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
  /** Эпизодические состояния персонажей. */
  states: ActiveState[];
}

// Detect characters mentioned in any of the provided text blobs by canonical
// name substring match (case-insensitive). `alwaysIncludeIds` covers protagonist/POV.
export function gatherCharacterContext(
  sqlite: DatabaseType,
  bookId: number,
  texts: Array<string | null | undefined>,
  alwaysIncludeIds: number[] = [],
  boundary?: SceneBoundary,
): CharacterAgentResult {
  const allCharacters = sqlite
    .prepare("SELECT * FROM characters WHERE book_id = ?")
    .all(bookId) as CharacterRow[];
  if (allCharacters.length === 0) {
    return { characters: [], relationships: [], voiceSamples: [], states: [] };
  }

  const blob = texts.filter(Boolean).join("\n").toLowerCase();
  const mentioned = new Set<number>(alwaysIncludeIds);
  for (const c of allCharacters) {
    const name = c.canonical_name.toLowerCase();
    if (!name) continue;
    if (blob.includes(name)) mentioned.add(c.id);
  }
  if (mentioned.size === 0) {
    return { characters: [], relationships: [], voiceSamples: [], states: [] };
  }

  const ids = [...mentioned];
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT * FROM characters WHERE id IN (${placeholders}) ORDER BY canonical_name ASC`,
    )
    .all(...ids) as CharacterRow[];

  const characters: CharacterContext[] = rows.map((r) => {
    let knowledge: CharacterKnowledge[] = [];
    if (boundary) {
      knowledge = loadCharacterKnowledgeAtBoundary(sqlite, r.id, boundary);
    }
    return {
      character: rowToCharacter(r),
      knowledge,
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

  let states: ActiveState[] = [];
  if (boundary) {
    states = loadCharacterStatesAtBoundary(sqlite, ids, boundary);
  }

  return {
    characters,
    relationships: rels.map(rowToRelationship),
    voiceSamples: voiceRows.map(rowToVoiceSample),
    states,
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

  const statesFor = (characterId: number) =>
    result.states.filter((s) => s.subjectCharacterId === characterId);

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
      for (const k of ctx.knowledge) {
        const acqLabel = ACQUISITION_LABELS[k.acquisition as keyof typeof ACQUISITION_LABELS] || "";
        const sourceLabel = k.source ? k.source : null;
        const tail = [acqLabel, sourceLabel].filter(Boolean).join(", ");
        lines.push(`  · ${k.fact}${tail ? ` (${tail})` : ""}`);
      }
    }

    const myStates = statesFor(c.id);
    if (myStates.length > 0) {
      lines.push("- Сейчас с ним:");
      for (const s of myStates) {
        const desc =
          s.certainty === "stale"
            ? `${s.state} (наблюдалось в главе ${s.observedAtChapterOrder})`
            : s.state;
        lines.push(`  · ${desc}`);
      }
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
      if (Array.isArray(r.profile.disputes) && r.profile.disputes.length > 0) {
        lines.push(`  · разногласия: ${r.profile.disputes.join(", ")}`);
      }
      if (Array.isArray(r.profile.silences) && r.profile.silences.length > 0) {
        lines.push(`  · умолчания: ${r.profile.silences.join(", ")}`);
      }
    }
  }
  return lines.join("\n");
}
