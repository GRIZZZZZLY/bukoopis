import { z } from "zod";
import type { CritiqueIssue } from "@book-forge/shared";
import {
  dispatchStructured,
  registerAgentContract,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import type { CriticInput } from "./base.js";

/**
 * Второй проход критика стиля — только отдельные формулировки. Замер
 * 2026-09-23 на размеченных автором фразах: правило внутри общего критика
 * находило 14 из 44 (он выдаёт 3–5 замечаний на сцену и останавливается),
 * отдельный проход с одной задачей — 21–25 из 44; на четырёх новых сценах
 * автор исправил бы все 18 его отметок. Проход не переписывает фразу: своя
 * замена быстро становится для модели доказательством, что оригинал плох.
 * Глава идёт кусками по абзацам: на целой главе внимание размазывается, а
 * ответ упирается в лимит.
 */
export const STYLE_PHRASE_SYSTEM = `Ты — редактор русской прозы. Проверяй отдельные формулировки на неестественность. Ищи придуманную необычность, несовместимые слова, натянутые образы, нарочито необычные глаголы, готовые формулы и афористичность ради эффекта, сконструированные антитезы и фразы, которые естественнее сказать проще. Не оценивай композицию, темп, диалоги и сцену целиком.

Главный вопрос к каждой фразе: была ли у рассказчика причина сказать именно так, кроме желания автора написать необычно? Перескажи фразу простыми словами: если мысль почти ничего не теряет, а необычная версия существует ради остроумия или свежести — отметь.

Не требуй буквальной логичности от метафоры: хорошая метафора тоже буквально невозможна, и это не довод против неё. Критерий один — добавляет ли необычная формулировка точность или характер, или существует главным образом ради эффекта. Не отмечай красивую или характерную фразу, если образ что-то уточняет.

Не отмечай:
- реплики персонажей в диалоге;
- обычные фразы, даже скучные;
- конкретные детали: предмет, привычку, число;
- рассуждение героя, если оно добавляет гипотезу, факт, мотив или риск;
- характерную гиперболу героя, если без неё мы узнаём меньше о нём или о его отношениях.

Если в контексте есть блок «Стиль» и он предписывает образность, образ сам по себе не дефект: отмечай только необычность ради эффекта.

Тебе дают кусок главы и соседние абзацы для связности. Проверяй только кусок. Отмечай каждую такую фразу отдельно, даже если она одна на страницу, и перечисли все, а не только самые заметные. Для каждой: excerpt — точная цитата одной фразы из куска, символ в символ; category — вид; reason — одна короткая фраза, до двенадцати слов, по существу: что делает фразу сконструированной (слишком законченная формула для простой мысли, симметрия ради эффекта, сравнение без нужды, так не говорят), а не буквальная невозможность образа. Не переписывай фразу и не предлагай замену. Если таких фраз нет — верни пустой список.`;

const PHRASE_CATEGORIES = [
  "invented",
  "incompatible_words",
  "forced_image",
  "forced_verb",
  "formula",
  "antithesis",
  "plainer",
] as const;

const PHRASE_CATEGORY_LABELS: Record<(typeof PHRASE_CATEGORIES)[number], string> = {
  invented: "придуманная необычность",
  incompatible_words: "несовместимые слова",
  forced_image: "натянутый образ",
  forced_verb: "нарочитый глагол",
  formula: "готовая формула",
  antithesis: "сконструированная антитеза",
  plainer: "проще сказать обычными словами",
};

const phraseOutputSchema = z.object({
  overallNotes: z.string().optional(),
  issues: z.array(
    z.object({
      excerpt: z.string().min(1),
      category: z.enum(PHRASE_CATEGORIES),
      reason: z.string().min(1),
    }),
  ),
});
export type StylePhraseOutput = z.infer<typeof phraseOutputSchema>;

export interface PhraseChunk {
  text: string;
  /** Абзац до куска и после — для связности, не для проверки. */
  before: string | null;
  after: string | null;
  index: number;
  total: number;
}
export type StylePhraseInput = CriticInput & { chunk: PhraseChunk };

/** Размер куска в знаках: около тысячи слов русского текста. */
export const PHRASE_CHUNK_CHARS = 6000;

/** Режет главу на куски по целым абзацам, не длиннее `max` (абзац длиннее
 *  остаётся целым), и прикладывает к каждому соседние абзацы. */
export function phraseChunks(text: string, max = PHRASE_CHUNK_CHARS): PhraseChunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const groups: { from: number; to: number }[] = [];
  let from = 0;
  let size = 0;
  paragraphs.forEach((p, i) => {
    if (size > 0 && size + p.length > max) {
      groups.push({ from, to: i });
      from = i;
      size = 0;
    }
    size += p.length + 2;
  });
  if (paragraphs.length > 0) groups.push({ from, to: paragraphs.length });
  return groups.map((g, index) => ({
    text: paragraphs.slice(g.from, g.to).join("\n\n"),
    before: g.from > 0 ? paragraphs[g.from - 1]! : null,
    after: g.to < paragraphs.length ? paragraphs[g.to]! : null,
    index,
    total: groups.length,
  }));
}

export function buildStylePhrasePrompt(input: StylePhraseInput): string {
  const { chunk } = input;
  const parts: string[] = [`Книга/контекст:\n${input.bookContext}`];
  if (input.characterContext) parts.push(input.characterContext);
  if (input.styleContext) parts.push(input.styleContext);
  parts.push(`Глава: "${input.chapterTitle}"`, `POV: ${input.pov}`);
  if (chunk.before) parts.push(`Абзац перед куском (не проверяй):\n\n${chunk.before}`);
  parts.push(`Кусок ${chunk.index + 1} из ${chunk.total} — проверяй только его:\n\n${chunk.text}`);
  if (chunk.after) parts.push(`Абзац после куска (не проверяй):\n\n${chunk.after}`);
  parts.push("Задача:\nПроверь формулировки куска по одной. Выпиши каждую неестественную фразу: цитата, вид, причина.");
  return parts.join("\n\n---\n\n");
}

const stylePhraseContract: AgentStructuredContract<StylePhraseInput, StylePhraseOutput> = {
  agentName: "critic_style_phrase",
  getOutputSchema: () => phraseOutputSchema,
  systemPrompt: STYLE_PHRASE_SYSTEM,
  buildPrompt: buildStylePhrasePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_style_phrases",
    toolDescription:
      "Submit every unnatural phrase found in the chunk, each as a separate item: exact quote, category, a short reason. Do not rewrite phrases.",
    maxTurns: 5,
  },
};

export function registerStylePhraseContract(): void {
  registerAgentContract(stylePhraseContract);
}

/** Степень замечания о фразе. «Предложение», а не «мелочь»: правка по
 *  умолчанию берёт только blocking и suggestion. Такие замечания правит не
 *  общая правка, а хирургическая (phrase-fix): только отмеченное место. */
const PHRASE_SEVERITY = "suggestion" as const;

export function phraseIssues(out: StylePhraseOutput): CritiqueIssue[] {
  return out.issues.map((i) => ({
    severity: PHRASE_SEVERITY,
    summary: `${PHRASE_CATEGORY_LABELS[i.category]}: ${i.reason}`,
    excerpt: i.excerpt,
    suggestion: null,
    origin: "style_phrase",
  }));
}

export interface StylePhrasePassResult {
  issues: CritiqueIssue[];
  totalChunks: number;
  /** Куски, которые не удалось проверить и со второй попытки. */
  failedChunks: number;
  usage: StructuredUsage[];
}

/** Проход по кускам параллельно; упавший кусок повторяется один раз. */
export async function runStylePhrasePass(
  input: CriticInput,
  opts: { model: "sonnet" | "opus"; temperature?: number },
): Promise<StylePhrasePassResult> {
  const chunks = phraseChunks(input.chapterText);
  const usage: StructuredUsage[] = [];
  const call = (chunk: PhraseChunk) =>
    dispatchStructured<StylePhraseInput, StylePhraseOutput>({
      agentName: "critic_style_phrase",
      payload: { ...input, chunk },
      model: opts.model,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      maxTokens: 4096,
    });
  const issues: CritiqueIssue[] = [];
  let failedChunks = 0;
  const first = await Promise.allSettled(chunks.map(call));
  const retried = await Promise.allSettled(
    first.map((r, i) => (r.status === "fulfilled" ? Promise.resolve(r.value) : call(chunks[i]!))),
  );
  retried.forEach((r, i) => {
    if (r.status === "rejected") {
      failedChunks++;
      console.warn(`[critic_style] проход по фразам: кусок ${i + 1} из ${chunks.length} не удался:`, r.reason);
      return;
    }
    usage.push(r.value.diagnostics);
    issues.push(...phraseIssues(r.value.raw));
  });
  return { issues, totalChunks: chunks.length, failedChunks, usage };
}

/** Строка для overallNotes, когда часть главы осталась непроверенной: автор
 *  должен отличать «проход ничего не нашёл» от «проход не отработал». */
export function phraseFailureNote(r: Pick<StylePhrasePassResult, "failedChunks" | "totalChunks">): string | null {
  if (r.failedChunks === 0) return null;
  return r.failedChunks === r.totalChunks
    ? "Проверка отдельных фраз не выполнилась — формулировки главы не проверены."
    : `Проверка отдельных фраз: ${r.failedChunks} из ${r.totalChunks} кусков главы не проверены.`;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[«»"“”„.,:;!?…()—–-]/g, " ").replace(/\s+/g, " ").trim();

/** Слияние двух проходов: замечание о фразе, чья цитата совпадает с цитатой
 *  общего разбора или входит в неё (или наоборот), автору не показываем —
 *  у общего замечания обычно есть предложенная правка. Повторы внутри
 *  прохода по фразам тоже убираются. */
export function mergeStyleIssues(general: CritiqueIssue[], phrase: CritiqueIssue[]): CritiqueIssue[] {
  const seen = general.map((i) => norm(i.excerpt ?? "")).filter((e) => e.length > 0);
  const kept: CritiqueIssue[] = [];
  for (const issue of phrase) {
    const e = norm(issue.excerpt ?? "");
    if (e.length === 0) continue;
    if (seen.some((s) => s.includes(e) || e.includes(s))) continue;
    seen.push(e);
    kept.push(issue);
  }
  return [...general.map((i) => ({ ...i, origin: "style_general" as const })), ...kept];
}
