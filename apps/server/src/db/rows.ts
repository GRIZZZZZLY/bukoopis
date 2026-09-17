import type {
  Book,
  Chapter,
  ChapterStatus,
  ChapterVersion,
  BookStatus,
  ModelChoice,
  VersionSource,
  Character,
  CharacterKnowledge,
  Hook,
  HookStatus,
  Item,
  Location,
  Relationship,
  CharacterVoiceSample,
  LocationProfile,
  ItemProfile,
  WriterProvider,
  StudioEventType,
  StudioEventPayload,
} from "@book-forge/shared";
import {
  characterVoiceSampleSchema,
  locationProfileSchema,
  itemProfileSchema,
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  studioEventTypeSchema,
  studioEventPayloadSchema,
} from "@book-forge/shared";

export interface BookRow {
  id: number;
  title: string;
  language: string;
  premise: string | null;
  outline_json: string | null;
  style_profile_id: number | null;
  status: string;
  writer_model: string;
  plot_model: string;
  critic_model: string;
  writer_provider: string;
  writer_local_model: string | null;
  concept: string | null;
  studio_state: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChapterRow {
  id: number;
  book_id: number;
  order_index: number;
  title: string;
  intent: string | null;
  plan_json: string | null;
  current_version_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ChapterVersionRow {
  id: number;
  chapter_id: number;
  parent_version_id: number | null;
  content_json: string;
  content_text: string;
  word_count: number;
  source: string;
  branch_label: string | null;
  summary: string | null;
  created_at: string;
}

export function toBook(r: BookRow): Book {
  return {
    id: r.id,
    title: r.title,
    language: r.language,
    premise: r.premise,
    outlineJson: r.outline_json,
    styleProfileId: r.style_profile_id,
    status: r.status as BookStatus,
    writerModel: r.writer_model as ModelChoice,
    plotModel: r.plot_model as ModelChoice,
    criticModel: r.critic_model as ModelChoice,
    writerProvider: r.writer_provider as WriterProvider,
    writerLocalModel: r.writer_local_model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toChapter(r: ChapterRow): Chapter {
  return {
    id: r.id,
    bookId: r.book_id,
    orderIndex: r.order_index,
    title: r.title,
    intent: r.intent,
    planJson: r.plan_json,
    currentVersionId: r.current_version_id,
    status: r.status as ChapterStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toVersion(r: ChapterVersionRow): ChapterVersion {
  return {
    id: r.id,
    chapterId: r.chapter_id,
    parentVersionId: r.parent_version_id,
    contentJson: r.content_json,
    contentText: r.content_text,
    wordCount: r.word_count,
    source: r.source as VersionSource,
    branchLabel: r.branch_label,
    summary: r.summary ?? null,
    createdAt: r.created_at,
  };
}

// ─────────────── Knowledge entities (etap 3) ───────────────

export interface CharacterRow {
  id: number;
  book_id: number;
  canonical_name: string;
  profile_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface LocationRow {
  id: number;
  book_id: number;
  name: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
}
export interface ItemRow {
  id: number;
  book_id: number;
  name: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
}
export interface HookRow {
  id: number;
  book_id: number;
  seed_chapter_id: number | null;
  description: string;
  status: string;
  expected_resolution_chapter_order: number | null;
  created_at: string;
  updated_at: string;
}
export interface RelationshipRow {
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

export interface CharacterVoiceSampleRow {
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
export interface CharacterKnowledgeRow {
  id: number;
  character_id: number;
  fact: string;
  learned_in_chapter_id: number | null;
  created_at: string;
}

function safeProfile<T>(json: string, schema: { parse: (v: unknown) => T }): T {
  return schema.parse(JSON.parse(json));
}

/** Строка базы может содержать что угодно: импорт, ответ модели, ручную
 *  правку файла. Текст нечитаемого JSON сохраняется — нормализатор положит
 *  его в `extra`, и автор увидит, что чинить. */
function parseJsonOrNull(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { rawProfileJson: json };
  }
}

/** Профиль читается нормализатором, а не `schema.parse`: одно исключение
 *  здесь означает, что `GET /books/:id/characters` перестал отвечать на
 *  всю книгу из-за одной кривой строки. */
export function toCharacter(r: CharacterRow): Character {
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

export function toLocation(r: LocationRow): Location {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    profile: safeProfile<LocationProfile>(r.profile_json, locationProfileSchema),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    profile: safeProfile<ItemProfile>(r.profile_json, itemProfileSchema),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toHook(r: HookRow): Hook {
  return {
    id: r.id,
    bookId: r.book_id,
    seedChapterId: r.seed_chapter_id,
    description: r.description,
    status: r.status as HookStatus,
    expectedResolutionChapterOrder: r.expected_resolution_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toRelationship(r: RelationshipRow): Relationship {
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

/** `parse` здесь допустим: значения приходят из колонок с CHECK-ограничениями,
 *  свободного JSON в строке нет. */
export function toVoiceSample(r: CharacterVoiceSampleRow): CharacterVoiceSample {
  return characterVoiceSampleSchema.parse({
    id: r.id,
    bookId: r.book_id,
    characterId: r.character_id,
    text: r.text,
    situation: r.situation,
    addresseeCharacterId: r.addressee_character_id,
    note: r.note,
    origin: r.origin,
    status: r.status,
    sourceVersionId: r.source_version_id,
    sourceChapterOrder: r.source_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

export function toCharacterKnowledge(r: CharacterKnowledgeRow): CharacterKnowledge {
  return {
    id: r.id,
    characterId: r.character_id,
    fact: r.fact,
    learnedInChapterId: r.learned_in_chapter_id,
    createdAt: r.created_at,
  };
}

// ─────────────── Studio events (Phase 4) ───────────────

export interface StudioEventRow {
  id: number;
  book_id: number;
  event_type: string;
  stage_id: string | null;
  aspect_id: string | null;
  payload: string;
  revision_before: number;
  revision_after: number;
  created_at: string;
}

export interface StudioEvent {
  id: number;
  bookId: number;
  eventType: StudioEventType;
  stageId: string | null;
  aspectId: string | null;
  payload: StudioEventPayload;
  revisionBefore: number;
  revisionAfter: number;
  createdAt: string;
}

export function toStudioEvent(r: StudioEventRow): StudioEvent {
  return {
    id: r.id,
    bookId: r.book_id,
    eventType: studioEventTypeSchema.parse(r.event_type),
    stageId: r.stage_id,
    aspectId: r.aspect_id,
    payload: studioEventPayloadSchema.parse(JSON.parse(r.payload)),
    revisionBefore: r.revision_before,
    revisionAfter: r.revision_after,
    createdAt: r.created_at,
  };
}
