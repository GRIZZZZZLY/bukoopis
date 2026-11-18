# Verification: five practices from the Claude Code team's article

The author chose all five on 2026-11-17 after reading «How the Claude Code team thinks about verification» (claude.dev blog, 2026-11-16).

## Why

On 2026-11-17 a live chapter run found that our local Writer drifts when its plan is thin. About 2000 green unit tests could not see it, because they mock the models. Three other misses that day were caught by hand:
- concept agents had no rules against machine-style Russian, while the Writer had them;
- local absolute paths sat in committed docs until a grep just before the push;
- the port of the manner line was checked against the Python original on two examples only.

## What gets built

| # | Practice from the article | Here |
|---|---|---|
| 1 | A miss becomes a rule | Every structured agent whose text the author reads carries one shared language rule. A guard test fails for a new agent that has neither the rule nor a stated exemption. |
| 2 | End-to-end check with evidence | `pnpm live:chapter` writes a chapter through the real route on a copy of the database and reports numbers: scenes, words, narration person per scene, the most repeated phrase, how it stopped. |
| 3 | Differential and property tests | The manner port is compared with the Python original on 200 fixture texts. Scene planning and the prompt builder are checked by properties over 500 seeded random inputs. |
| 4 | REVIEW.md, read from the base branch | `REVIEW.md` at the repo root: what a reviewer checks first here, how findings are tagged, and the rule that weakened tests are listed and judged. |
| 5 | Cheap checks first | `pnpm check:outgoing` scans outgoing commits for local absolute paths, keys and session links. |

## Approaches considered

- **Language rule: prompt rule with guard test (chosen).**
  - Rejected: a code-side detector with a retry for every agent, as pitches have. It would add a paid call to large documents.
  - The prompt rule held imperfectly in pitches (3 contrast phrases in 4 pitches). That limit is accepted and stated to the author.
- **Live check: in-process app on a database copy (chosen).** It calls the same route the product calls, with no port and no child process to kill. A child server on a spare port is the fallback if the app cannot be built in-process.
- **Parity: a committed fixture produced once by the Python original (chosen).** Python lives outside the repo, so tests cannot call it.
- **Properties: a seeded loop in plain vitest (chosen)** over adding `fast-check`. The inputs are small integers and short lists; shrinking is not worth a new dependency.
- **Outgoing check: a script the agent runs before a push (chosen).** Husky is out of scope by a locked decision. A Claude Code hook that runs the script on `git push` is added to the author's local settings separately.

## Decisions

- **Critics, the Reviser, the editor, inline and the Writer are not touched by item 1.** Their prompts are tuned as a chain (docs/prompts/agents-2026-09-23.md); Writer, Reviser and inline already carry the cliché rule. Critic remarks therefore stay as they are: a known limit.
- **The live check never writes the author's database.** It opens the source read-only, copies it, and works on the copy. It makes a paid model call only with `--scene-plan`.
- **Hard failures of the live check are objective breakages only:**
  - a route error;
  - the model being unavailable;
  - a proposal that is not `ready`;
  - a chapter whose narration person differs from the previous chapter's.

  Repeats and short scenes are warnings with numbers.
- **The Python original is the oracle for the manner line.** The model was trained on its output.

## Non-goals

- Browser-driven end-to-end tests.
- A second reviewer.
- Tracking reverts.
- CI (out of scope by a locked decision).
