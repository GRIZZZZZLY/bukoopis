// Pure scan of outgoing changes (added lines, commit messages, added files)
// for local paths, keys and session links. Used by `pnpm check:outgoing`.

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export interface OutgoingProblem {
  where: string;
  kind: "local_path" | "secret" | "session_link" | "forbidden_file";
  excerpt: string;
}

export interface OutgoingResult {
  problems: OutgoingProblem[];
  /** Locations skipped by the allow marker (only where a pattern would have matched). */
  allowed: string[];
}

const PATTERNS: { kind: OutgoingProblem["kind"]; re: RegExp }[] = [
  { kind: "local_path", re: /(?<![\p{L}\p{N}])[A-Za-z]:[\\/]+(?:Users|models|PROJECTS|Temp|Ollama)(?![\p{L}])/iu },
  { kind: "local_path", re: /(?<![\p{L}\p{N}/])\/[a-z]\/(?:Users|models|PROJECTS|Temp|Ollama)(?![\p{L}])/iu },
  { kind: "secret", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { kind: "secret", re: /ghp_[A-Za-z0-9]{30,}/ },
  { kind: "session_link", re: /claude\.ai\/(?:code|chat)\/|vault:\/\/|Claude-Session:/ },
];
const API_KEY_ASSIGN = /ANTHROPIC_API_KEY\s*=\s*["']?([\p{L}\p{N}][^\s"']*)/u;
const PLACEHOLDER = /\.\.\.|…|xxx|your-key|^`/i;
const FORBIDDEN_FILE = /\.env$|\.(?:sqlite|sqlite-wal|sqlite-shm|gguf|safetensors)$/;
const ALLOW = "check-outgoing: allow";
const SELF = new Set([
  "apps/server/src/utils/outgoing-check.ts",
  "apps/server/src/utils/__tests__/outgoing-check.test.ts",
]);

/** A secret is never echoed in full: first 8 characters, an ellipsis and the length. */
const mask = (s: string): string => `${s.slice(0, 8)}…(${s.length})`;

function scanText(text: string): { kind: OutgoingProblem["kind"]; excerpt: string }[] {
  const out: { kind: OutgoingProblem["kind"]; excerpt: string }[] = [];
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ kind, excerpt: kind === "secret" ? mask(m[0]) : m[0] });
  }
  const k = API_KEY_ASSIGN.exec(text);
  if (k && !PLACEHOLDER.test(k[1] ?? "")) out.push({ kind: "secret", excerpt: mask(k[0]) });
  return out;
}

export function findOutgoingProblems(input: {
  added: AddedLine[];
  messages: string[];
  addedFiles: string[];
}): OutgoingResult {
  const problems: OutgoingProblem[] = [];
  const allowed: string[] = [];
  const scan = (text: string, where: string): void => {
    const found = scanText(text);
    if (text.includes(ALLOW)) {
      if (found.length > 0) allowed.push(where);
      return;
    }
    for (const p of found) problems.push({ where, ...p });
  };
  for (const a of input.added) {
    if (!SELF.has(a.file)) scan(a.text, `${a.file}:${a.line}`);
  }
  for (const msg of input.messages) {
    for (const l of msg.split("\n")) scan(l, "commit message");
  }
  for (const f of input.addedFiles) {
    if (FORBIDDEN_FILE.test(f)) problems.push({ where: f, kind: "forbidden_file", excerpt: f });
  }
  return { problems, allowed };
}

/** Git quotes odd paths as "b/\321\204.md": strip the quotes and decode the octal bytes. */
function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (oct) {
      bytes.push(parseInt(oct[0], 8));
      i += 3;
    } else {
      const n = body[++i] ?? "";
      bytes.push(...Buffer.from(n === "t" ? "\t" : n === "n" ? "\n" : n, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Input is `git diff --unified=0` output; returns only `+` lines with the new line number. */
export function parseAddedLines(unifiedDiff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = "";
  let next = 0;
  let inHunk = false;
  for (const raw of unifiedDiff.split("\n")) {
    const l = raw.replace(/\r$/, "");
    if (l.startsWith("diff --git ")) {
      inHunk = false;
      file = "";
    } else if (!inHunk && l.startsWith("+++ ")) {
      const target = unquotePath(l.slice(4));
      file = target.startsWith("b/") ? target.slice(2) : "";
    } else if (l.startsWith("@@")) {
      const m = /\+(\d+)/.exec(l);
      next = m ? Number(m[1]) : 0;
      inHunk = true;
    } else if (inHunk && file && l.startsWith("+")) {
      out.push({ file, line: next++, text: l.slice(1) });
    }
  }
  return out;
}
