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
import { type CriticInput } from "./base.js";

const SYSTEM = `Ты — Style критик художественной прозы на русском языке.

Твоя цель — найти AI-tells, fatigue-слова, однообразный ритм и LLM-структуры в тексте. Ты не проверяешь сюжет/канон — только текст как таковой.

Что искать (примеры, не исчерпывающий список):
- fatigue-слова: ${LLM_CLICHE_TOKENS_RU.join(", ")}
- LLM-структуры: ${LLM_CLICHE_PATTERNS_RU.join("; ")}
- Одинаковые длины предложений подряд (плоский ритм)
- Канцеляризмы: «осуществить», «производить», «являться», «составлять» в художественной прозе
- Оформление прямой речи не по-русски (кавычки вместо тире)

Если в контексте есть блок «Стиль» — это ЦЕЛЕВОЙ стиль книги, выбранный автором. Тогда:
- суди отклонение от него, а не от абстрактной «чистой прозы»;
- приёмы, которые целевой стиль предписывает (плотная метафорика, длинные периоды, обрывы), НЕ являются дефектом — не отмечай их;
- зато отмечай, где текст сорвался с целевого стиля: ритм и длины предложений разошлись с профилем, пропали сигнатурные приёмы, появились приёмы из списка «Чего у автора нет»;
- в overallNotes дай одну фразу о том, насколько глава попадает в целевой стиль.
Если блока «Стиль» нет — работай по общим правилам выше.

Severity:
- "blocking": текст звучит явно как ChatGPT-проза либо грубо расходится с целевым стилем.
- "suggestion": заметные клише или ритмическая монотонность в нескольких местах.
- "nit": единичный лексический промах.

Цитируй конкретные фразы. Предлагай замену.`;

const TASK = `Прочитай главу. Найди стилистические проблемы, AI-tells, ритмические дефекты, расхождения с целевым стилем (если он задан). Цитируй фразы и предлагай конкретные замены. Не пересказывай сюжет.`;

const styleOutputSchema = criticReportSchema.omit({ critic: true });
type StyleCriticOutput = z.infer<typeof styleOutputSchema>;

function buildStylePrompt(input: CriticInput): string {
  const stableParts: string[] = [`Книга/контекст:\n${input.bookContext}`];
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Предыдущие главы (краткое):\n${input.previousChaptersSummary}`,
    );
  }
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  if (input.styleContext) stableParts.push(input.styleContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${TASK}`,
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const styleCriticContract: AgentStructuredContract<CriticInput, StyleCriticOutput> = {
  agentName: "critic_style",
  getOutputSchema: () => styleOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildStylePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_style",
    toolDescription:
      "Submit a structured critique report from the style critic. Return all issues found with severity and concrete suggestions.",
  },
};

export function registerStyleCriticContract(): void {
  registerAgentContract(styleCriticContract);
}

export async function runStyleAgent(input: CriticInput): Promise<CriticReport> {
  const { raw } = await dispatchStructured<CriticInput, StyleCriticOutput>({
    agentName: "critic_style",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  return { ...raw, critic: "style" } as CriticReport;
}
