import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
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
    // ADR 0002: first chapter order whose derived memory (facts/notes/chunks)
    // is stale after an earlier-chapter edit; NULL = memory fresh.
    memoryStaleFromChapterOrder: integer("memory_stale_from_chapter_order"),
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
    // ADR 0002: last version whose memory (chunks/summary/facts/notes) was
    // fully activated. Retrieval reads by this, not current_version_id.
    memoryVersionId: integer("memory_version_id").references(
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
    /** Счётчик правок профиля: оптимистичная блокировка карточки (этап 2 ТЗ
     *  индивидуальности) и номер строки в entity_profile_versions. */
    revision: integer("revision").notNull().default(0),
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
    /** Направленный профиль отношения A→B (DirectedRelationship). NULL —
     *  строка, созданная до этапа 2: нормализация на чтении даёт пустой
     *  профиль, а не ошибку. */
    profileJson: text("profile_json"),
    revision: integer("revision").notNull().default(0),
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
    // 'extracted' — fingerprint came from this profile's own corpus.
    // 'blend' — synthesized from the parents listed in blendConfigJson, which
    // is also where read-time few-shot samples are drawn from.
    kind: text("kind").notNull().default("extracted"),
    blendConfigJson: text("blend_config_json"),
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
      sql`${t.status} IN ('pending','done','partial','error')`,
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

// ─────────────── Durable memory pipeline (ADR 0002) ───────────────

export const memoryJobs = sqliteTable(
  "memory_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: integer("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    pipelineVersion: integer("pipeline_version").notNull().default(1),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: text("run_after"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    lastError: text("last_error"),
    // Staged output (facts/notes extraction payload) — applied to the active
    // tables only by the atomic activation step, never by the job handler.
    resultJson: text("result_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_memory_jobs_claim").on(t.status, t.runAfter, t.bookId),
    index("idx_memory_jobs_version").on(t.chapterVersionId, t.kind),
    check(
      "memory_jobs_kind_check",
      sql`${t.kind} IN ('index','summary','facts','notes','rollup')`,
    ),
    check(
      "memory_jobs_status_check",
      sql`${t.status} IN ('pending','running','retry','done','error','obsolete')`,
    ),
  ],
);

// Time-scoped canon facts (migrations 0012, 0015, 0018). Three orthogonal
// qualifiers ride on every row: `assertion_mode` is epistemic status inside the
// fiction (narrated as fact vs. rumor), `source_kind` is who produced the row,
// and `review_status` is whether the author vetted it. Rejected rows are never
// served to agents.
export const bookFacts = sqliteTable(
  "book_facts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    // Matched by name, not id — the extractor never juggles entity ids.
    entityName: text("entity_name").notNull(),
    predicate: text("predicate").notNull(),
    objectText: text("object_text").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    sourceVersionId: integer("source_version_id"),
    confidence: real("confidence").notNull().default(1.0),
    supersededBy: integer("superseded_by"),
    assertionMode: text("assertion_mode").notNull().default("narrated_as_fact"),
    sourceKind: text("source_kind").notNull().default("llm_extraction"),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_book_facts_lookup").on(
      t.bookId,
      t.entityType,
      t.entityName,
      t.validFromChapter,
    ),
    index("idx_book_facts_active").on(
      t.bookId,
      t.validFromChapter,
      t.validToChapter,
    ),
    index("idx_book_facts_review").on(t.bookId, t.reviewStatus),
    check(
      "book_facts_entity_type_check",
      sql`${t.entityType} IN ('character','location','item','world')`,
    ),
    check(
      "book_facts_assertion_mode_check",
      sql`${t.assertionMode} IN ('narrated_as_fact','directly_observed','stated_by_character','believed_by_character','rumor','dream_or_vision','uncertain')`,
    ),
    check(
      "book_facts_source_kind_check",
      sql`${t.sourceKind} IN ('llm_extraction','manual','accepted_studio','imported_document')`,
    ),
    check(
      "book_facts_review_status_check",
      sql`${t.reviewStatus} IN ('unreviewed','confirmed','disputed','rejected')`,
    ),
  ],
);

// ADR 0003 slice 2: author-managed aliases so canon-fact entity names resolve
// to a stable characters/locations/items id (Russian case forms, nicknames).
export const entityAliases = sqliteTable(
  "entity_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    alias: text("alias").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_entity_aliases_entity").on(t.entityType, t.entityId),
    check(
      "entity_aliases_type_check",
      sql`${t.entityType} IN ('character','location','item')`,
    ),
  ],
);

/** История профилей персонажей и отношений (этап 2 ТЗ индивидуальности).
 *  Одна таблица на оба вида: ссылка полиморфная, как у entityAliases
 *  (entity_type + entity_id, без внешнего ключа). */
export const entityProfileVersions = sqliteTable(
  "entity_profile_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    revision: integer("revision").notNull(),
    profileJson: text("profile_json").notNull(),
    origin: text("origin").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_entity_profile_versions").on(
      t.entityType,
      t.entityId,
      t.revision,
    ),
    index("idx_entity_profile_versions_entity").on(t.entityType, t.entityId),
    index("idx_entity_profile_versions_book").on(t.bookId),
    check(
      "entity_profile_versions_type_check",
      sql`${t.entityType} IN ('character','relationship')`,
    ),
    check(
      "entity_profile_versions_origin_check",
      sql`${t.origin} IN ('author','llm','import','materialize','migration')`,
    ),
    check(
      "entity_profile_versions_revision_check",
      sql`${t.revision} >= 0`,
    ),
  ],
);

/** Банк образцов речи персонажа (раздел 5.2 ТЗ). `source_chapter_order`
 *  хранится рядом с образцом, чтобы реплика из главы 12 не попала в
 *  подготовку главы 4. */
export const characterVoiceSamples = sqliteTable(
  "character_voice_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    situation: text("situation").notNull(),
    addresseeCharacterId: integer("addressee_character_id").references(
      () => characters.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("proposed"),
    sourceVersionId: integer("source_version_id").references(
      () => chapterVersions.id,
      { onDelete: "set null" },
    ),
    sourceChapterOrder: integer("source_chapter_order"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_voice_samples_character").on(t.characterId, t.status),
    index("idx_voice_samples_book").on(t.bookId),
    check(
      "character_voice_samples_situation_check",
      sql`${t.situation} IN ('neutral','conflict','vulnerable','authority','intimate','stranger')`,
    ),
    check(
      "character_voice_samples_origin_check",
      sql`${t.origin} IN ('author','accepted_prose','llm')`,
    ),
    check(
      "character_voice_samples_status_check",
      sql`${t.status} IN ('proposed','accepted','rejected')`,
    ),
    check(
      "character_voice_samples_source_chapter_order_check",
      sql`${t.sourceChapterOrder} IS NULL OR ${t.sourceChapterOrder} >= 0`,
    ),
  ],
);

/** Этап 3 ТЗ индивидуальности персонажей: слой событий персонажа.
 *  Знание — это вид события, а не отдельная таблица: два источника истины
 *  расходятся на первой же правке (раздел 6, решение 5). */
export const characterEvents = sqliteTable(
  "character_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    subjectCharacterId: integer("subject_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    addresseeCharacterId: integer("addressee_character_id").references(
      () => characters.id,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    dataJson: text("data_json").notNull(),
    // Граница сцены. Номер главы НЕ денормализуется: перестановка глав
    // оставила бы тихо неверную границу, а join к chapters всегда верен.
    // CASCADE: пустая глава значит «известно с начала» и видно на любой
    // границе. SET NULL превращал бы секрет удалённой главы 8 в такую
    // запись, и он всплывал бы в подготовке главы 4.
    chapterId: integer("chapter_id").references(() => chapters.id, {
      onDelete: "cascade",
    }),
    sceneOrdinal: integer("scene_ordinal").notNull().default(0),
    // CASCADE: доказательство события живёт в content_text этой версии. Без
    // версии смещения показывают в пустоту, а событие остаётся активным —
    // состояние, которое запрещает AC-25.
    sourceVersionId: integer("source_version_id").references(
      () => chapterVersions.id,
      { onDelete: "cascade" },
    ),
    // Доказательство в неизменяемом content_text указанной версии.
    evidenceQuote: text("evidence_quote"),
    evidenceStart: integer("evidence_start"),
    evidenceEnd: integer("evidence_end"),
    origin: text("origin").notNull(),
    verification: text("verification").notNull().default("derived"),
    extractorVersion: integer("extractor_version").notNull().default(1),
    // Стабильный ключ для идемпотентности повторной обработки (AC-21).
    dedupKey: text("dedup_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    // NULL в `source_version_id` SQLite считает уникальным значением, поэтому
    // строки без версии-источника (ручные, перенесённые миграцией) этим
    // индексом не дедуплицируются. Так и задумано: идемпотентность нужна
    // только повторной обработке версии (AC-21), а там версия есть всегда.
    // `extractor_version` в ключе: без него повышение номера извлекателя
    // гасилось бы индексом целиком, и колонка существовала бы ради случая,
    // который ключ запрещает.
    uniqueIndex("uq_character_events_dedup").on(
      t.subjectCharacterId,
      t.kind,
      t.dedupKey,
      t.sourceVersionId,
      t.extractorVersion,
    ),
    index("idx_character_events_subject").on(t.subjectCharacterId),
    index("idx_character_events_chapter").on(t.chapterId),
    index("idx_character_events_book").on(t.bookId),
    index("idx_character_events_version").on(t.sourceVersionId),
    check("character_events_kind_check", sql`${t.kind} IN ('knowledge','state','relation_shift','commitment')`),
    check("character_events_origin_check", sql`${t.origin} IN ('manual','llm','accepted_prose','migration')`),
    check("character_events_verification_check", sql`${t.verification} IN ('derived','proposed','confirmed','rejected')`),
    check("character_events_scene_ordinal_check", sql`${t.sceneOrdinal} >= 0`),
    check("character_events_extractor_version_check", sql`${t.extractorVersion} >= 1`),
    check("character_events_evidence_start_check", sql`${t.evidenceStart} IS NULL OR ${t.evidenceStart} >= 0`),
    check("character_events_evidence_end_check", sql`${t.evidenceEnd} IS NULL OR ${t.evidenceEnd} >= 0`),
    check("character_events_evidence_range_check", sql`${t.evidenceStart} IS NULL OR ${t.evidenceEnd} IS NULL OR ${t.evidenceEnd} > ${t.evidenceStart}`),
  ],
);

/** Леджер дневного набора слов (свеча-цель). Пишется из PUT /chapters/:id/draft. */
export const writingDays = sqliteTable("writing_days", {
  date: text("date").primaryKey(),
  wordsAdded: integer("words_added").notNull().default(0),
});

export const chapterDrafts = sqliteTable("chapter_drafts", {
  chapterId: integer("chapter_id")
    .primaryKey()
    .references(() => chapters.id, { onDelete: "cascade" }),
  contentJson: text("content_json").notNull(),
  contentText: text("content_text").notNull(),
  wordCount: integer("word_count").notNull(),
  baseVersionId: integer("base_version_id").references(
    (): AnySQLiteColumn => chapterVersions.id,
    { onDelete: "set null" },
  ),
  /** Монотонный CAS-токен автосохранения: растёт на каждый UPSERT. */
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

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

export const proseProposals = sqliteTable(
  "prose_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("streaming"),
    baseVersionId: integer("base_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    baseDraftRevision: integer("base_draft_revision"),
    contextFingerprint: text("context_fingerprint").notNull(),
    contentText: text("content_text").notNull().default(""),
    contentJson: text("content_json")
      .notNull()
      .default('{"type":"doc","content":[{"type":"paragraph"}]}'),
    wordCount: integer("word_count").notNull().default(0),
    completion: text("completion").notNull().default("unconfirmed"),
    stopReason: text("stop_reason"),
    modelId: text("model_id"),
    backend: text("backend"),
    acceptedVersionId: integer("accepted_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    acceptRequestId: text("accept_request_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_prose_proposals_chapter").on(t.chapterId, t.createdAt),
    // Частичный уникальный индекс: accept_request_id — NULL у всех
    // непринятых предложений, уникальность требуется только когда он задан.
    uniqueIndex("uq_prose_proposals_accept_request")
      .on(t.acceptRequestId)
      .where(sql`${t.acceptRequestId} IS NOT NULL`),
    check("prose_proposals_kind_check", sql`${t.kind} IN ('write','repair')`),
    check(
      "prose_proposals_status_check",
      sql`${t.status} IN ('streaming','ready','incomplete','cancelled','failed','accepted','rejected','superseded')`,
    ),
    check(
      "prose_proposals_completion_check",
      sql`${t.completion} IN ('confirmed','unconfirmed')`,
    ),
  ],
);
