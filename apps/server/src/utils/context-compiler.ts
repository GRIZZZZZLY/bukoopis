/**
 * ADR 0003 slice 3 — Context Compiler.
 *
 * Assembles the layered memory sources into a single bounded context under a
 * token budget, with a deterministic priority order and a diagnostics record
 * (the "Context Inspector"). Prevents unbounded prompt growth on long books
 * and makes it visible WHAT the model actually received vs what was dropped.
 *
 * Pure and side-effect free — the route decides the budget and logs the
 * diagnostics. POV-aware filtering (objective vs known-to-POV vs hidden) is a
 * separate follow-up (slice 3b); this slice does budgeting + dedup + inspector.
 */

export interface ContextSection {
  /** Stable id for diagnostics + caller mapping ("retrieval", "canon", …). */
  id: string;
  /** Section body (already rendered). Empty/whitespace sections are ignored. */
  text: string | null;
  /** Lower = more important; kept first when the budget is tight. */
  priority: number;
  /** Never dropped even if it blows the budget (instruction, beat-sheet). */
  required?: boolean;
}

export interface CompiledContext {
  includedIds: string[];
  dropped: Array<{ id: string; tokens: number }>;
  totalTokens: number;
  budgetTokens: number;
}

/**
 * Heuristic token estimate. Russian Cyrillic averages ~3 chars/token with the
 * Claude tokenizer (denser than English's ~4). Deliberately a slight
 * over-estimate so the real prompt stays under budget; the exact
 * count-tokens API can replace this at the call site when precision matters.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/**
 * Pack sections under `maxTokens`. Required sections are always kept (and
 * counted). Optional sections are added in priority order until the budget is
 * exhausted; the rest are dropped and recorded. Order of `includedIds` follows
 * the input order (stable), NOT priority, so the caller can rebuild a
 * naturally-ordered prompt.
 */
export function compileContext(
  sections: ContextSection[],
  opts: { maxTokens: number },
): CompiledContext {
  const present = sections.filter(
    (s): s is ContextSection & { text: string } =>
      typeof s.text === "string" && s.text.trim().length > 0,
  );

  const included = new Set<string>();
  const dropped: Array<{ id: string; tokens: number }> = [];
  let total = 0;

  // Required first — always in, even if over budget.
  for (const s of present) {
    if (!s.required) continue;
    included.add(s.id);
    total += estimateTokens(s.text);
  }

  // Optional by ascending priority; ties keep input order (stable sort).
  const optional = present
    .filter((s) => !s.required)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.priority - b.s.priority || a.i - b.i);

  for (const { s } of optional) {
    const tokens = estimateTokens(s.text);
    if (total + tokens <= opts.maxTokens) {
      included.add(s.id);
      total += tokens;
    } else {
      dropped.push({ id: s.id, tokens });
    }
  }

  return {
    includedIds: present.filter((s) => included.has(s.id)).map((s) => s.id),
    dropped,
    totalTokens: total,
    budgetTokens: opts.maxTokens,
  };
}

/** One-line Context Inspector summary for logs. */
export function describeCompiledContext(
  compiled: CompiledContext,
  label: string,
): string {
  const dropped =
    compiled.dropped.length > 0
      ? ` | dropped ${compiled.dropped.map((d) => `${d.id}(~${d.tokens}t)`).join(", ")}`
      : "";
  return `[context] ${label}: ~${compiled.totalTokens}/${compiled.budgetTokens}t · included ${compiled.includedIds.join(", ")}${dropped}`;
}
