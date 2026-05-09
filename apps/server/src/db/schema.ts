import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const health = sqliteTable("_health", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
});

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    language: text("language").notNull().default("ru"),
    premise: text("premise"),
    outlineJson: text("outline_json"),
    styleProfileId: integer("style_profile_id").references(
      (): AnySQLiteColumn => styleProfiles.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("draft"),
    writerModel: text("writer_model").notNull().default("opus"),
    plotModel: text("plot_model").notNull().default("sonnet"),
    criticModel: text("critic_model").notNull().default("sonnet"),
    writerProvider: text("writer_provider").notNull().default("anthropic"),
    writerLocalModel: text("writer_local_model"),
    concept: text("concept"),
    studioState: text("studio_state"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "books_status_check",
      sql`${t.status} IN ('draft','active','archived')`,
    ),
    check(
      "books_writer_model_check",
      sql`${t.writerModel} IN ('sonnet','opus')`,
    ),
    check(
      "books_plot_model_check",
      sql`${t.plotModel} IN ('sonnet','opus')`,
    ),
    check(
      "books_critic_model_check",
      sql`${t.criticModel} IN ('sonnet','opus')`,
    ),
    check(
      "books_writer_provider_check",
      sql`${t.writerProvider} IN ('anthropic','ollama')`,
    ),
  ],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    intent: text("intent"),
    planJson: text("plan_json"),
    currentVersionId: integer("current_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_chapters_book_order").on(t.bookId, t.orderIndex),
    check(
      "chapters_status_check",
      sql`${t.status} IN ('draft','in_review','final')`,
    ),
  ],
);

// ─────────────── Knowledge layer (etap 3) ───────────────

export const characters = sqliteTable(
  "characters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    profileJson: text("profile_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_characters_book").on(t.bookId)],
);

export const locations = sqliteTable(
  "locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    profileJson: text("profile_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_locations_book").on(t.bookId)],
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    profileJson: text("profile_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_items_book").on(t.bookId)],
);

export const hooks = sqliteTable(
  "hooks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    seedChapterId: integer("seed_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    expectedResolutionChapterOrder: integer(
      "expected_resolution_chapter_order",
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_hooks_book_status").on(t.bookId, t.status),
    check(
      "hooks_status_check",
      sql`${t.status} IN ('open','mentioned','resolved','deferred')`,
    ),
  ],
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    fromCharacterId: integer("from_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    toCharacterId: integer("to_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    tension: real("tension").notNull().default(0),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_relationships_book").on(t.bookId),
    index("idx_relationships_from").on(t.fromCharacterId),
  ],
);

// ─────────────── Style profiles + reference corpora (etap 7) ───────────────

export const styleProfiles = sqliteTable(
  "style_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    language: text("language").notNull().default("ru"),
    description: text("description"),
    fingerprintJson: text("fingerprint_json"),
    fatigueWordsJson: text("fatigue_words_json"),
    lastExtractedAt: text("last_extracted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const referenceCorpora = sqliteTable(
  "reference_corpora",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => styleProfiles.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    format: text("format").notNull(),
    language: text("language").notNull().default("ru"),
    rawText: text("raw_text").notNull(),
    charCount: integer("char_count").notNull(),
    sceneCount: integer("scene_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_ref_corpora_profile").on(t.profileId),
    check(
      "ref_format_check",
      sql`${t.format} IN ('txt','md','fb2','epub')`,
    ),
  ],
);

export const referenceScenes = sqliteTable(
  "reference_scenes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    corpusId: integer("corpus_id")
      .notNull()
      .references(() => referenceCorpora.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_ref_scenes_corpus").on(t.corpusId, t.orderIndex)],
);

// ─────────────── LLM usage / cost tracking (Day 2 polish) ───────────────

export const llmUsage = sqliteTable(
  "llm_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    route: text("route").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens")
      .notNull()
      .default(0),
    costUsd: real("cost_usd").notNull().default(0),
    bookId: integer("book_id").references(() => books.id, {
      onDelete: "set null",
    }),
    chapterId: integer("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    versionId: integer("version_id").references(() => chapterVersions.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_llm_usage_created").on(t.createdAt),
    index("idx_llm_usage_book").on(t.bookId, t.createdAt),
  ],
);

export const critiqueReports = sqliteTable(
  "critique_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chapterVersionId: integer("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    reportJson: text("report_json"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("idx_critique_version").on(t.chapterVersionId),
    check(
      "critique_status_check",
      sql`${t.status} IN ('pending','done','error')`,
    ),
  ],
);

export const characterKnowledge = sqliteTable(
  "character_knowledge",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    learnedInChapterId: integer("learned_in_chapter_id").references(
      () => chapters.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_character_knowledge_char").on(t.characterId)],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id").notNull(),
    chapterId: integer("chapter_id").references(() => chapters.id, {
      onDelete: "cascade",
    }),
    chapterOrder: integer("chapter_order"),
    language: text("language").notNull().default("ru"),
    text: text("text").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    tokenCount: integer("token_count").notNull(),
    isReference: integer("is_reference").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_chunks_book_order").on(t.bookId, t.chapterOrder),
    index("idx_chunks_source").on(t.sourceType, t.sourceId),
    check(
      "chunks_source_type_check",
      sql`${t.sourceType} IN ('chapter_version','reference')`,
    ),
  ],
);

// ─────────────── Canon extraction (Day 4 / Knowledge surfacing) ───────────────

export const chapterCanonExtractions = sqliteTable(
  "chapter_canon_extractions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    versionId: integer("version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("pending"),
    payloadJson: text("payload_json").notNull(),
    errorMessage: text("error_message"),
    costUsd: real("cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_canon_extractions_chapter").on(t.chapterId),
    check(
      "canon_extractions_status_check",
      sql`${t.status} IN ('pending','ready','error')`,
    ),
  ],
);

export const entityChapterMentions = sqliteTable(
  "entity_chapter_mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    mentionCount: integer("mention_count").notNull().default(1),
    quote: text("quote"),
    firstSeenAt: text("first_seen_at").notNull(),
  },
  (t) => [
    index("idx_mentions_chapter").on(t.chapterId),
    index("idx_mentions_entity").on(t.entityType, t.entityId),
    index("idx_mentions_book").on(t.bookId),
    check(
      "mentions_entity_type_check",
      sql`${t.entityType} IN ('character','location','item','hook','relationship')`,
    ),
  ],
);

export const chapterVersions = sqliteTable(
  "chapter_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    parentVersionId: integer("parent_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
    ),
    contentJson: text("content_json").notNull(),
    contentText: text("content_text").notNull(),
    wordCount: integer("word_count").notNull(),
    source: text("source").notNull().default("manual"),
    branchLabel: text("branch_label"),
    summary: text("summary"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_chapter_versions_chapter_created").on(
      t.chapterId,
      t.createdAt,
    ),
    check(
      "chapter_versions_source_check",
      sql`${t.source} IN ('manual','agent')`,
    ),
  ],
);

// ─────────────── Studio audit (Phase A) ───────────────

export const studioEvents = sqliteTable(
  "studio_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    stageId: text("stage_id"),
    aspectId: text("aspect_id"),
    payload: text("payload").notNull(),
    revisionBefore: integer("revision_before").notNull(),
    revisionAfter: integer("revision_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_studio_events_book_created").on(t.bookId, t.createdAt),
    check(
      "studio_events_event_type_check",
      sql`${t.eventType} IN (
        'accept_variant','reject_variant','refine_variant','regen_variant',
        'materialize_entity_set','entity_review_decision',
        'import_merge','cross_book_copy','stage_skip',
        'playbook_generate','aspect_create_manual','aspect_delete'
      )`,
    ),
  ],
);
