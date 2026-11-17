# Local Writer — Scene Plan Implementation Plan (part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Claude writes a dense scene plan (6–8 events per ~600-word scene) that the author can edit. Our local model writes the chapter from it. Without a plan, a density floor keeps chapters from drifting.

**Spec:** docs/superpowers/specs/2026-11-17-local-writer-scene-plan.md, an addendum to docs/superpowers/specs/2026-11-17-local-writer-design.md.

**Builds on (already on branch feat/local-writer):**
- `mannerLine` (style-engine);
- `planLocalScenes`, `buildLocalScenePrompt`, `localTail`, `localCastLine`, `runLocalScene`, `localWriterAvailable` (packages/agents/src/local-writer.ts);
- the local branch of the chapter write handler in apps/server/src/routes/plot.ts.

## Global Constraints

- Scene plan write schema:
  - `scenes`: 1–12 items;
  - each scene's `events`: 3–10 strings, each 1–300 chars after trim, never blank.
  - No `.transform` in the tool schema.
  - The read side is lenient: an invalid stored value reads as null.
- Storage: `chapters.scene_plan` TEXT holding `{"scenes":[...],"basedOn":<number>}`. `basedOn` = `hash32(JSON.stringify(chapterPlanForGeneration(row)))`.
- Migration `0035_scene_plan.sql` is hand-written plain SQL, scaffolded with `pnpm --filter @book-forge/server drizzle:new scene_plan`. Never run `drizzle:generate`.
- Density floor: `K = Math.min(Math.ceil(target/600), Math.max(1, Math.ceil(items/7)))`. target = `estimatedWords` ?? 3000. items = beats or content sentences.
- Agent name `scene_plan`, backend `subscription`. Steps: add to `AGENT_NAMES` and `STRUCTURED_AGENT_NAMES` (packages/llm/src/types.ts), set `DEFAULT_AGENT_BACKEND` (router.ts), register in packages/agents/src/bootstrap.ts. The drift-guard test must pass.
- UI words live only in apps/web/src/lib/labels.ts. The running model job is published through apps/web/src/lib/jobs.ts.
- Tests mock LLM calls. Commit messages are in Russian and end with a blank line plus `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A test that pinned old behaviour and conflicts with the density floor is rewritten, and the commit says so.

## Review Focus

1. **The author edits the chapter content after making a scene plan.** The plan is still used, and the UI shows the stale warning. → Task 6 (`scenePlanStale`) and Task 9.
2. **The model returns fewer or more scenes than asked.** Keep what came back; never pad. → Task 7 test.
3. **Saving a plan with an emptied scene.** The empty scene is dropped client-side; the server rejects fewer than 3 events. → Task 9 and Task 6 tests.
4. **A local book with thin content and no plan** gets 1 scene, not 5 drifting ones. → Task 8 test.
5. **A non-local book** never shows the section and never calls the scene-plan agent. → Task 9 test.

---

### Task 6: Scene plan storage and PATCH

**Files:**
- Create `packages/shared/src/scene-plan.ts`:
  - `scenePlanWriteSchema`;
  - `type ScenePlan = { scenes: { events: string[] }[] }`;
  - `type StoredScenePlan = ScenePlan & { basedOn: number }`;
  - `parseStoredScenePlan(raw: string | null): StoredScenePlan | null`.
  - Export all of it from the shared index.
- Create `apps/server/drizzle/0035_scene_plan.sql`: `ALTER TABLE chapters ADD COLUMN scene_plan TEXT;`.
- Modify:
  - `apps/server/src/db/schema.ts` and `rows.ts` (`scene_plan: string | null`);
  - the chapter wire type in shared and `toChapter`: add `scenePlan: StoredScenePlan | null` and `scenePlanStale: boolean`;
  - `updateChapterInputSchema`: add `scenePlan: scenePlanWriteSchema.nullable().optional()`;
  - the PATCH handler in `apps/server/src/routes/chapters.ts`: store `{...plan, basedOn}`, or NULL. `undefined` leaves the column unchanged.

- [ ] Tests:
  - the schema rejects 0 scenes, 13 scenes, a scene with 2 events, an event of 301 chars, and a blank event;
  - `parseStoredScenePlan("garbage")` and `parseStoredScenePlan(null)` return null;
  - PATCH round-trip: the plan is saved and `basedOn` equals the current hash, so `scenePlanStale` is false;
  - after changing `intent`, `scenePlanStale` is true;
  - `scenePlan: null` clears it; omitting it leaves it unchanged;
  - migrations apply on a fresh DB (the existing migration test harness).
- [ ] Commit `feat(shared,server): план сцен главы — хранение и правка`.

### Task 7: `scene_plan` agent

**Files:**
- Create `packages/agents/src/scene-plan.ts`, following packages/agents/src/scene-intent.ts:
  - `SCENE_PLAN_SYSTEM`;
  - `buildScenePlanPrompt(input: ScenePlanAgentInput): string`;
  - `registerScenePlanContract(): void`;
  - `runScenePlan(input: ScenePlanAgentInput): Promise<ScenePlan>`.
- Modify packages/llm/src/types.ts, router.ts, packages/agents/src/bootstrap.ts and index.ts.

**Interface:**
- `ScenePlanAgentInput = { bookTitle: string; chapterTitle: string; chapterContent: string | null; beats: string | null; closingNote: string | null; previousTail: string | null; previousSummary: string | null; characterContext: string | null; worldContext: string | null; sceneCount: number; model?: ModelChoice; onUsage?: (u: StructuredUsage & { modelId: string }) => void }`.

**System prompt (Russian).** It must carry each of these:
- split the chapter into exactly `sceneCount` scenes of 6–8 events;
- an event is one short concrete sentence in the present tense: one action or observation;
- characters are named by their card names;
- no dialogue lines and no prose;
- add nothing that changes the plot beyond the chapter content. Fill the gaps with concrete steps, transitions and observations between content points;
- the last event of the last scene is the chapter's stop point (the closing note when given).

**Behaviour:**
- A returned scene count different from `sceneCount` is kept as is: no padding, no trimming.

- [ ] Tests:
  - the prompt contains the content, `sceneCount`, the closing note and the previous tail;
  - the drift guard passes;
  - `runScenePlan` with a mocked `dispatchStructured` returns the plan;
  - 2 scenes returned when 3 were asked are returned unchanged.
- [ ] Commit `feat(agents): агент плана сцен для нашей модели`.

### Task 8: Server — generate the plan, write from it, density floor

**Files:**
- The route `POST /api/chapters/:id/scene-plan` goes next to the chapter write handler in apps/server/src/routes/plot.ts.
  - Context comes from `assembleGenerationContext` (scanTexts `[intent ?? beats blob]`), the same as the write handler.
  - `sceneCount = Math.ceil(target/600)`.
  - Store `{...plan, basedOn}` and log usage with route `plot.scene_plan`.
  - Return the chapter wire.
- In packages/agents/src/local-writer.ts, `planLocalScenes` applies the density floor. Rewrite its conflicting tests:
  - 14 beats with 4000 words give 2 scenes;
  - 7 beats with 4000 give 1;
  - 49 beats with 4000 give 7;
  - 4 content sentences with no estimate give 1 scene with 4 events;
  - no content gives 1 scene «Продолжение главы».
- Write handler, local branch: when `parseStoredScenePlan(ch.scene_plan)` is not null, scenes = plan scenes mapped to `LocalScene` (`must` = `stop` = the last event). Otherwise use `planLocalScenes`.

- [ ] Tests:
  - `scene-plan route saves plan and basedOn` (agent mocked; assert `sceneCount` passed = ceil(target/600));
  - `write uses stored scene plan`: 3 plan scenes give 3 `runLocalScene` calls, each prompt listing exactly that scene's events;
  - `thin content gives one scene` (no plan);
  - existing write-local tests are updated where the floor changes the scene count, and the commit says so.
- [ ] Commit `feat(server): глава нашей моделью по плану сцен; плотность событий ограничивает длину`.

### Task 9: Web — «План сцен» in the plan panel

**Files:**
- Create `apps/web/src/components/ScenePlanSection.tsx`, rendered from `apps/web/src/components/PlanPanel.tsx`.
- Add API client functions (`generateScenePlan(chapterId)`, `saveScenePlan(chapterId, plan | null)`) next to the existing chapter API calls.
- Add labels to labels.ts.

**Behaviour:**
- The section renders only when `book.writerProvider === "ollama"`.
- «Составить план сцен» calls generate, publishes a job through jobs.ts, and fills the textareas.
- One textarea per scene, one event per line.
- «Сохранить» trims lines, drops blank lines, drops a scene with no events, and sends PATCH. It is disabled when nothing has changed.
- «Очистить» sends PATCH null.
- The stale warning «План сцен составлен по прежнему содержанию главы» shows when `scenePlanStale`.
- A server validation error, for example a scene with 2 events, is shown inline, never swallowed.

- [ ] RTL tests:
  - hidden for anthropic books;
  - generate fills the textareas;
  - edit plus save sends the trimmed payload, with the empty scene dropped;
  - the stale warning renders;
  - «Сохранить» is disabled when unchanged.
- [ ] Commit `feat(web): план сцен для нашей модели в панели плана`.
