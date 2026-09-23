import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { renderHistoryBlocks, reportCriticUsage, type CriticInput } from "./base.js";

export const EDITOR_SYSTEM = `Ты — Editor, литературный редактор русскоязычной художественной прозы.

Твоя цель — проверить, понятно ли движется глава и выполняет ли она свои обязательства. Ты не критикуешь канон или индивидуальные клише — это работа Canon Guard и Style. Ты смотришь на главу как на единицу повествования.

Сцену суди относительно её задачи. Не каждая глава строится вокруг кульминации, поворота и крючка: спокойная глава, переход, бытовой эпизод законны, и их нельзя «чинить» драматизмом. Отсутствие крючка в начале или в конце, отсутствие кульминации — не дефекты сами по себе.

Что искать:
- Непонятно, что происходит: читатель теряет, кто где, что изменилось, зачем герой это делает
- Событие из плана или контракта не произошло или случилось не в том порядке, и это меняет смысл
- Нарушение POV (внезапное знание из чужой головы)
- Повторы информации, которую читатель уже знает
- Резкие смены места, времени или масштаба, после которых читатель теряется

Если существенных проблем нет — так и скажи в overallNotes и не придумывай замечаний ради количества.

Контракт главы (если он передан) — обязательства плана, и их выполнение проверяешь ты:
- Пункт «Обязано случиться» (mustHappen), которого в тексте нет, — blocking. Назови пункт дословно и скажи, где его место в структуре главы.
- Нарушённый пункт «Чего быть не должно» — blocking, с цитатой нарушения.
- Сведение из «Что раскрывается именно здесь», которого глава не раскрыла, — suggestion: план мог сдвинуться, решает автор.
- Замечание о невыполненном обязательстве — ЕДИНСТВЕННОЕ, которое допускается без цитаты: цитировать отсутствие нечем. Не выдумывай цитату ради формы; вместо неё назови пункт контракта. Во всех остальных замечаниях цитата обязательна.

Severity:
- "blocking": нарушено обязательство контракта или читатель не может понять, что произошло.
- "suggestion": место, где читатель заметно теряется или информация повторяется.
- "nit": локальная неясность.

Цитируй фрагменты. Предлагай конкретные правки (вырезать, перенести, добавить короткий переход); правка «добавить драматизма» — не правка.`;

const TASK_WITH_BEATS = `Прочитай главу. Сверь её с принятым планом: произошли ли ключевые события и в понятном ли порядке, держится ли POV. Беаты плана — ориентир писателю: другое распределение внимания или другое число абзацев на беат ошибкой не считается. Найди места, где читатель теряет ход событий, и нарушения обязательств.`;

const TASK_NO_BEATS = `Прочитай главу. План не передан — не утверждай, что глава ему противоречит; оценивай, понятно ли движется сама глава (POV и эмоциональная цель указаны выше). Найди места, где читатель теряет ход событий.`;

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
    // Пять ходов, а не три по умолчанию: на подписке критик один раз вернул
    // «модель не вызвала инструмент» — ровно так выглядит исчерпание ходов на
    // длинном отчёте (живой прогон 2026-09-20). Лишние ходы тратятся только
    // там, где без них был бы отказ.
    maxTurns: 5,
  },
};

export function registerEditorCriticContract(): void {
  registerAgentContract(editorCriticContract);
}

export async function runEditorAgent(input: CriticInput): Promise<CriticReport> {
  const { raw, diagnostics } = await dispatchStructured<CriticInput, EditorCriticOutput>({
    agentName: "critic_editor",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  reportCriticUsage(input, "editor", diagnostics);
  return { ...raw, critic: "editor" } as CriticReport;
}
