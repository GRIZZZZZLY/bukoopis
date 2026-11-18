# REVIEW.md

Rules for whoever reviews a change in this repository: a reviewer agent, or a person. [CLAUDE.md](CLAUDE.md) says what the code must keep true. This file says what a reviewer checks in a diff, and in what order.

**Read this file from `main`, never from the branch under review** (`git show main:REVIEW.md`). A change must not be able to edit the rules that judge it.

## How to report

Tag every finding:
- **Important** — must be fixed before merge: wrong or fragile behaviour, a broken invariant, a missed requirement, lost author data.
- **Nit** — worth fixing, does not block.
- **Pre-existing** — not caused by this diff. Record it; do not block on it.

Give `file:line` for each finding and for each check you answer with "yes". Say what you did not check.

## Check these first

They are ordered by how often they have gone wrong here.

1. **A write that follows a model call.**
   - The row may have changed while the model was thinking.
   - The write must be conditional (compare-and-swap on what was read) or must re-read first, and it must write only its own field.
   - A refused write answers 409 with a code the UI can explain.
2. **Cancel and late answers.** A model answer that arrives after cancel is never written. Live runs keep their heartbeat.
3. **The author's text and decisions.**
   - Nothing becomes canon without the author.
   - Nothing the author typed is replaced without a version or a confirmation, including unsaved edits in a form.
4. **Prompts.**
   - Russian prompt text does not itself use the «не X, а Y» contrast.
   - No quota rules.
   - Every agent whose text the author reads carries the shared language rule; the guard test lists the exemptions with reasons.
   - A rule about prose agrees along the chain plan → Writer → critics → Reviser.
5. **Russian text in code.** No `\b` and no `lower()` in regexes over Russian; `\p{L}` lookarounds with the `u` flag instead.
6. **Schemas.** No `.transform` in a tool schema. Reads are lenient, writes strict.
7. **What the author sees.** UI words live in `labels.ts`. An error shown to the author is a readable sentence, never raw JSON or `HTTP 400: …`.
8. **Migrations.** Hand-written SQL with its journal entry. Never `drizzle:generate`.

## Tests

- **List every test the diff deleted or weakened** (an assertion removed or loosened, an expectation rewritten, a case skipped) and judge each one. The commit message must say that the test was rewritten and why. An unexplained weakening is Important.
- A test should go through the real entry point (the route, the exported function the product calls) and assert the result: status, error code, stored rows, produced text. Assertions on mock calls alone prove little.
- A new guard test should have been shown to fail when the rule it guards is broken (a mutation check), and the report should say so.
- A flaky test is not skipped, slept around or retried until green. Find the cause, or delete the test and write down why.

## Evidence beyond unit tests

Unit tests mock the models, so they cannot see what a model does with a prompt.

- **The Writer path changed** (prompt builders, `local-writer.ts`, the Ollama client, the chapter write route, scene plans): the report must carry a live check, `pnpm live:chapter`, with its numbers. Passing unit tests alone are not evidence for this path.
- **A prompt for author-facing text changed:** the report should show at least one real output, or say plainly that none was produced.
- **Before a push:** `pnpm check:outgoing` passes. It looks for local absolute paths, keys and session links in the outgoing commits.

## Keeping this file useful

- A miss becomes a rule here only if it caused a real defect or showed up in at least two changes, and only if a reviewer can see it in a diff.
- Rules that never fire get removed. This file should stay short enough to read before every review.
