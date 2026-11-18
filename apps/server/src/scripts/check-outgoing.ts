/* eslint-disable no-console */
import { execFileSync } from "node:child_process";
import { findOutgoingProblems, parseAddedLines } from "../utils/outgoing-check.js";

const base = process.argv[2] ?? "origin/main";
const git = (...args: string[]): string =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

try {
  git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
} catch {
  console.error(`База "${base}" не найдена. Укажите существующую ветку: pnpm check:outgoing <base>`);
  process.exit(2);
}

const added = parseAddedLines(git("diff", "--unified=0", `${base}...HEAD`));
const addedFiles = git("diff", "--name-only", "--diff-filter=ACR", `${base}...HEAD`)
  .split("\n")
  .filter(Boolean);
const messages = git("log", "--format=%B%x00", `${base}..HEAD`)
  .split("\0")
  .map((m) => m.trim())
  .filter(Boolean);

const { problems, allowed } = findOutgoingProblems({ added, messages, addedFiles });
for (const w of allowed) console.log(`allowed  ${w}`);
if (problems.length > 0) {
  for (const p of problems) console.log(`${p.kind}  ${p.where}  ${p.excerpt}`);
  process.exit(1);
}
console.log(
  `Исходящие правки чистые: ${added.length} строк, ${messages.length} версий, пропущено по метке: ${allowed.length}`,
);
