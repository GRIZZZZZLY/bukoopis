import { z } from "zod";
import type { CritiqueIssue } from "@book-forge/shared";
import { registerAgentContract, type AgentStructuredContract } from "@book-forge/llm";
import type { CriticInput } from "./base.js";

/**
 * Второй проход критика стиля — только отдельные формулировки. Замер
 * 2026-09-23 на размеченных автором фразах: правило внутри общего критика
 * находило 14 из 44 (он выдаёт 3–5 замечаний на сцену и останавливается),
 * отдельный проход с одной задачей — 25 из 44, не задев ни одной из 10
 * хороших. Проход не переписывает фразу: своя замена быстро становится для
 * модели доказательством, что оригинал плох.
 */
export const STYLE_PHRASE_SYSTEM = `Ты — редактор русской прозы. Проверяй отдельные формулировки на неестественность. Ищи придуманную необычность, несовместимые слова, метафоры без буквальной или смысловой логики, нарочито необычные глаголы, афористичность ради эффекта и фразы, которые естественнее сказать проще. Не отмечай просто красивую или характерную фразу, если образ логичен и что-то уточняет. Не оценивай композицию, темп, диалоги и сцену целиком.

Главный вопрос к каждой фразе: была ли у рассказчика причина сказать именно так, кроме желания автора написать необычно?

Как проверять:
- Перескажи фразу простыми словами. Можно ли сказать эту мысль обычными словами и почти ничего не потерять? Если да, а необычная версия существует ради остроумия или свежести — отметь.
- Проверяй необычные глаголы и сочетания существительных буквально. Если предмет физически не может делать то, что ему приписано, или выражение понятно только потому, что читатель восстанавливает обычную мысль за странной формулировкой, — отметь.
- Необычность должна давать дополнительную точность, а не заменять её.

Не отмечай:
- реплики персонажей в диалоге;
- обычные фразы, даже скучные;
- конкретные детали: предмет, привычку, число;
- рассуждение героя, если оно добавляет гипотезу, факт, мотив или риск;
- характерную гиперболу героя, если без неё мы узнаём меньше о нём или о его отношениях.

Если в контексте есть блок «Стиль» и он предписывает образность, образ сам по себе не дефект: отмечай только необычность без логики.

Отмечай каждую такую фразу отдельно, даже если она одна на страницу, и перечисли все, а не только самые заметные. Для каждой: excerpt — точная цитата одной фразы, не абзаца; reason — почему фраза неестественна, одним предложением; category — вид. Не переписывай фразу и не предлагай замену. Если таких фраз нет — так и скажи в overallNotes и верни пустой список.`;

const PHRASE_CATEGORIES = [
  "invented",
  "incompatible_words",
  "broken_image",
  "forced_verb",
  "aphorism",
  "plainer",
] as const;

const PHRASE_CATEGORY_LABELS: Record<(typeof PHRASE_CATEGORIES)[number], string> = {
  invented: "придуманная необычность",
  incompatible_words: "несовместимые слова",
  broken_image: "образ без логики",
  forced_verb: "нарочитый глагол",
  aphorism: "афоризм ради эффекта",
  plainer: "проще сказать обычными словами",
};

const phraseOutputSchema = z.object({
  overallNotes: z.string().min(1),
  issues: z.array(
    z.object({
      excerpt: z.string().min(1),
      reason: z.string().min(1),
      category: z.enum(PHRASE_CATEGORIES),
    }),
  ),
});
export type StylePhraseOutput = z.infer<typeof phraseOutputSchema>;

export function buildStylePhrasePrompt(input: CriticInput): string {
  const parts: string[] = [`Книга/контекст:\n${input.bookContext}`];
  if (input.characterContext) parts.push(input.characterContext);
  if (input.styleContext) parts.push(input.styleContext);
  parts.push(
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Текст главы:\n\n${input.chapterText}`,
    "\nЗадача:\nПроверь формулировки главы по одной. Выпиши каждую неестественную фразу: цитата, причина, вид.",
  );
  return parts.join("\n\n---\n\n");
}

const stylePhraseContract: AgentStructuredContract<CriticInput, StylePhraseOutput> = {
  agentName: "critic_style_phrase",
  getOutputSchema: () => phraseOutputSchema,
  systemPrompt: STYLE_PHRASE_SYSTEM,
  buildPrompt: buildStylePhrasePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_style_phrases",
    toolDescription:
      "Submit every unnatural phrase found in the chapter, each as a separate item with an exact quote, a one-sentence reason and a category. Do not rewrite phrases.",
    maxTurns: 5,
  },
};

export function registerStylePhraseContract(): void {
  registerAgentContract(stylePhraseContract);
}

/** Степень замечания о фразе. «Предложение», а не «мелочь»: правка по
 *  умолчанию берёт только blocking и suggestion, и «мелочи» не дошли бы до
 *  неё без ручного выбора автора. */
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
