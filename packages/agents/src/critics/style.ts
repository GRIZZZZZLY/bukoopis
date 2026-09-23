import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import {
  criticReportSchema,
  LLM_CLICHE_PATTERNS_RU,
  LLM_CLICHE_TOKENS_RU,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { CRITIC_CALIBRATION_RULE, renderHistoryBlocks, reportCriticUsage, type CriticInput } from "./base.js";

export const STYLE_CRITIC_SYSTEM = `Ты — Style критик художественной прозы на русском языке.

Твоя цель — найти навязчиво повторяющиеся приёмы и места, где текст расходится с выбранным голосом книги. Ты не проверяешь сюжет/канон — только текст как таковой.

Что искать (примеры, не исчерпывающий список):
- Навязчивый повтор одного приёма: одно и то же уподобление в вариациях, телесная реакция «раньше сознания» раз за разом, короткая ударная фраза после каждого описания, каждая сцена кончается эффектной нотой, каждая реплика звучит как цитата. Отмечай повтор, а не единичное появление приёма.
- Украшение ради украшения: образ, который ничего не добавляет к пониманию, рядом с другим таким же
- fatigue-слова, когда они повторяются: ${LLM_CLICHE_TOKENS_RU.join(", ")}
- Конструкции-штампы: ${LLM_CLICHE_PATTERNS_RU.join("; ")}
- Канцеляризмы: «осуществить», «производить», «являться», «составлять» в художественной прозе
- Оформление прямой речи не по-русски (кавычки вместо тире)

Ни союз «словно», ни одно слово из списка, ни сравнение, ни короткий абзац сами по себе текст искусственным не делают. Простое слово и обычная фраза — не дефект.

Если перед текстом есть блок «Структурные маркеры ИИ-прозы (измерено)» — это подсчёт конструкций по тексту главы, с цитатами. Бери цитаты оттуда, когда говоришь о повторе приёма, не пересчитывай сам. Чисел нормы у этих маркеров нет: они показывают, что повторяется, а решаешь ты — по тому, режет ли повтор чтение.

${CRITIC_CALIBRATION_RULE}

Если в контексте есть блок «Стиль» — это ЦЕЛЕВОЙ стиль книги, выбранный автором. Тогда:
- суди отклонение от него, а не от абстрактной «чистой прозы»;
- приёмы, которые целевой стиль предписывает (плотная метафорика, длинные периоды, обрывы), НЕ являются дефектом — не отмечай их;
- зато отмечай, где текст сорвался с целевого стиля: ритм и длины предложений разошлись с профилем, пропали сигнатурные приёмы, появились приёмы из списка «Чего у автора нет»;
- в overallNotes дай одну фразу о том, насколько глава попадает в целевой стиль.
Если блока «Стиль» нет — работай по общим правилам выше.

Severity:
- "blocking": приём повторяется так часто, что чтение спотыкается на нём по всей главе, либо текст грубо расходится с целевым стилем. Впечатление «звучит как ChatGPT» без названного приёма и цитат — не основание.
- "suggestion": заметный повтор приёма или клише в нескольких местах.
- "nit": единичный лексический промах.

Цитируй конкретные фразы. Предпочитай правку «убрать»: лишний образ, пояснение или повтор чаще всего надо просто вычеркнуть. Если предлагаешь замену — проще оригинала, а не образнее. Если существенных проблем нет — так и скажи в overallNotes и не придумывай замечаний ради количества.`;

const TASK = `Прочитай главу. Найди навязчиво повторяющиеся приёмы, клише и расхождения с целевым стилем (если он задан). Цитируй фразы; предлагай убрать или упростить. Не пересказывай сюжет.`;

const styleOutputSchema = criticReportSchema.omit({ critic: true });
type StyleCriticOutput = z.infer<typeof styleOutputSchema>;

export function buildStylePrompt(input: CriticInput): string {
  const stableParts: string[] = [
    `Книга/контекст:\n${input.bookContext}`,
    ...renderHistoryBlocks(input),
  ];
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  if (input.styleContext) stableParts.push(input.styleContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
  ];
  if (input.structuralTellsContext) {
    volatileParts.push(input.structuralTellsContext);
  }
  volatileParts.push(`Текст главы:\n\n${input.chapterText}`, `\nЗадача:\n${TASK}`);

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const styleCriticContract: AgentStructuredContract<CriticInput, StyleCriticOutput> = {
  agentName: "critic_style",
  getOutputSchema: () => styleOutputSchema,
  systemPrompt: STYLE_CRITIC_SYSTEM,
  buildPrompt: buildStylePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_style",
    toolDescription:
      "Submit a structured critique report from the style critic. Return all issues found with severity and concrete suggestions.",
    // Пять ходов, а не три по умолчанию: на подписке критик один раз вернул
    // «модель не вызвала инструмент» — ровно так выглядит исчерпание ходов на
    // длинном отчёте (живой прогон 2026-09-20). Лишние ходы тратятся только
    // там, где без них был бы отказ.
    maxTurns: 5,
  },
};

export function registerStyleCriticContract(): void {
  registerAgentContract(styleCriticContract);
}

export async function runStyleAgent(input: CriticInput): Promise<CriticReport> {
  const { raw, diagnostics } = await dispatchStructured<CriticInput, StyleCriticOutput>({
    agentName: "critic_style",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  reportCriticUsage(input, "style", diagnostics);
  return { ...raw, critic: "style" } as CriticReport;
}
