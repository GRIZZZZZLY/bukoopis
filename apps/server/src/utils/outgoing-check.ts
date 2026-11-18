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

const PATTERNS: { kind: OutgoingProblem["kind"]; re: RegExp }[] = [
  { kind: "local_path", re: /(?<![\p{L}\p{N}])[A-Za-z]:[\\/](?:Users|models|PROJECTS|Temp|Ollama)(?![\p{L}])/iu },
  { kind: "local_path", re: /(?<![\p{L}\p{N}/])\/[a-z]\/(?:Users|models|PROJECTS|Temp|Ollama)(?![\p{L}])/iu },
  { kind: "secret", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { kind: "secret", re: /ghp_[A-Za-z0-9]{30,}/ },
  { kind: "session_link", re: /claude\.ai\/(?:code|chat)\/|vault:\/\/|Claude-Session:/ },
];
const API_KEY_ASSIGN = /ANTHROPIC_API_KEY\s*=\s*["']?([\p{L}\p{N}][^\s"']*)/u;
const PLACEHOLDER = /^[<$…]|xxx|your-key/i;
const FORBIDDEN_FILE = /(?:^|\/)\.env$|\.env$|\.(?:sqlite|sqlite-wal|sqlite-shm|gguf|safetensors)$/;
const ALLOW = "check-outgoing: allow";
const SELF = /(?:^|\/)outgoing-check(?:\.test)?\.ts$/;

function scanText(text: string): { kind: OutgoingProblem["kind"]; excerpt: string }[] {
  if (text.includes(ALLOW)) return [];
  const out: { kind: OutgoingProblem["kind"]; excerpt: string }[] = [];
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ kind, excerpt: m[0] });
  }
  const k = API_KEY_ASSIGN.exec(text);
  if (k && !PLACEHOLDER.test(k[1] ?? "")) out.push({ kind: "secret", excerpt: k[0] });
  return out;
}

export function findOutgoingProblems(input: {
  added: AddedLine[];
  messages: string[];
  addedFiles: string[];
}): OutgoingProblem[] {
  const problems: OutgoingProblem[] = [];
  for (const a of input.added) {
    if (SELF.test(a.file)) continue;
    for (const p of scanText(a.text)) problems.push({ where: `${a.file}:${a.line}`, ...p });
  }
  for (const msg of input.messages) {
    for (const l of msg.split("\n")) {
      for (const p of scanText(l)) problems.push({ where: "commit message", ...p });
    }
  }
  for (const f of input.addedFiles) {
    if (FORBIDDEN_FILE.test(f)) problems.push({ where: f, kind: "forbidden_file", excerpt: f });
  }
  return problems;
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
      file = l.startsWith("+++ b/") ? l.slice(6) : "";
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
