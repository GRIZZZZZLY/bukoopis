import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { type CriticInput } from "./base.js";

const SYSTEM = `Ты — Editor, литературный редактор русскоязычной художественной прозы.

Твоя цель — оценить структуру и пейсинг главы. Ты не критикуешь канон или индивидуальные клише — это работа Canon Guard и Style. Ты смотришь на главу как на единицу повествования.

Что искать:
- Слабый/смазанный hook (первый абзац)
- Провисание середины: непонятно зачем сцена существует
- Кульминация смазана или недостаточно подготовлена
- Конец главы не толкает читателя дальше (нет "крючка вперёд")
- Длинные описания без действия/диалога; или наоборот — диалог без интерьера
- Нарушение POV (внезапное знание из чужой головы)
- Повторы информации, которую читатель уже знает
- Резкие смены масштаба/темпа без перехода

Severity:
- "blocking": глава не достигает заявленной emotional goal или beat-sheet.
- "suggestion": сильно улучшаемая структура (несколько перетасовок, сжатий).
- "nit": локальная ошибка пейсинга.

Цитируй фрагменты. Предлагай конкретные правки структуры (вырезать, перенести, добавить переход).`;

const TASK = `Прочитай главу. Оцени hook → setup → rising → climax → resolution / transition. Сверь с beat-sheet'ом (POV + emotional goal). Найди структурные провалы и предложи правки.`;

const editorOutputSchema = criticReportSchema.omit({ critic: true });
type EditorCriticOutput = z.infer<typeof editorOutputSchema>;

function buildEditorPrompt(input: CriticInput): string {
  const stableParts: string[] = [`Книга/контекст:\n${input.bookContext}`];
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Предыдущие главы (краткое):\n${input.previousChaptersSummary}`,
    );
  }
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${TASK}`,
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const editorCriticContract: AgentStructuredContract<CriticInput, EditorCriticOutput> = {
  agentName: "critic_editor",
  getOutputSchema: () => editorOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildEditorPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_editor",
    toolDescription:
      "Submit a structured critique report from the editor critic. Return all issues found with severity and concrete suggestions.",
  },
};

export function registerEditorCriticContract(): void {
  registerAgentContract(editorCriticContract);
}

export async function runEditorAgent(input: CriticInput): Promise<CriticReport> {
  const { raw } = await dispatchStructured<CriticInput, EditorCriticOutput>({
    agentName: "critic_editor",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  return { ...raw, critic: "editor" } as CriticReport;
}
