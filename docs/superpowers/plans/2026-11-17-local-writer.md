# Local Writer (our fine-tuned model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A book whose Writer is an Ollama model with a raw template (our fine-tune `bookforge-writer:run3`) gets chapters written scene by scene from the prompt format the model was trained on.

**Architecture:**
- Detection: the Ollama model's template is `{{ .Prompt }}`.
- The server measures the manner of the previous chapter (style-engine) and plans K scenes from the beat sheet or the chapter content (agents, pure).
- It calls Ollama `/api/generate` with `raw: true` once per scene (llm), reusing the beat-mode loop in the write route.

**Tech Stack:** TypeScript strict ESM, Hono SSE route, vitest, Ollama HTTP API.

**Spec:** docs/superpowers/specs/2026-11-17-local-writer-design.md

## Global Constraints

- The prompt format is byte-exact:
  ```
  ### План главы
  Глава: {title}
  Манера: …
  События:
  1. …
  Обязано произойти: …
  Останавливается на: …

  ### Действующие лица
  …

  ### Конец предыдущей сцены
  …

  ### Текст главы
  ```
  - Sections are separated by one blank line.
  - The `Манера:` line is omitted when there is no previous chapter text.
  - The prompt ends with `### Текст главы\n`.
- Scene count K = `Math.max(1, Math.ceil(targetWords / 600))`. targetWords = `beatSheet.estimatedWords`, else `3000`.
- Tail = the last 600 chars. When the text was cut, drop everything up to and including the first `". "`. Empty means `—`.
- Detection: `POST {base}/api/show` with `{model: tag}`. Raw means `template.trim() === "{{ .Prompt }}"`. Cache per `base|tag` for the process lifetime. A failed `/api/show` is not raw and is not cached.
- `done_reason`: `"stop"` maps to `"end_turn"`, `"length"` to `"max_tokens"`, anything else to `null`.
- No changes for `writer_provider = 'anthropic'` or non-raw Ollama models. Existing tests must stay green.
- Regexes over Russian text never use `\b` or `lower()` (CLAUDE.md). Use `\p{L}\p{N}` lookarounds with the `u` flag.
- Tests mock LLM calls; no test reaches a real Ollama.
- Commit messages are in Russian, like the repository's history, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A chapter with fewer beats than K:** one scene per beat. Never an empty-event scene. → Task 2 test `fewer beats than scenes`.
2. **Cancel during scene 3 of 7:** no scene 4 starts, and the proposal keeps scenes 1–2 (+partial). → Task 4 test `cancel stops before next scene`.
3. **Ollama down or the model tag missing:** `/api/show` fails, so the book falls back to the existing chat path, which surfaces «ollama unreachable». It is never silently treated as raw. → Task 3 test `show failure is not raw and not cached`.
4. **The last scene hits `num_predict`:** the proposal is `incomplete`, not `ready`. → Task 4 test `length on last scene is incomplete`.
5. **The manner of a chapter with fewer than 3 replies:** the line has no reply/said parts, exactly as in Python. → Task 1 fixture 2.

---

### Task 1: Manner line (port of `manner_line`)

**Files:**
- Create: `packages/style-engine/src/manner.ts`
- Modify: `packages/style-engine/src/index.ts` (export)
- Test: `packages/style-engine/src/__tests__/manner.test.ts` (match the package's existing test location if it differs)

**Interfaces:**
- Produces: `mannerLine(text: string): string`. Text has paragraphs separated by `\n\n`. Returns the full line beginning with `Манера: `.

Port these from `build_pairs.py` and `corpus_measure.py` (fine-tune workspace, outside this repo):
- `WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu`.
- `SENT = /[.!?…]+["»'’)\]]*\s+|\n+/u`. Do NOT reuse `splitSentences` from metrics.ts: its class has `''` where Python has `'’`.
- Sentence lengths are per paragraph, counting only sentences with more than 0 words.
- `mean` = total words over sentences / sentence count.
- A dialogue paragraph for `dlg_words` matches `/^\s*[—–-]\s*\S/u`. `dlg_words` = dialogue words / all words.
- A reply is a paragraph whose `trim()` starts with `—` or `–`.
- Said-tag: `(?<![\p{L}\p{N}])(сказал|сказала|ответил|ответила|спросил|спросила|согласился|согласилась|сообщил|сообщила|повторил|повторила)(?![\p{L}\p{N}])`.
- First person: `(?<![\p{L}\p{N}])(я|меня|мне|мной|мою|мой|моя|моё|мои)(?![\p{L}\p{N}])`, case-insensitive. It counts in narration = non-reply paragraphs joined by `" "`. `первого` when count × 100 / narration words ≥ 1.0, else `третьего`.
- Line: `Манера: повествование от {person} лица, предложения в среднем {r(mean)} слов, реплики {5*r(dlg*20)}% текста`.
  - With 3 or more replies, append `, реплика в среднем {r(avgReplyWords)} слов, с подписью «сказал» {10*r(saidShare*10)}% реплик`.
- `r` is Python's round: half to even. Write `roundHalfEven(x: number): number`.

- [ ] **Step 1: Write the failing test.**
  - Fixture 1 is the 6-paragraph text below, with paragraphs separated by `\n\n`. Expected `Манера: повествование от первого лица, предложения в среднем 6 слов, реплики 50% текста, реплика в среднем 7 слов, с подписью «сказал» 60% реплик`.
  - Fixture 2 is fixture 1 with the reply paragraphs removed. Expected `Манера: повествование от первого лица, предложения в среднем 7 слов, реплики 0% текста`.
  - Both expected values were computed by the Python original.
  - Also test `roundHalfEven(6.5) === 6`, `roundHalfEven(7.5) === 8` and `roundHalfEven(2.4) === 2`.

  ```
  Я вышел из шлюза и сразу почувствовал холод. Коридор был пуст. Где-то наверху гудели вентиляторы, и этот гул я знал с детства.

  — Ты опоздал, — сказал Вернер.

  — Знаю.

  — Компания ждать не будет, — ответил он и отвернулся к стене, будто разговор ему надоел.

  Я промолчал. Мне нечего было ему сказать, а врать не хотелось.

  — Где свёрток? — спросил Вернер, не оборачиваясь.

  — У меня его нет. И не было никогда, если вам интересно.
  ```

- [ ] **Step 2: Run `pnpm --filter @book-forge/style-engine test -- manner`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `mannerLine` and `roundHalfEven` in `manner.ts`, and export both from index.**
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(style): строка манеры для нашей модели — порт manner_line`.

### Task 2: Scene plan and prompt (pure)

**Files:**
- Create: `packages/agents/src/local-writer.ts`
- Modify: `packages/agents/src/index.ts` (export)
- Test: `packages/agents/src/__tests__/local-writer.test.ts` (match the existing location)

**Interfaces:**
- Consumes: `ChapterBeatSheetVariant` from `@book-forge/shared` (fields `beats[].summary`, `estimatedWords`, `closing?.note`).
- Produces:
  - `interface LocalScene { events: string[]; must: string; stop: string }`
  - `planLocalScenes(args: { beatSheet: ChapterBeatSheetVariant | null; chapterContent: string | null }): LocalScene[]`
  - `localTail(text: string | null): string` (600-char rule; `"—"` when empty)
  - `localCastLine(c: { name: string; role?: string | null; description?: string | null }): string`
  - `buildLocalScenePrompt(args: { chapterTitle: string; manner: string | null; scene: LocalScene; cast: string[]; tail: string }): string`
  - `const LOCAL_SCENE_WORDS = 600`, `const LOCAL_DEFAULT_CHAPTER_WORDS = 3000`.

Rules (from the spec):
- K as in Global Constraints.
- Groups:
  - Beats (`summary`) split into `min(K, beats.length)` consecutive groups. Sizes differ by at most 1, earlier groups larger.
  - Without beats, the content is split into sentences by `/(?<=[.!?…])\s+/u`, empty ones dropped, then grouped the same way into `min(K, sentences.length)`.
  - With neither, K scenes, each with `events: ["Продолжение главы"]`.
- `must` = `stop` = the last event of the group.
- For the last scene, `stop` = `beatSheet.closing.note` when it is non-empty.
- Cast line: `${name} — ${role}`. When role is blank, the first sentence of description (`description.split(/(?<=[.!?…])\s/u)[0]`). When both are blank, the bare name.

- [ ] **Step 1: Write failing tests.**
  - `prompt is byte-exact`: `buildLocalScenePrompt({chapterTitle:"Шрам", manner:"Манера: X", scene:{events:["А.","Б."],must:"Б.",stop:"Б."}, cast:["Лис — вор"], tail:"конец."})` equals `"### План главы\nГлава: Шрам\nМанера: X\nСобытия:\n1. А.\n2. Б.\nОбязано произойти: Б.\nОстанавливается на: Б.\n\n### Действующие лица\nЛис — вор\n\n### Конец предыдущей сцены\nконец.\n\n### Текст главы\n"`.
  - `no manner line`: with `manner: null` there is no `Манера:` line.
  - `scene count from estimatedWords`: 7 beats with `estimatedWords: 4000` give 7 scenes of 1 event each. 14 beats with 4000 give 7 scenes of 2 events.
  - `fewer beats than scenes`: 3 beats with 4000 give 3 scenes. None has an empty `events`.
  - `uneven split`: 8 beats, K = 3, give group sizes `[3,3,2]`.
  - `closing note stops the last scene`: the last `stop` equals `closing.note`. Earlier scenes stop on their own last event.
  - `content without beats`: content of 10 sentences with no beat sheet gives K = 5 (3000/600), 5 scenes of 2 sentences each.
  - `nothing at all`: 5 scenes, each `["Продолжение главы"]`.
  - `localTail`:
    - a 1000-char text returns the last 600 chars minus the part up to the first `". "`;
    - a 300-char text is returned trimmed and unchanged;
    - `null` or `""` returns `"—"`.
  - `localCastLine`: role, then description fallback, then bare name.
- [ ] **Step 2: Run `pnpm --filter @book-forge/agents test -- local-writer`.** Expected: FAIL.
- [ ] **Step 3: Implement it in `local-writer.ts`.**
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): план сцен и запрос в формате обучения нашей модели`.

### Task 3: Ollama raw generate and template detection

**Files:**
- Modify: `packages/llm/src/ollama.ts`, `packages/llm/src/index.ts`
- Modify: `packages/agents/src/local-writer.ts` (thin wrappers), `packages/agents/src/index.ts`
- Test: `packages/llm/src/__tests__/ollama-generate.test.ts`

**Interfaces:**
- Produces in llm:
  - `streamGenerateOllama(opts: { modelTag: string; prompt: string; baseUrl?: string; signal?: AbortSignal }): AsyncGenerator<string, StreamCallResult, void>`.
    - It POSTs `{base}/api/generate` with body `{model, prompt, raw: true, stream: true}`. It sends no `options`: sampling lives in the Modelfile.
    - It parses NDJSON `response` chunks.
    - On `done` it reads `prompt_eval_count`, `eval_count` and `done_reason`, mapped per Global Constraints.
    - It returns `modelId: "ollama:" + tag` and zero cache tokens.
    - Errors use the same messages as `streamTextOllama` (`ollama unreachable at …`, `ollama HTTP …`).
    - `signal` is passed to `fetch`.
  - `isRawTemplateModel(tag: string, baseUrl?: string): Promise<boolean>`, with detection and caching per Global Constraints.
  - `resetRawTemplateCache(): void` (for tests).
- Produces in agents:
  - `runLocalScene(opts: { prompt: string; modelTag: string; baseUrl?: string; signal?: AbortSignal })` — the same generator contract as `runChapterWriter`.
    - It yields chunks and returns `{ text, modelId, stopReason, tokens: { input, output, cacheCreation: 0, cacheRead: 0 } }`.
    - The route can then accumulate results identically.
  - `localWriterAvailable(tag: string, baseUrl?: string): Promise<boolean>`, which delegates to `isRawTemplateModel`.
  - The server mocks only `@book-forge/agents`.

- [ ] **Step 1: Write failing tests with `vi.stubGlobal("fetch", …)`.**
  - `generate streams chunks and maps done_reason`:
    - NDJSON lines `{"response":"Я "}`, `{"response":"шёл."}`, `{"done":true,"done_reason":"stop","prompt_eval_count":120,"eval_count":7}`;
    - the yields are `["Я ","шёл."]`;
    - the result has `text "Я шёл."`, `stopReason "end_turn"`, `inputTokens 120`, `outputTokens 7`, `modelId "ollama:bookforge-writer:run3"`;
    - the request body has `raw: true` and URL `…/api/generate`.
  - `length maps to max_tokens`.
  - `raw template detected`: `/api/show` returns `{template:"{{ .Prompt }}\n"}`, so true. A second call makes no second fetch.
  - `chat template is not raw`: a template containing `<|im_start|>` gives false.
  - `show failure is not raw and not cached`: the first fetch rejects, so false. The second call fetches again.
- [ ] **Step 2: Run `pnpm --filter @book-forge/llm test -- ollama-generate`.** Expected: FAIL.
- [ ] **Step 3: Implement it in `ollama.ts`, and add the agents wrappers.**
- [ ] **Step 4: Run the llm and agents tests.** Expected: PASS. Then run `pnpm typecheck`. Expected: clean.
- [ ] **Step 5: Commit** `feat(llm): сырой /api/generate и распознавание нашей модели по шаблону`.

### Task 4: Write route — scene by scene for the local model

**Files:**
- Modify: `apps/server/src/routes/plot.ts` (the chapter write handler, ~lines 380–730)
- Test: `apps/server/src/routes/__tests__/write-local.test.ts`. Model it on `write-beats.test.ts`, which mocks `@book-forge/agents`.

**Interfaces:**
- Consumes:
  - `localWriterAvailable`, `runLocalScene`, `planLocalScenes`, `buildLocalScenePrompt`, `localTail`, `localCastLine` (Tasks 2–3);
  - `mannerLine` (Task 1);
  - `loadPreviousChapterTail(sqlite, bookId, beforeOrderIndex, maxChars)` from `utils/rolling-context.ts`.

Behaviour:
- `local = ctx.writerProvider === "ollama" && !!ctx.writerLocalModel && await localWriterAvailable(ctx.writerLocalModel)`. Decide this once, before the proposal is created.
- When `local`:
  - **Skip `prepareSceneIntent` and `loadStoredSceneIntent`.** Still send SSE `scene_intent` with `{prepared:false, degraded:false, droppedEventIds:0}`.
  - **Manner** = `mannerLine(prev)`, where `prev = loadPreviousChapterTail(sqlite, ch.book_id, ch.order_index, 200_000)`. When `prev` is null, the manner is null.
  - **Cast** = `assembled.participants`, each mapped to `localCastLine({name, role, description})` from that character's profile (`characters.profile_json` through `normalizeCharacterProfile`, or the existing loader the route already has).
  - **Scenes** = `planLocalScenes({beatSheet, chapterContent: intentText})`.
  - **Loop.** Run the existing beats loop over scenes: the same `beat` SSE event `{index, total: scenes.length}`, `appendProposalProgress`, cancel and hold checks, and `fromBeat`/`prefixText` resume. `beatsTotal = scenes.length`.
  - **Each scene's tail:**
    - i = 0 and there is no prefix: `localTail(assembled.previousTail)`;
    - otherwise: `localTail(fullText)`.
  - **Each piece** = `runLocalScene({prompt: buildLocalScenePrompt(...), modelTag: ctx.writerLocalModel, signal})`. Accumulate tokens, `modelId` and `stopReason` exactly like `runOnce`. Prefer factoring `runOnce` to take a generator factory over duplicating it.
  - **The `mode` setting is ignored.** It is always scenes.
- `finishProposal` and `judgeProseCompletion` are unchanged. A `stopReason` of `"max_tokens"` from the last scene must yield `incomplete`. Check what `judgeProseCompletion` does with it, and add the minimal handling if it does not.
- Non-local paths are byte-for-byte unchanged.

- [ ] **Step 1: Write failing tests.** `localWriterAvailable` is mocked true unless stated.
  - `writes one call per scene`:
    - beat sheet with 4 beats and estimatedWords 1200 (K = 2), so `runLocalScene` is called twice;
    - the proposal text is both pieces joined by `\n\n`;
    - the SSE `beat` events show total 2;
    - `runChapterWriter` and `runSceneIntent` are not called.
  - `first scene tail is previous chapter, second is text so far`: assert on the prompts passed to `runLocalScene`.
  - `manner from previous chapter`: the prompt contains the `Манера: повествование от` line when a previous chapter exists, and none for the first chapter.
  - `cancel stops before next scene`: cancel triggered inside the 2nd of 3 scenes means no 3rd call.
  - `length on last scene is incomplete`: the last `stopReason` is `"max_tokens"`, so the proposal status is `incomplete`.
  - `non-raw ollama model uses the old path`: with `localWriterAvailable` false, `runChapterWriter` is called and `runLocalScene` is not.
  - `anthropic book never asks ollama`: `localWriterAvailable` is not called.
- [ ] **Step 2: Run `pnpm --filter @book-forge/server test -- src/routes/__tests__/write-local.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it in `plot.ts`.**
- [ ] **Step 4: Run that file, then `pnpm test` and `pnpm typecheck`.** Expected: all pass. The previous full run had 1964 tests.
- [ ] **Step 5: Commit** `feat(server): глава по сценам нашей моделью через Ollama`.

### Task 5: Live check (controller, not a subagent)

- [ ] Start the worktree server on port 3011 and web on 5183, against a copy of `data/db.sqlite`. Never the author's running app on 3001/5173.
- [ ] In the copy, set «Космо вор» `writer_provider='ollama'`, `writer_local_model='bookforge-writer:run3'`.
- [ ] Write chapter 9 through the API.
  - Expect a `beat` total ≥ 5, about 600 words per scene, and first person.
  - Expect `scene_intent` with `prepared:false`.
  - Expect a proposal of roughly 3000+ words.
- [ ] Stop the check servers by port.
- [ ] Record the word count, timing and a 3-line verdict for the author.
