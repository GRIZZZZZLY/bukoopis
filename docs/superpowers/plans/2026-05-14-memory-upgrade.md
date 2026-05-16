# Memory Upgrade — Implementation Plan

> **Date:** 2026-05-14
> **Codename:** `memory-upgrade` (Studio Phase G prerequisite)
> **Status:** Draft

**Goal:** Upgrade book-forge agent memory from flat prev-chapter-summary to a layered, retrievable, temporally-aware canon store. Writer/Plot/Critics see the right facts at the right time, without prompt linear-growth or stale canon.

**Architecture rationale:** Current memory = curated context per call (Studio concept + accepted aspects + prev-chapter summaries + materialized canon tables + style ctx). Two known holes: (1) `previousChaptersSummary` grows linearly per chapter, (2) `hybridSearch` infrastructure exists but is not wired into Writer/Plot. This plan closes both, adds temporal canon facts to prevent drift, and introduces a Zettelkasten-style episodic memory for arc/foreshadow tracking.

**Tech Stack (unchanged):** TypeScript 5.7, better-sqlite3 11.7, `sqlite-vec`, FTS5, Hono, Zod 4, vitest. No new external deps. All changes additive — current Studio flow keeps working.

**Locked decisions:**
- SQLite-only (no Mem0/Zep/Letta service). Single-user local-first stands.
- Memory tables live in `book_*` namespace, scoped by `book_id` foreign key.
- LLM consolidation/extraction uses existing `dispatchStructured` with new agent contracts.
- No background workers — all memory writes triggered by existing save/accept flows.
- Per-book toggle: memory features opt-in via `books.memory_mode = 'minimal' | 'standard' | 'rich'`.

---

## Phase 1 — Wire `hybridSearch` into Writer/Plot

**Goal:** Stop pretending retrieval doesn't exist. Top-k relevant chunks from prior chapters injected into Writer prompt.

- [x] 1.1 Add `apps/server/src/utils/chapter-retrieval.ts` with `gatherRetrievedChunks(sqlite, opts)`. Wraps `hybridSearch` from `@book-forge/retrieval`. Returns `{ chunks: [{chapterOrder, text, score}], promptBlock: string | null }`.
- [x] 1.2 Query construction: caller passes `queryText` (writer: concatenated beat blob; plan: title+intent). Dedupe results by `chapterId`, keep best chunk per chapter, cap at `topK` (default 5).
- [x] 1.3 Filter: `beforeChapterOrder = currentChapterOrder - 1` (hybridSearch `<=` filter) excludes the current chapter and any later — no self-leak.
- [x] 1.4 Added `retrievedContext: string | null` to `WriteChapterInput` ([packages/agents/src/writer.ts](packages/agents/src/writer.ts)); appended into `stableParts` after `studioContext` (cacheable block).
- [x] 1.5 Added optional `retrievedContext?: string | null` to `GenerateChapterPlanInput` ([packages/agents/src/plot.ts](packages/agents/src/plot.ts)); injected in `buildChapterPlanPrompt` after `studioContext`.
- [x] 1.6 Plot route wires `gatherRetrievedChunks` before `runChapterPlan` (query: title+intent) and `runChapterWriter` (query: beat blob); `hasVec` threaded from `createPlotRoute`.
- [x] 1.7 Tests: `chapter-retrieval.test.ts` (4 logic tests: blank query, beforeChapterOrder, dedupe+block, no-hits). Best-effort failure asserted at route layer in `plot.test.ts` (3 tests: inject, swallow-failure, no-hits) — vitest 2.1.9 attributes mock-thrown errors to the test unless consumed via the Hono `app.request()` boundary; documented in test.

**Acceptance:** ✅ Plot-route test asserts retrieved chunks appear in `runChapterPlan` input; hybridSearch failure → endpoint still 200 (best-effort). Writer wiring symmetric (`writerRetrieved.promptBlock`). Server suite 144/144, server+agents typecheck clean.

---

## Phase 2 — Rolling-window summary

**Goal:** Stop linear-growth `previousChaptersSummary`. Recent 3 chapters full summary, older → single meta-summary regenerated on threshold.

- [ ] 2.1 New table `book_meta_summaries(id, book_id, covers_from_order, covers_to_order, summary_text, created_at, model_id)`. Migration `0011_meta_summaries.sql` (hand-written, snapshot still broken).
- [ ] 2.2 New agent contract `meta_summarizer` in `packages/agents/src/meta-summarizer.ts`: takes N chapter summaries, outputs one 200-400 word meta-summary preserving named entities + open threads + arc beats. Sonnet model. Register in `bootstrap.ts`.
- [ ] 2.3 Refactor [loadPreviousChaptersSummary](apps/server/src/routes/plot.ts) → `loadRollingChapterContext(sqlite, bookId, beforeOrderIndex, window=3)`:
  - Returns `{ recent: ChapterSummary[3], meta: MetaSummary | null }`.
  - Recent = last 3 chapters before cursor, full per-chapter summary.
  - Meta = single row covering `order_index < cursor - 3`, if any.
- [ ] 2.4 Format: `## Контекст: предыдущие главы\n### Сводка глав 1-7\n{meta}\n\n### Глава 8 ...\n### Глава 9 ...\n### Глава 10 ...`.
- [ ] 2.5 Trigger: after `triggerVersionSummary` succeeds, check `chapter_count_with_summary - 3 > last_meta_summary.covers_to`. If yes, regenerate meta over `[1..count-3]`. Fire-and-forget pattern, same as existing summary trigger.
- [ ] 2.6 Tests: book with 0/1/3/5/10 chapters returns correct rolling window. Meta regenerates only after threshold. Concurrent triggers don't double-write (sqlite `INSERT OR REPLACE` keyed by `(book_id, covers_to_order)`).

**Acceptance:** Chapter 30 generation prompt token count for previous-chapter context block is bounded ~1500 tokens regardless of book length. Verified via `usage` log.

---

## Phase 3 — Temporal canon facts

**Goal:** Track when each canon fact is true. Prevent "герой ещё не умеет колдовать в главе 3, но умеет в главе 12" drift.

- [ ] 3.1 New table `book_facts`:
  ```sql
  CREATE TABLE book_facts (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- 'character' | 'location' | 'item' | 'world'
    entity_id INTEGER,         -- nullable, refs characters/locations/items
    predicate TEXT NOT NULL,   -- 'knows_spell' | 'owns' | 'located_at' | 'relationship_with' | ...
    object_text TEXT NOT NULL, -- free text value
    valid_from_chapter INTEGER NOT NULL,
    valid_to_chapter INTEGER,  -- NULL = still valid
    source_version_id INTEGER, -- chapter_versions row that introduced fact
    confidence REAL DEFAULT 1.0,
    superseded_by INTEGER REFERENCES book_facts(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_book_facts_lookup ON book_facts(book_id, entity_type, entity_id, valid_from_chapter);
  ```
  Migration `0012_book_facts.sql`.
- [ ] 3.2 New agent contract `canon_fact_extractor` in `packages/agents/src/canon-fact-extractor.ts`: takes chapter draft + materialized characters/items/locations + recent facts → outputs `BookFact[]` (new + supersessions). Sonnet model. Zod schema in `packages/shared/src/canon-facts.ts`.
- [ ] 3.3 Hook into `triggerVersionSummary` flow: after summary, run extractor in same fire-and-forget try-block. Persist via `book_facts` repo with conflict resolution: if new fact contradicts existing valid fact, set `valid_to_chapter = chapter.order_index - 1` on old, insert new with `superseded_by` pointer.
- [ ] 3.4 New util `loadActiveFacts(sqlite, bookId, atChapterOrder, entityIds?)`: returns facts where `valid_from_chapter <= cursor AND (valid_to_chapter IS NULL OR valid_to_chapter >= cursor)`. Optional entity filter.
- [ ] 3.5 Extend `gatherCharacterContext` ([packages/agents/src/character.ts](packages/agents/src/character.ts)): for each character pulled by mention, append active facts as `### Состояние на главу N\n- умеет: магия огня (с гл. 5)\n- владеет: меч-кладенец (с гл. 8)`.
- [ ] 3.6 Same extension for `gatherLoreContext`.
- [ ] 3.7 Canon Guard critic ([packages/agents/src/critics/canon.ts](packages/agents/src/critics/canon.ts)) reads `loadActiveFacts` before judging draft — flags contradictions with existing valid facts.
- [ ] 3.8 Tests: extractor mocked, fact storage with supersession, time-bounded query returns correct snapshot per chapter.

**Acceptance:** Generate chapter 10 with character "Алиса" — Writer sees only facts valid at chapter ≤9. If chapter 6 said "Алиса умеет огонь", chapter 10 prompt includes that. If chapter 8 said "Алиса теряет магию", facts list shows `superseded`.

---

## Phase 4 — Episodic memory (Zettelkasten notes)

**Goal:** Capture open threads, foreshadowing, arc deltas as cross-linked notes. Surface relevant notes to Plot/Writer when beat-conflict matches.

- [ ] 4.1 New table `book_notes`:
  ```sql
  CREATE TABLE book_notes (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL,
    kind TEXT NOT NULL, -- 'thread' | 'foreshadow' | 'arc_delta' | 'theme' | 'mystery'
    chapter_order_introduced INTEGER NOT NULL,
    chapter_order_resolved INTEGER, -- NULL = open
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    embedding BLOB,            -- via sqlite-vec
    tags TEXT NOT NULL DEFAULT '[]', -- JSON array
    related_note_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
    source_version_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_book_notes_open ON book_notes(book_id, chapter_order_resolved);
  ```
  Migration `0013_book_notes.sql`.
- [ ] 4.2 Agent contract `episodic_note_extractor`: takes chapter draft + open notes → outputs `(newNotes[], resolvedNoteIds[], linkedPairs[])`. Sonnet. Linking decided by LLM judging note similarity.
- [ ] 4.3 Hook into post-save flow after canon-fact extraction. Embed new notes via existing `embedText` from `@book-forge/retrieval`.
- [ ] 4.4 New util `gatherRelevantNotes(sqlite, bookId, queryText, atChapterOrder, k=5)`: vector search over open notes (`chapter_order_resolved IS NULL OR chapter_order_resolved >= cursor`), filtered by book.
- [ ] 4.5 Inject into Plot agent input (`runChapterPlan`): `openThreads: string | null` block listing top-5 relevant open notes — Plot agent can choose to close/advance them in beats.
- [ ] 4.6 Inject into Critic Reader-Experience: detects forgotten foreshadowing (open notes introduced N+5 chapters ago, never referenced).
- [ ] 4.7 Tests: extract → embed → retrieve → resolve flow with mocked LLM + real `sqlite-vec` integration test.

**Acceptance:** Chapter 3 introduces "тайный амулет" → `book_notes` row with `kind='foreshadow'`, open. Chapter 8 beat-sheet generation sees this note in prompt context. Chapter 12 resolves it → `chapter_order_resolved=12`.

---

## Phase 5 — Reranker layer

**Goal:** Improve top-k precision before injection. Cross-encoder or LLM-judge reranks `hybridSearch` candidates.

- [ ] 5.1 Decide reranker: cheapest option = Haiku 4.5 as LLM-judge (single batched call, 0.8c per 100 chunks). Alternative = jina-reranker-v3 via fetch (no SDK, plain HTTP). Default to Haiku — keeps single-vendor stack.
- [ ] 5.2 New util `rerankChunks(chunks, queryText, opts)` in `packages/retrieval/src/rerank.ts`. Returns reordered + filtered (drop scores < threshold).
- [ ] 5.3 Wire into `gatherRetrievedChunks` (Phase 1.1) — `hybridSearch` returns top-20, reranker narrows to top-5.
- [ ] 5.4 Same wire-in for `gatherRelevantNotes` (Phase 4.4).
- [ ] 5.5 Config flag `RETRIEVAL_RERANK=1|0`. Off by default until benchmarked on actual books.
- [ ] 5.6 Tests: reranker mock returns specific order, util threads through correctly. Disabled flag = passthrough.

**Acceptance:** A/B compare with same query: rerank ON produces measurably more specific chunks for "battle scene" query (manual eval on 1 test book). Latency overhead < 1s per chapter generation.

---

## Phase 6 — Scene snapshots (deferred / optional)

**Goal:** Per-beat snapshot of character emotional state + knowledge delta. Feeds Critic Reader and Plot for next-chapter beat construction.

- [ ] 6.1 New table `chapter_scenes(id, version_id, beat_index, pov, emotion_pre, emotion_post, knowledge_delta_json, ...)`.
- [ ] 6.2 Agent contract `scene_snapshotter` runs on chapter accept.
- [ ] 6.3 Plot agent uses last 3 scene snapshots when generating next chapter beats.

**Status:** SKIPPED for v1 of memory-upgrade. Reassess after Phase 1-5 land. Risk: agent contract proliferation without clear win.

---

## Phase 7 — Auto-consolidation job

**Goal:** Periodically LLM-rewrites `book_facts` + `book_notes` to dedupe, merge, prune low-confidence rows. Inspired by Google Always-On pattern.

- [ ] 7.1 New endpoint `POST /api/books/:id/memory/consolidate` (manual trigger, no cron).
- [ ] 7.2 Agent contract `memory_consolidator`: input = full `book_facts` + `book_notes` snapshot, output = `{ mergeOps[], deleteOps[], rewriteOps[] }`. Opus model — quality over cost since rare.
- [ ] 7.3 UI button in StudioPage: "Уплотнить память" with last-run timestamp + dry-run preview.
- [ ] 7.4 Tests: dry-run returns ops, apply writes through transaction, idempotent on second run.

**Status:** Deferred to post-MVP. Only useful after book has 50+ chapters of accumulated noise.

---

## Cross-cutting

- [ ] All new tables get `book_id` FK with `ON DELETE CASCADE` — book delete cleans memory.
- [ ] All new LLM extractors mocked in route tests (existing pattern, `vi.mock("@book-forge/agents/...")`).
- [ ] Add `memory_mode` column to `books` table (migration `0014_memory_mode.sql`). Default `'standard'` = Phase 1-3 active. `'minimal'` = Phase 1 + rolling window only. `'rich'` = all phases including 4-5.
- [ ] Update [studio-context.ts](apps/server/src/utils/studio-context.ts) docs — it remains the static-context loader; new memory utils live separately.
- [ ] CLAUDE.md gets new section "Memory layers" listing the 3 utils: `loadRollingChapterContext`, `gatherRetrievedChunks`, `loadActiveFacts`, `gatherRelevantNotes`.

## Out of scope (do not touch this milestone)

- LangGraph checkpointer activation. Stateful agent flows = Phase H+.
- Multi-book shared memory / cross-book canon copy.
- Embedding model swap (stay on current Anthropic embed or local `sqlite-vec` defaults).
- Branching memory per chapter version (only `current_version_id` writes to memory).
- Mem0/Zep/Letta integration. Concept-only inspiration confirmed.

## Rollout

1. Phase 1 (1 day) — retrieval wire-in. Immediate quality win on existing books.
2. Phase 2 (1 day) — rolling window. Fixes token-bloat in long books.
3. Phase 3 (2-3 days) — temporal facts. Biggest canon-drift fix.
4. Phase 4 (2-3 days) — episodic notes. Best foreshadowing payoff.
5. Phase 5 (1 day) — reranker, behind flag.
6. Phase 6-7 — deferred.

Total est. v1 memory-upgrade: 7-9 dev-days. All phases independently shippable.

## Verification per phase

Every phase ends with:
- `pnpm typecheck` clean.
- `pnpm test` green (new tests added).
- Manual smoke: regenerate one chapter in a test book, compare Writer prompt diff via `usageLogger` trace.
- No regression: existing Studio Phases A-F tests stay green (300 tests baseline).

## Acceptance for milestone

Generate chapter 15 in a 14-chapter test book:
- Writer prompt contains: studio context + rolling window (3 recent + 1 meta) + retrieved chunks (top-5 reranked) + active canon facts on mentioned entities + open episodic notes.
- Total prompt tokens < 12k (vs. current unbounded).
- Canon Guard critic flags 0 false-positive contradictions on a known-clean draft.
- Reader-Experience critic flags forgotten foreshadowing on a draft missing chapter-3-introduced thread.
