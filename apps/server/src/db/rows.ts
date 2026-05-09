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
  CharacterProfile,
  LocationProfile,
  ItemProfile,
  WriterProvider,
} from "@book-forge/shared";
import {
  characterProfileSchema,
  locationProfileSchema,
  itemProfileSchema,
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

export function toCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    bookId: r.book_id,
    canonicalName: r.canonical_name,
    profile: safeProfile<CharacterProfile>(r.profile_json, characterProfileSchema),
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
