# Verification Practices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four checks that catch what mocked unit tests cannot: an outgoing-commit scan, a parity fixture plus property tests, a shared language rule with a guard test, and a live chapter check with measured evidence.

**Architecture:**
- Each check is a small pure core with vitest tests, plus a thin script or prompt change around it.
- The live check builds the real server app in-process on a copy of the database and calls the same routes the product calls.
- `REVIEW.md` at the repo root is already written (it ships in the same commit as this plan) and tells reviewers how to judge these and later changes.

**Tech Stack:** TypeScript strict ESM, vitest, tsx scripts in `apps/server/src/scripts`, better-sqlite3, Hono.

**Spec:** docs/superpowers/specs/2026-11-18-verification-design.md

## Global Constraints

- No new dependencies.
- Tests mock LLM calls. `pnpm live:chapter` is a script, not a test, and is the only thing here that calls real models.
- Regexes over Russian text never use `\b` or `lower()`. Use `\p{L}`/`\p{N}` lookarounds with the `u` flag.
- No local absolute paths, keys or session links in any file or commit message.
- No `.transform` in tool schemas. No schema changes in this plan.
- The prompts of the Writer, the critics, the Reviser, the editor family and inline do not change.
- New Russian prompt text does not use the «не X, а Y» contrast and adds no quota rules.
- Every new guard test is shown to fail when the rule it guards is broken (a mutation check: break it, see red, restore). The report records the command and the failing output.
- UI words live only in `apps/web/src/lib/labels.ts`. This plan adds no UI.
- Each task adds its own line to `CLAUDE.md` where a command or rule is introduced. CLAUDE.md is a map of rules in force; keep additions to one or two lines.
- Commit messages are in Russian and end with a blank line plus `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Before the last commit of a task, run `pnpm test` and `pnpm typecheck` from the worktree root. The last full run had 2087 passing.

## Review Focus

1. **The live check must not touch the author's database.** The source file is opened read-only and is byte-identical after a run. → Task 4 test `source database is unchanged`.
2. **A false alarm in the outgoing check must have an escape**, or it blocks every push. → Task 1 test `allow marker`.
3. **A new agent added later without the language rule** must fail the guard, not pass silently. → Task 3 test `unknown agent fails the guard`.
4. **The parity test must fail when the port drifts.** → Task 2 mutation check.
5. **Ollama down during a live check** gives a readable failure and exit code 1, not a hang. → Task 4 test `model unavailable`.

---

### Task 1: Outgoing-commit check (`pnpm check:outgoing`)

**Files:**
- Create `apps/server/src/utils/outgoing-check.ts` (pure).
- Create `apps/server/src/scripts/check-outgoing.ts` (reads git, prints, sets the exit code).
- Create `apps/server/src/utils/__tests__/outgoing-check.test.ts`.
- Modify `apps/server/package.json` (script `check:outgoing`), root `package.json` (`"check:outgoing": "pnpm --filter @book-forge/server check:outgoing"`), `CLAUDE.md` (Commands: one line).

**Interfaces:**
- `interface AddedLine { file: string; line: number; text: string }`
- `interface OutgoingProblem { where: string; kind: "local_path" | "secret" | "session_link" | "forbidden_file"; excerpt: string }`
- `findOutgoingProblems(input: { added: AddedLine[]; messages: string[]; addedFiles: string[] }): OutgoingProblem[]`
- `parseAddedLines(unifiedDiff: string): AddedLine[]`. Input is `git diff --unified=0` output. It returns only `+` lines, with the file and the new line number.

**What counts as a problem:**
- `local_path`:
  - a Windows drive path into a local root: a drive letter, `:`, `\` or `/`, then one of `Users`, `models`, `PROJECTS`, `Temp`, `Ollama` (case-insensitive, not followed by a letter);
  - the Git Bash form `/c/Users/…`, `/d/models/…`, `/d/PROJECTS/…`. (check-outgoing: allow)
- `secret`:
  - `sk-ant-` followed by 10 or more key characters;
  - `ghp_` followed by 30 or more;
  - `ANTHROPIC_API_KEY` followed by `=` and a non-empty value that is not a placeholder (`<…>`, `…`, `xxx`, `your-key`).
- `session_link`: `claude.ai/code/`, `claude.ai/chat/`, `vault://`, `Claude-Session:`. (check-outgoing: allow)
- `forbidden_file`: an added path that is `.env` or ends with `.env`, `.sqlite`, `.sqlite-wal`, `.sqlite-shm`, `.gguf`, `.safetensors`.
- The same patterns are applied to commit messages (`where` = `commit message`).
- **Allow marker:** a line containing `check-outgoing: allow` is skipped.
- The check's own source and test are skipped by file path.

**Script behaviour:**
- The base is the first argument, default `origin/main`.
- It runs `git diff --unified=0 <base>...HEAD`, `git diff --name-only --diff-filter=A <base>...HEAD` and `git log --format=%B <base>..HEAD`.
- It prints one line per problem (`kind  where  excerpt`) and exits 1.
- With no problems it prints «Исходящие правки чистые: N строк, M версий» and exits 0.
- If the base does not exist it prints a readable message and exits 2.

- [ ] **Step 1: Write failing tests.**
  - `windows local path is reported`: three added lines, each holding a drive path into `models`, `Users` or `PROJECTS` in a different slash style.
  - `git bash path is reported`.
  - `relative and repo paths are fine`: `packages/style-engine/src/manner.ts`, `docs/x.md`, `C:` alone, `D:\other` give no problem.
  - `secrets`: an `sk-ant-` key and `ANTHROPIC_API_KEY=` with a value are reported. `ANTHROPIC_API_KEY=<your key>` and the bare name `ANTHROPIC_API_KEY` are not.
  - `session links`.
  - `forbidden files`: `apps/server/.env`, `data/db.sqlite`, `x.gguf`.
  - `commit message is scanned`.
  - `allow marker`: a line with a local path plus `check-outgoing: allow` gives no problem.
  - `parseAddedLines`: a two-hunk diff gives the right files and line numbers, and removed lines are ignored.
  - Build the forbidden strings in the test by concatenation, so the test file itself contains none of them literally.
- [ ] **Step 2: Run** `npx vitest run src/utils/__tests__/outgoing-check.test.ts` from `apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure module and the script.
- [ ] **Step 4: Run** the test file. Expected: PASS. Run `pnpm check:outgoing` in the worktree. Expected: exit 0 (this branch is clean), or real findings to fix.
- [ ] **Step 5: Mutation check.** Remove the `models` root from the pattern, see `windows local path is reported` fail, restore.
- [ ] **Step 6: Commit** `feat(server): проверка исходящих правок на локальные пути и ключи`.

### Task 2: Parity with the Python original and property tests

**Files:**
- Already present: `packages/style-engine/src/__tests__/fixtures/manner-parity.json`. It holds 200 cases of `{text, expected}` produced once by the Python original of `manner_line` (which lives in the fine-tune workspace, outside this repo) from seeded synthetic texts.
- Create `packages/style-engine/src/__tests__/manner-parity.test.ts`.
- Create `packages/agents/src/__tests__/local-writer.property.test.ts`.
- Modify `packages/style-engine/src/manner.ts` only if a case fails. The Python output is the oracle: the model was trained on it.

**Parity test:**
- Read the fixture with `node:fs`.
- For every case `mannerLine(text)` equals `expected`.
- On a mismatch the message shows the case index and the first 60 chars of the text.
- A header comment says what the fixture is, that the Python original is the oracle, and that regenerating it needs the fine-tune workspace. No local paths in the comment.
- Assert the fixture has at least 150 cases, and at least one case of each kind: first person, third person, with the reply part, without it.

**Property tests** for `planLocalScenes`, `buildLocalScenePrompt` and `localTail` (packages/agents/src/local-writer.ts). Use a seeded PRNG written in the test file (mulberry32), 500 cases per property. On failure the message carries the seed and the case number.
- **P1 nothing lost:** with beats, the scenes' `events` concatenated equal the beats' summaries in order. With content only, they equal its sentences in order.
- **P2 scene count:** equals `max(1, min(ceil(target/600), ceil(items/7)))`, where target = `estimatedWords` or 3000 and items = the number of beats or sentences. With no items it is 1.
- **P3 even split:** scene sizes never increase from one scene to the next and differ by at most 1.
- **P4 obligations:** every scene has at least one event, and `must` equals its last event. `stop` equals its last event, except in the last scene when the beat sheet has a non-empty `closing.note`, where `stop` equals the note.
- **P5 prompt shape:**
  - the prompt starts with `### План главы\n` and ends with `### Текст главы\n`;
  - it has exactly one of each of the four section headers;
  - its events are numbered 1..n without gaps;
  - it has a `Манера:` line exactly when `manner` is not null.
- **P6 tail:**
  - the result is never longer than 600 chars;
  - it is `—` exactly when the trimmed input is empty or null;
  - for a trimmed input of at most 600 chars it equals the trimmed input;
  - otherwise it is a suffix of the trimmed input.

Random inputs: 0–40 beats with short distinct summaries, `estimatedWords` chosen from `undefined`, `0`, and 200–12000, an optional closing note, content of 0–40 short distinct sentences, and tail texts of 0–3000 chars built from short sentences.

- [ ] **Step 1: Write the parity test and the property tests.**
- [ ] **Step 2: Run** `pnpm --filter @book-forge/style-engine test` and `pnpm --filter @book-forge/agents test`. Expected: parity passes on 200 of 200 (a pre-check by the controller found 0 mismatches). Properties pass, or a failing property names a real defect: stop and report it; do not bend the property.
- [ ] **Step 3: Mutation checks.**
  - In `manner.ts`, replace half-to-even rounding with `Math.round` and see the parity test fail. Restore.
  - In `local-writer.ts`, change the 7 in the density floor to 6 and see P2 fail. Restore.
  - Record both failing outputs in the report.
- [ ] **Step 4: Commit** `test(style,agents): сверка манеры с оригиналом на 200 текстах и свойства деления на сцены`.

### Task 3: One language rule for every author-facing agent, with a guard

**Files:**
- Create `packages/agents/src/language-rules.ts`: the shared constant and the exemption list.
- Modify `packages/agents/src/concept/language-rules.ts`: re-export from the new file, or delete it and update the three concept imports.
- Modify the system prompts of the agents classified as author-facing (see below).
- Create `packages/agents/src/__tests__/language-rules-guard.test.ts`.
- Modify `CLAUDE.md` (LLM section: one line about the rule and the guard).

**Interfaces:**
- `AUTHOR_FACING_LANGUAGE_RULES: string` — the text now in `CONCEPT_LANGUAGE_RULES` (plain-language rules plus `renderClicheRule()` from `@book-forge/shared`), moved, not rewritten.
- `LANGUAGE_RULE_EXEMPT: Partial<Record<AgentName, string>>` — agent name → the reason it does not carry the rule, one short English sentence.

**Classification.** Go through every name in `STRUCTURED_AGENT_NAMES` (packages/llm/src/types.ts) and put it in exactly one group:
- **Carries the rule:** the agent writes Russian text that the author reads as text. Expected here:
  - the concept agents (already done);
  - aspect documents, aspect variants and aspect refine;
  - entity variants (character and item proposals);
  - `plot_outline` and `plot_chapter_plan`;
  - `lore` and `character`;
  - `scene_plan`;
  - `book_chat`;
  - `summarizer`.
- **Exempt, with a reason:**
  - extractors, classifiers, the reranker, cast check, scene intent and the scene-state extractor (they return facts, labels, quotes or working notes for another prompt);
  - the critics, `editor`, `editor_phrase`, `inline`, `canon_guard` (their prompts are tuned as a chain and are out of this plan);
  - `style_extractor` and `style_blender` (registered in the server; they describe a style).

  If an agent does not clearly fit, say so in the report and choose the safer option: carry the rule.

**How the rule enters a prompt:**
- Append the constant once, after the agent's own rules.
- If the prompt already has its own wording against clichés that says the same thing, replace that wording with the constant. If it says something more specific, keep it and add the constant.
- Do not otherwise rewrite these prompts.
- If a prompt you touch contains the «не X, а Y» contrast in its own text, rephrase that sentence. `findContrastClichés` (packages/agents/src/concept/contrast-cliches.ts) can find candidates; it has false positives, so judge each.

**Guard test:**
- Register the contracts the way production does (the bootstrap function), then for every name in `STRUCTURED_AGENT_NAMES`:
  - a registered contract whose `systemPrompt` contains `renderClicheRule()` passes;
  - otherwise the name must be a key of `LANGUAGE_RULE_EXEMPT` with a non-empty reason;
  - a name that has the rule and is also listed as exempt fails;
  - an exempt key that is not a known agent name fails.
- `unknown agent fails the guard`: the check is a function `checkLanguageRuleCoverage(names, getSystemPrompt, exempt)`. A test calls it with one extra made-up name that has neither the rule nor an exemption and expects a failure naming it.
- Names whose contracts are registered outside this package (`style_extractor`, `style_blender`) are covered by the exemption list.

- [ ] **Step 1: Write the guard test** (it fails: most agents have neither the rule nor an exemption).
- [ ] **Step 2: Run** `pnpm --filter @book-forge/agents test -- language-rules-guard`. Expected: FAIL, listing the uncovered agents. Put that list in the report.
- [ ] **Step 3: Implement:** move the constant, add the rule to the author-facing prompts, fill the exemption list.
- [ ] **Step 4: Run** the agents tests and `pnpm typecheck`. Expected: PASS. Existing prompt tests that assert exact prompt text may need their expectation updated: say so in the commit.
- [ ] **Step 5: Mutation check.** Remove the constant from one author-facing prompt, see the guard fail and name that agent, restore.
- [ ] **Step 6: Commit** `feat(agents): общее правило языка у всех помощников, чей текст читает автор, и страж`.

The report must contain a table: every structured agent, its group, and for exempt ones the reason.

### Task 4: Live chapter check (`pnpm live:chapter`)

**Files:**
- Create `apps/server/src/utils/live-metrics.ts` (pure) and `apps/server/src/utils/__tests__/live-metrics.test.ts`.
- Create `apps/server/src/scripts/live-chapter.ts`: argument parsing, a core `runLiveChapter(options, deps)` and the report writer.
- Create `apps/server/src/scripts/__tests__/live-chapter.test.ts`.
- Modify:
  - `packages/style-engine/src/manner.ts` and its index: export `narrationPerson(text): "first" | "third"`, used by `mannerLine` itself;
  - `apps/server/src/routes/plot.ts`: where it now matches the words «от первого лица», use `narrationPerson`;
  - `apps/server/package.json` and root `package.json` (script `live:chapter`);
  - `.gitignore` (`data/live-checks/`);
  - `CLAUDE.md` (Commands: one line).

**Interfaces:**
- `mostRepeatedPhrase(text: string, n = 6): { count: number; phrase: string }` — the most frequent run of `n` words. Words are found with `\p{L}\p{N}` and compared lower-cased with `toLocaleLowerCase("ru")`. `{0, ""}` when the text is shorter than `n` words.
- `measureScene(text: string): { words: number; person: "first" | "third" }`
- `measureChapter(input: { scenes: string[]; previousChapterText: string | null }): LiveMetrics`, where `LiveMetrics = { words: number; scenes: { words: number; person: "first" | "third" }[]; person: "first" | "third"; previousPerson: "first" | "third" | null; personKept: boolean | null; repeat: { count: number; phrase: string }; manner: string }`
- `judgeLiveRun(input: { metrics: LiveMetrics; proposalStatus: string; stopReason: string | null }): { failures: string[]; warnings: string[] }`

**Judging:**
- Failures:
  - the proposal status is not `ready`;
  - `personKept === false`.
- Warnings:
  - `repeat.count >= 4`;
  - a scene under 150 words;
  - a scene whose person differs from the chapter's.
- The messages are Russian sentences with the numbers in them.

**Script:**
- **Arguments:**
  - `--book <id>` (required);
  - either `--chapter <id>`, or `--new-title <text>` with `--intent <text>` or `--intent-file <path>`;
  - `--model <ollama tag>`;
  - `--save-drafts`;
  - `--scene-plan`;
  - `--db <path>` (default: the same database the server uses);
  - `--out <dir>` (default `data/live-checks/<timestamp>`).
- **The author's database is never written.** Open the source read-only, copy it with better-sqlite3 `backup()` into the out dir, and do everything on the copy, including migrations.
- **Preparation in the copy:**
  - with `--model`, set the book's `writer_provider` to `ollama` and `writer_local_model` to the tag;
  - with `--save-drafts`, give every chapter of the book that has a draft and no current version a version made from its draft, in the same shape the product stores;
  - with `--new-title`, create the chapter and set its intent through the product's routes.
- **Running:**
  - Build the server app in-process on the copy, the same way production does (the app factory in `apps/server/src/app.ts` plus the production bootstrap of agent contracts), and call the routes with `app.request(...)`.
  - With `--scene-plan`, call `POST /api/chapters/:id/scene-plan` first and save the plan to `scene-plan.json`.
  - Then call `POST /api/chapters/:id/write` and read the SSE stream. Text chunks between `beat` events are one scene.
  - Background workers the app starts must not keep the process alive after the run: stop them or exit explicitly.
  - If the app cannot be built in-process, start the server as a child on a free port and stop it afterwards. Say in the report which way was used and why.
- **Output** in the out dir:
  - `chapter.txt`;
  - `report.json` (metrics, failures, warnings, timings, model id, the options used);
  - `report.md` in Russian: a short table (scenes, words, time, how it stopped, narration person per scene, the most repeated phrase and its count), then failures and warnings.

  The same table is printed to the console.
- **Exit code:** 0 with no failures; 1 with failures or a route error. A 503 `local_model_unavailable` is a failure with the server's message.

- [ ] **Step 1: Write failing tests.**
  - `live-metrics`:
    - `mostRepeatedPhrase` finds a phrase repeated 3 times and returns `{0,""}` for a short text;
    - `measureChapter` reports per-scene words and person, and `personKept` true, false and null (no previous chapter);
    - `judgeLiveRun`: `incomplete` status → a failure; person not kept → a failure; repeat of 4 → a warning; a 100-word scene → a warning; a clean run → both lists empty.
  - `live-chapter` with `@book-forge/agents` mocked as in `routes/__tests__/write-local.test.ts`:
    - `source database is unchanged`: the source file's bytes are identical before and after a run, and the copy holds the proposal;
    - `writes report files`: `chapter.txt`, `report.json` and `report.md` exist, and the JSON carries the scene count and words;
    - `save-drafts gives the previous chapter a version`, so the first scene's prompt carries a manner line;
    - `model unavailable`: the kind is `unavailable` → exit code 1, and the report has the server's message;
    - `argument errors`: no `--book`, or both `--chapter` and `--new-title` → a readable message and exit code 2.
- [ ] **Step 2: Run** the two test files from `apps/server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, then `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Mutation check.** Make the script open the source database writable and write a marker row, see `source database is unchanged` fail, restore.
- [ ] **Step 6: Commit** `feat(server): живая проверка главы одной командой с замерами`.

The controller runs the real check after this task (Ollama and the local model are needed) and attaches its report.
