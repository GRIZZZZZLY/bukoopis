import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { renderHistoryBlocks, type CriticInput } from "./base.js";

export const EDITOR_SYSTEM = `Ты — Editor, литературный редактор русскоязычной художественной прозы.

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

Контракт главы (если он передан) — обязательства плана, и их выполнение проверяешь ты:
- Пункт «Обязано случиться» (mustHappen), которого в тексте нет, — blocking. Назови пункт дословно и скажи, где его место в структуре главы.
- Нарушённый пункт «Чего быть не должно» — blocking, с цитатой нарушения.
- Сведение из «Что раскрывается именно здесь», которого глава не раскрыла, — suggestion: план мог сдвинуться, решает автор.
- Замечание о невыполненном обязательстве — ЕДИНСТВЕННОЕ, которое допускается без цитаты: цитировать отсутствие нечем. Не выдумывай цитату ради формы; вместо неё назови пункт контракта. Во всех остальных замечаниях цитата обязательна.

Severity:
- "blocking": глава не достигает заявленной emotional goal или beat-sheet.
- "suggestion": сильно улучшаемая структура (несколько перетасовок, сжатий).
- "nit": локальная ошибка пейсинга.

Цитируй фрагменты. Предлагай конкретные правки структуры (вырезать, перенести, добавить переход).`;

const TASK_WITH_BEATS = `Прочитай главу. Оцени hook → setup → rising → climax → resolution / transition. Сверь главу с принятым beat-sheet: ключевые события и их порядок, POV, эмоциональная цель. Найди структурные провалы и предложи правки.`;

const TASK_NO_BEATS = `Прочитай главу. Оцени hook → setup → rising → climax → resolution / transition. Beat-sheet не передан — не утверждай, что глава ему противоречит; оценивай структуру самой главы (POV и эмоциональная цель указаны выше). Найди структурные провалы и предложи правки.`;

const editorOutputSchema = criticReportSchema.omit({ critic: true });
type EditorCriticOutput = z.infer<typeof editorOutputSchema>;

export function buildEditorPrompt(input: CriticInput): string {
  const stableParts: string[] = [
    `Книга/контекст:\n${input.bookContext}`,
    ...renderHistoryBlocks(input),
  ];
  if (input.chapterContract) stableParts.push(input.chapterContract);
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    ...(input.beatSheet
      ? [`Принятый beat-sheet:\n${input.beatSheet}`]
      : []),
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${input.beatSheet ? TASK_WITH_BEATS : TASK_NO_BEATS}`,
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const editorCriticContract: AgentStructuredContract<CriticInput, EditorCriticOutput> = {
  agentName: "critic_editor",
  getOutputSchema: () => editorOutputSchema,
  systemPrompt: EDITOR_SYSTEM,
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
