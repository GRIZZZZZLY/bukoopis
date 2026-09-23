import { z } from "zod";
import {
  dispatchStructured,
  registerAgentContract,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import type { GenerationConfig } from "@book-forge/shared";

/**
 * Хирургическая правка отмеченных фраз (2026-09-23). Обычная правка,
 * получив три десятка замечаний, переписала бы главу своим «улучшенным»
 * стилем. Здесь модель не пишет текст главы вообще: для каждой фразы она
 * возвращает точный кусок и замену, а подставляет их код — абзацы вокруг
 * не меняются физически.
 */
export const PHRASE_FIX_SYSTEM = `Ты — микроредактор русской прозы. Тебе дают отмеченные фразы, причину отметки и абзац, где каждая стоит.

Исправляй только отмеченный фрагмент. Предпочитай самое простое естественное решение. Не добавляй новую метафору, сравнение, шутку или афоризм вместо удалённого. Не улучшай окружающий текст. Если простое удаление работает — удали. Сохрани смысл, факт и голос персонажа. Если без этого не сходится грамматика или связка, можно захватить одно соседнее предложение — не больше.

После замены сравни исходную и новую фразу. Если новая лишь иначе украшает ту же мысль, перепиши ещё проще.

Для каждой фразы верни: id; before — точный кусок абзаца, который заменяешь, символ в символ: отмеченная фраза целиком или она вместе с одним соседним предложением; after — чем его заменить (пустая строка — удалить). Если фразу нельзя исправить, не испортив смысл, — не включай её в ответ.`;

export interface PhraseFixItem {
  id: string;
  excerpt: string;
  reason: string;
  /** Абзац, в котором стоит фраза, — контекст для грамматики. */
  paragraph: string;
}

export interface PhraseFixInput {
  bookContext: string;
  pov: string;
  characterContext: string | null;
  items: PhraseFixItem[];
  config?: GenerationConfig;
}

const phraseFixOutputSchema = z.object({
  fixes: z.array(
    z.object({
      id: z.string().min(1),
      before: z.string().min(1),
      after: z.string(),
    }),
  ),
});
export type PhraseFix = z.infer<typeof phraseFixOutputSchema>["fixes"][number];

export function buildPhraseFixPrompt(input: PhraseFixInput): string {
  const parts: string[] = [`Книга/контекст:\n${input.bookContext}`, `POV: ${input.pov}`];
  if (input.characterContext) parts.push(input.characterContext);
  parts.push(
    `Отмеченные фразы:\n\n${input.items
      .map((i) => `id: ${i.id}\nФраза: «${i.excerpt}»\nПочему отмечена: ${i.reason}\nАбзац:\n${i.paragraph}`)
      .join("\n\n")}`,
    "Задача: исправь каждую фразу по правилам выше. Верни before и after для каждой.",
  );
  return parts.join("\n\n---\n\n");
}

const phraseFixContract: AgentStructuredContract<PhraseFixInput, z.infer<typeof phraseFixOutputSchema>> = {
  agentName: "editor_phrase",
  getOutputSchema: () => phraseFixOutputSchema,
  systemPrompt: PHRASE_FIX_SYSTEM,
  buildPrompt: buildPhraseFixPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_phrase_fixes",
    toolDescription:
      "Submit one fix per marked phrase: its id, the exact text replaced (before) and the replacement (after, empty to delete).",
    maxTurns: 5,
  },
};

export function registerPhraseFixContract(): void {
  registerAgentContract(phraseFixContract);
}

/** Не больше стольких фраз за вызов: ответ и внимание модели ограничены. */
const PHRASE_FIX_BATCH = 20;

export async function fixPhrases(
  input: PhraseFixInput,
): Promise<{ fixes: PhraseFix[]; usage: StructuredUsage[] }> {
  const batches: PhraseFixItem[][] = [];
  for (let i = 0; i < input.items.length; i += PHRASE_FIX_BATCH) {
    batches.push(input.items.slice(i, i + PHRASE_FIX_BATCH));
  }
  const results = await Promise.all(
    batches.map((items) =>
      dispatchStructured<PhraseFixInput, z.infer<typeof phraseFixOutputSchema>>({
        agentName: "editor_phrase",
        payload: { ...input, items },
        model: input.config?.model ?? "opus",
        ...(input.config?.temperature !== undefined ? { temperature: input.config.temperature } : {}),
        maxTokens: 8192,
        // Двадцать фраз с абзацами на opus — дольше общего предела в 120 с.
        timeoutMs: 300_000,
      }),
    ),
  );
  return {
    fixes: results.flatMap((r) => r.raw.fixes),
    usage: results.map((r) => r.diagnostics),
  };
}

// ─── Подстановка ───

/** Насколько кусок замены может быть длиннее самой фразы: одно соседнее
 *  предложение, не абзац. */
const MAX_EXTRA_CHARS = 300;

export type PhraseFixSkipReason =
  | "not_found"
  | "ambiguous"
  | "no_excerpt"
  | "too_long"
  | "protected"
  | "unknown_id"
  | "no_fix";

export interface PhraseFixOutcome {
  text: string;
  applied: PhraseFix[];
  skipped: { id: string; reason: PhraseFixSkipReason }[];
}

/** Абзац, в котором стоит фраза, если фраза встречается в тексте ровно раз,
 *  и сама фраза дословно из текста. Регистр не важен: фразу в начале
 *  предложения модель цитирует со строчной (замер на главе 3 658 слов —
 *  так терялась половина ненайденных цитат). Пересказ не угадываем. */
export function locatePhrase(
  text: string,
  excerpt: string,
): { paragraph: string; excerpt: string } | { reason: "not_found" | "ambiguous" } {
  if (excerpt.trim() === "") return { reason: "not_found" };
  // toLowerCase не меняет длину русских и латинских букв — индексы совпадают.
  const hay = text.toLowerCase();
  const needle = excerpt.toLowerCase();
  const at = hay.indexOf(needle);
  if (at < 0) return { reason: "not_found" };
  if (hay.indexOf(needle, at + 1) >= 0) return { reason: "ambiguous" };
  const start = text.lastIndexOf("\n", at) + 1;
  const endNl = text.indexOf("\n", at + excerpt.length);
  return {
    paragraph: text.slice(start, endNl < 0 ? text.length : endNl).trim(),
    excerpt: text.slice(at, at + excerpt.length),
  };
}

/** Чистит абзац вокруг места замены: двойные пробелы, пробел перед знаком,
 *  опустевший абзац. Остальной текст не трогает. */
function tidyAround(text: string, pos: number): string {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const endNl = text.indexOf("\n", pos);
  const end = endNl < 0 ? text.length : endNl;
  const para = text
    .slice(start, end)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?…])/g, "$1")
    .replace(/^[ \t]+/, "");
  if (para.trim() !== "") return text.slice(0, start) + para + text.slice(end);
  // Абзац удалён целиком — вместе с лишним переводом строки.
  const before = text.slice(0, start).replace(/\n+$/, "");
  const after = text.slice(end).replace(/^\n+/, "");
  if (before === "") return after;
  if (after === "") return before;
  return `${before}\n\n${after}`;
}

/** Подставляет замены кодом. Замена принимается, только если её кусок
 *  содержит отмеченную фразу, встречается в тексте ровно раз, не длиннее
 *  фразы с одним соседним предложением и не задевает защищённый фрагмент. */
export function applyPhraseFixes(
  text: string,
  items: PhraseFixItem[],
  fixes: PhraseFix[],
  protectedFragments: string[] = [],
): PhraseFixOutcome {
  const byId = new Map(items.map((i) => [i.id, i]));
  const done = new Set<string>();
  const applied: PhraseFix[] = [];
  const skipped: PhraseFixOutcome["skipped"] = [];
  let out = text;
  for (const f of fixes) {
    const item = byId.get(f.id);
    if (!item) {
      skipped.push({ id: f.id, reason: "unknown_id" });
      continue;
    }
    if (done.has(f.id)) continue;
    const skip = (reason: PhraseFixSkipReason) => {
      skipped.push({ id: f.id, reason });
      done.add(f.id);
    };
    if (!f.before.includes(item.excerpt)) { skip("no_excerpt"); continue; }
    if (f.before.length > item.excerpt.length + MAX_EXTRA_CHARS) { skip("too_long"); continue; }
    const at = out.indexOf(f.before);
    if (at < 0) { skip("not_found"); continue; }
    if (out.indexOf(f.before, at + 1) >= 0) { skip("ambiguous"); continue; }
    const end = at + f.before.length;
    const touchesProtected = protectedFragments.some((p) => {
      const pi = out.indexOf(p);
      return pi >= 0 && pi < end && pi + p.length > at;
    });
    if (touchesProtected) { skip("protected"); continue; }
    out = tidyAround(out.slice(0, at) + f.after + out.slice(end), at);
    applied.push(f);
    done.add(f.id);
  }
  for (const i of items) if (!done.has(i.id)) skipped.push({ id: i.id, reason: "no_fix" });
  return { text: out, applied, skipped };
}
