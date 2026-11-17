# Addendum to the local writer design: scene plan

Addendum to [2026-11-17-local-writer-design.md](2026-11-17-local-writer-design.md). Approved by the author on 2026-11-17.

## What the live check found

- The model was trained on scene plans with about 9 events per 600-word scene.
- With chapter content of 4 sentences, the first design gave one event per scene. Each scene then drifted into invention: a hospital, cars, a stranger named Серж.
- A hand-written dense plan (4 scenes of 6–7 events) kept every event, in order. Some digressions remain.
- The prompts were verified correct through a logging proxy, so the cause is plan density, not assembly.

## The author's decision

Claude writes the scene plan. A density floor always applies.

## Design

- **Scene plan.** `{ scenes: [{ events: string[] }] }`.
  - 1–12 scenes. Each scene has 3–10 events, each event 1–300 chars.
  - It is stored in `chapters.scene_plan` (TEXT JSON, nullable, migration 0035) with `basedOn`: `hash32` of `JSON.stringify(chapterPlanForGeneration(ch))` at the time it was made.
  - The read schema is lenient: an invalid row reads as null.
- **Agent `scene_plan`.** A structured contract on the subscription backend, registered like `scene_intent`.
  - Input: book title, chapter title, chapter content or the rendered beats, the beat sheet's closing note, the previous chapter's tail, the previous chapters' summary, character cards, world notes, and the scene count K = ceil(target/600).
  - Output: exactly K scenes of 6–8 events.
  - Events are short concrete sentences in the present tense, one action or observation each, characters named by their card names. No dialogue lines and no prose.
  - Nothing beyond the chapter content that changes the plot: fill with the concrete steps, transitions and observations that get from one content point to the next.
  - The last event of the last scene is the chapter's stop point.
  - Trade-off, intended: with thin content Claude fills the scenes with transitional events. The author reviews and edits the plan before writing.
- **API.**
  - `POST /api/chapters/:id/scene-plan` generates the plan, saves it, logs usage as `plot.scene_plan` and returns the chapter.
  - `PATCH /api/chapters/:id` accepts `scenePlan` (scene-plan write schema, or null to clear). An author-saved plan gets the current `basedOn`.
  - The chapter wire carries `scenePlan` and `scenePlanStale` (`basedOn` ≠ the current hash).
- **Write route (local model only).**
  - With a stored scene plan, scene i = `{events, must: last event, stop: last event}` from the plan.
  - Without one: `planLocalScenes` with the density floor K = min(ceil(target/600), max(1, ceil(items/7))), where items = beats or content sentences. Thin content gives a short chapter instead of drift.
  - A stale plan is still used: the author decides. The UI warns.
- **UI.**
  - Where: in the chapter's plan panel, only when the book's writer is `ollama`. Section «План сцен».
  - Buttons «Составить план сцен», «Сохранить», «Очистить».
  - One textarea per scene, one event per line.
  - The running job is published through jobs.ts.
  - Stale warning: «План сцен составлен по прежнему содержанию главы».
  - All words live in labels.ts.

## Unchanged

- Claude output becomes prompt input only, never training data.
- Scene plans do not enter manifest source refs. *(My call: they are a derived view of the chapter plan, which already is a ref.)*
