import { describe, expect, it } from "vitest";
import { findOutgoingProblems, parseAddedLines, type AddedLine } from "../outgoing-check.js";

// Forbidden strings are assembled here so this file stays clean under its own check.
const BS = "\\";
const win = (root: string, sep = BS) => `C:${sep}${root}${sep}x`;
const ant = "sk-" + "ant-" + "abcdefghij1234";
const keyName = "ANTHROPIC" + "_API_KEY";

const line = (text: string, file = "docs/x.md"): AddedLine => ({ file, line: 1, text });
const run = (added: AddedLine[], messages: string[] = [], addedFiles: string[] = []) =>
  findOutgoingProblems({ added, messages, addedFiles });

describe("findOutgoingProblems", () => {
  it("windows local path is reported", () => {
    const added = [
      line("see " + win("models")),
      line("see " + win("Users", "/")),
      line("see d:" + BS + "projects" + BS + "a"),
    ];
    const p = run(added);
    expect(p.map((x) => x.kind)).toEqual(["local_path", "local_path", "local_path"]);
  });

  it("git bash path is reported", () => {
    expect(run([line("cd /d/models/x"), line("cd /c/Users/me")]).map((x) => x.kind)).toEqual([
      "local_path",
      "local_path",
    ]);
  });

  it("relative and repo paths are fine", () => {
    const added = [
      line("packages/style-engine/src/manner.ts"),
      line("docs/x.md"),
      line("drive C: alone"),
      line("D:" + BS + "other"),
    ];
    expect(run(added)).toEqual([]);
  });

  it("secrets", () => {
    expect(run([line("key " + ant)]).map((x) => x.kind)).toEqual(["secret"]);
    expect(run([line(keyName + "=realvalue123")]).map((x) => x.kind)).toEqual(["secret"]);
    expect(run([line(keyName + "=<your key>")])).toEqual([]);
    expect(run([line(keyName + "=your-key")])).toEqual([]);
    expect(run([line("set " + keyName + " in .env")])).toEqual([]);
    expect(run([line("`" + keyName + "=` with a value")])).toEqual([]);
  });

  it("session links", () => {
    const added = [
      line("https://claude.ai/" + "code/abc"),
      line("https://claude.ai/" + "chat/abc"),
      line("vault" + "://x"),
      line("Claude-" + "Session: abc"),
    ];
    expect(run(added).map((x) => x.kind)).toEqual(Array(4).fill("session_link"));
  });

  it("forbidden files", () => {
    const p = run([], [], ["apps/server/.env", "data/db.sqlite", "x.gguf", "docs/ok.md", ".env.example"]);
    expect(p.map((x) => x.where)).toEqual(["apps/server/.env", "data/db.sqlite", "x.gguf"]);
    expect(p.every((x) => x.kind === "forbidden_file")).toBe(true);
  });

  it("commit message is scanned", () => {
    const p = run([], ["fix\n\nsee " + win("PROJECTS")]);
    expect(p).toHaveLength(1);
    expect(p[0]?.where).toBe("commit message");
  });

  it("allow marker", () => {
    expect(run([line("see " + win("models") + " check-outgoing: allow")])).toEqual([]);
  });

  it("own source and test are skipped", () => {
    const bad = "see " + win("models");
    expect(run([line(bad, "apps/server/src/utils/outgoing-check.ts")])).toEqual([]);
    expect(run([line(bad, "apps/server/src/utils/__tests__/outgoing-check.test.ts")])).toEqual([]);
  });

  it("reports file and line", () => {
    const p = run([{ file: "a.md", line: 7, text: win("Temp") }]);
    expect(p[0]?.where).toBe("a.md:7");
  });
});

describe("parseAddedLines", () => {
  it("returns added lines with file and new line numbers", () => {
    const diff = [
      "diff --git a/a.md b/a.md",
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -3,1 +3,2 @@",
      "-old",
      "+new1",
      "+new2",
      "@@ -10,0 +12 @@",
      "+later",
      "diff --git a/b.md b/b.md",
      "--- a/b.md",
      "+++ b/b.md",
      "@@ -0,0 +1 @@",
      "+first",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "a.md", line: 3, text: "new1" },
      { file: "a.md", line: 4, text: "new2" },
      { file: "a.md", line: 12, text: "later" },
      { file: "b.md", line: 1, text: "first" },
    ]);
  });
});
