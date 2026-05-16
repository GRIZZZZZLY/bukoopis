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

- [x] 2.1 Table `book_meta_summaries(id, book_id, covers_from_order, covers_to_order, summary_text, model_id, created_at)` + UNIQUE(book_id). Migration `0011_meta_summaries.sql` hand-written + `_journal.json` entry idx 11 (runtime `migrate()` uses journal tags, not snapshots — verified applies in temp DB).
- [x] 2.2 `metaSummarize` agent in `packages/agents/src/meta-summarizer.ts`. **Deviation:** mirrors `summarizeChapter` (streamText, `agentName: "summarizer"`, sonnet) — NOT a structured contract, so no `bootstrap.ts` change (summarize-chapter was never registered there either). Exported via agents barrel.
- [x] 2.3 `loadRollingChapterContext(sqlite, bookId, beforeOrderIndex, window=3)` in `apps/server/src/utils/rolling-context.ts`. **Deviation:** returns `string | null` (not an object) to keep both plot call sites unchanged — same external contract as the removed `loadPreviousChaptersSummary`.
- [x] 2.4 Format: older run → `### Сводка ранних глав (#from–#to)\n{meta}`, recent window → `Глава #N «title»:\n{summary}` blocks joined by `\n\n---\n\n`. Caller keeps its existing wrapper line.
- [x] 2.5 `triggerMetaSummary` hooked at end of `triggerVersionSummary` success path (fire-and-forget, own try/catch). Idempotent via `existing.covers_to_order >= coversTo` guard.
- [x] 2.6 Tests `rolling-context.test.ts` (7): null / ≤window verbatim / older per-chapter fallback (no meta) / meta block replaces older / trigger ≤window no-op / rollup row covers [1..count-3] / idempotent (metaSummarize called once). **Deviation:** rollup keyed UNIQUE(book_id) one-row-per-book via `ON CONFLICT(book_id) DO UPDATE` (simpler than `(book_id, covers_to_order)` — loader always wants the single older-than-window rollup).

**Acceptance:** ✅ Previous-chapters block bounded regardless of length — last 3 chapters verbatim (~80-180w each) + ONE meta rollup (~200-400w) for all older. Server suite 151/151 (21 files), server+agents typecheck clean. Committed 82afe47.

---

## Phase 3 — Temporal canon facts

**Goal:** Track when each canon fact is true. Prevent "герой ещё не умеет колдовать в главе 3, но умеет в главе 12" drift.

- [x] 3.1 Table `book_facts` via migration `0012_book_facts.sql` + `_journal` idx 12. **Deviation:** added `entity_name TEXT NOT NULL` (server matches by name, not id — extractor never juggles entity_id); CHECK on entity_type; second index `idx_book_facts_active(book_id,valid_from,valid_to)` for the time-bounded query; `superseded_by` FK ON DELETE SET NULL. Verified applies in temp DB.
- [x] 3.2 `canon_fact_extractor` structured contract in `packages/agents/src/canon-fact-extractor.ts` (mcp_submit_tool, sonnet). Added to AGENT_NAMES + STRUCTURED_AGENT_NAMES + `router.ts` default (subscription) + bootstrap. Zod schema `packages/shared/src/canon-facts.ts`. Parity drift-guard stays green. **Deviation:** LLM emits flat facts; supersession is server-owned (no LLM ID bookkeeping).
- [x] 3.3 `triggerCanonFactExtraction` hooked fire-and-forget into `triggerVersionSummary` (after summary + meta). `persistExtractedFacts`: prior open row for (type,name,predicate) closed at `chapterOrder-1` + `superseded_by`; unchanged value = no-op (idempotent); same-chapter rows replaced before insert.
- [x] 3.4 `loadActiveFacts(sqlite, bookId, atChapterOrder, {entityNames?})` — `valid_from <= cursor AND (valid_to IS NULL OR valid_to >= cursor)`. **Deviation:** filters by `entityNames` (name-based model), not `entityIds`.
- [x] 3.5/3.6 **Deviation:** active facts injected at the **route layer** (`renderActiveFactsPrompt` appended to Writer `characterContext` in plot route) rather than inside `gatherCharacterContext`/`gatherLoreContext` — keeps the `@book-forge/agents` package free of the server-only `book_facts` table (same pattern as studio/retrieved context). Single combined block covers character + location + item facts.
- [x] 3.7 Canon Guard: `renderActiveFactsPrompt` appended to `bookContext` at both critique-route call sites — critic sees what is currently true.
- [x] 3.8 Tests `book-facts.test.ts` (8): supersession (valid_to=N-1 + superseded_by) / idempotent unchanged / same-chapter replace / entityNames scope / render grouping + null / trigger persist + short-skip.

**Acceptance:** ✅ Supersession verified — fact at ch5, restated ch8 → `loadActiveFacts(6)` shows old, `loadActiveFacts(8)` shows new, old row `valid_to=7` + `superseded_by` set. Writer/Canon-Guard see only facts valid at the target chapter. Server 159, llm 65, shared 50; all typecheck clean. Committed 7b88b54.

---

## Phase 4 — Episodic memory (Zettelkasten notes)

**Goal:** Capture open threads, foreshadowing, arc deltas as cross-linked notes. Surface relevant notes to Plot/Writer when beat-conflict matches.

- [x] 4.1 Table `book_notes` (kind/introduced/resolved/title/body/embedding BLOB/tags/related_note_ids/source_version_id) + CHECK on kind + `idx_book_notes_open`. Migration `0013_book_notes.sql` + `_journal` idx 13. `book_notes_vec` vec0 table added to `bootstrapVirtualTables` (hasVec branch, rowid = book_notes.id).
- [x] 4.2 `episodic_note_extractor` structured contract (mcp_submit_tool, sonnet) → `{newNotes[], resolvedTitles[], notes}`. Added to AGENT_NAMES + STRUCTURED set + router default + bootstrap; parity drift-guard green. **Deviation:** resolution by **title** (not note IDs); `linkedPairs` dropped for v1 — relatedness handled at retrieval time by embedding neighbours instead of stored links (simpler, no LLM ID bookkeeping).
- [x] 4.3 `triggerEpisodicNotes` hooked fire-and-forget into `triggerVersionSummary` after canon-fact extraction. New notes embedded on write via `getEmbeddingProvider().embed` (retrieval pkg has no `embedText`; provider API used directly).
- [x] 4.4 `gatherRelevantNotes(sqlite, bookId, queryText, atChapterOrder, k=5)` — sqlite-vec `book_notes_vec MATCH` when available, **JS cosine fallback** over stored embedding BLOBs otherwise; open-note filter `introduced ≤ cursor AND (resolved IS NULL OR resolved ≥ cursor)`. `renderOpenNotesPrompt` formats grouped block.
- [x] 4.5 Plot route: `gatherRelevantNotes` → `renderOpenNotesPrompt` → `runChapterPlan.openThreads` (optional field added to `GenerateChapterPlanInput`, injected after prev-summary in `buildChapterPlanPrompt`).
- [x] 4.6 Critique route: relevant open notes appended to `bookContext` at both call sites (visible to Reader-Experience critic for forgotten-payoff detection; harmless to other critics).
- [x] 4.7 Tests `book-notes.test.ts` (9): persist/open-until-resolved, resolve-by-title, time-bound, same-chapter replace, render (null + format), relevance ranking over k (stub embeddings), trigger persist + short-skip. Real sqlite-vec loaded in test harness.

**Acceptance:** ✅ Note introduced ch2 stays open; `gatherRelevantNotes` ranks the semantically closest open note first; `resolvedTitles` closes it (`chapter_order_resolved` set, excluded after). Server 168, llm 65, shared 50; all typecheck clean. Committed f28d1f5.

---

## Phase 5 — Reranker layer

**Goal:** Improve top-k precision before injection. Cross-encoder or LLM-judge reranks `hybridSearch` candidates.

- [x] 5.1 LLM-judge reranker (`reranker` structured agent, mcp_submit_tool). **Deviation:** sonnet, not Haiku 4.5 — avoids `ModelChoice`/`resolveModelId` plumbing while the flag is off-by-default; revisit model when benchmarking.
- [x] 5.2 `rerankByRelevance<T>` in `apps/server/src/utils/rerank.ts`. **Deviation:** server utils, not `packages/retrieval/src/rerank.ts` — keeps the retrieval package free of an LLM dependency (judge needs `@book-forge/agents`). Generic over T; threshold-0.15 drop + topK cap + best-effort passthrough.
- [x] 5.3 Wired into `gatherRetrievedChunks` — pool = `candidateK` when enabled, then rerank → topK; off = pool capped at topK (byte-identical to pre-Phase-5).
- [x] 5.4 Wired into `gatherRelevantNotes` — pool `k*4` (vec + cosine paths) when enabled, then rerank → k; off = unchanged.
- [x] 5.5 Flag `RETRIEVAL_RERANK=1` (off by default). `rerankEnabled()` gate; agent + AGENT_NAMES/STRUCTURED/router/bootstrap wired so it's ready when toggled.
- [x] 5.6 Tests `rerank.test.ts` (5): env flag / passthrough disabled (no LLM call) / ≤topK skip / reorder+threshold-drop+cap / all-below-threshold fallback.

**Acceptance:** ✅ Flag off → exact passthrough, zero extra LLM calls, Phase 1/4 suites unchanged. Flag on → reorders by judged relevance, drops < 0.15, caps topK, best-effort fallback. Server 173 (24 files), llm 65 (parity), all typecheck clean. Committed 8e59d4f.

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
