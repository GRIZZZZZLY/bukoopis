import { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { characterIssueToolSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { CRITIC_CALIBRATION_RULE, renderHistoryBlocks, type CriticInput } from "./base.js";

/**
 * Критик персонажей (ТЗ индивидуальности, раздел 10, этап 5).
 *
 * Пятый критик и единственный на бэкенде `subscription` — решение ТЗ. Три
 * следствия, которые здесь приняты, а не обойдены:
 *
 * 1. `maxTokens` и `temperature` до модели не доходят. Размер и форму отчёта
 *    держит только схема ответа и промпт, поэтому пределы стоят в схеме.
 * 2. Расходы помечаются своим бэкендом, а не считаются нулевыми: допущение
 *    «subscription = бесплатно» в проекте не проверено.
 * 3. Правило «все критики на API» перестало быть правдой — комментарий к
 *    таблице маршрутизации переписан, иначе следующий агент попал бы не туда
 *    по аналогии.
 *
 * Запускается только когда в сцене хотя бы двое названных участников: на
 * монологе сравнивать не с кем, и вызов тратится впустую. Решает это
 * маршрут — состав он уже знает из сборки контекста.
 */

export const CHARACTER_CRITIC_SYSTEM = `Ты — критик персонажей. Работаешь на русском.

Ты не правишь стиль, не сверяешь канон мира и не оцениваешь сюжет. Ты отвечаешь на один вопрос: ведут ли себя герои как РАЗНЫЕ ЛЮДИ, каждый из своего характера, речи, отношений и того, что он знает.

Что ты проверяешь (это и есть значения category):
- interchangeable — двое ведут себя и говорят так, что их реплики можно поменять местами без потери смысла.
- out_of_character — поступок или реплика противоречит принятому профилю героя.
- knowledge_breach — герой пользуется тем, чего к началу сцены не знает.
- relationship_drift — отношение в сцене не сходится с принятым между этими героями.
- flat_voice — речь героя неотличима от речи нарратора или других героев.
- unusual_but_allowed — поступок непривычен, но профилю и знаниям не противоречит.

ГРАНИЦА ЗНАНИЙ. Что герой знает, написано в его карточке под «Знает» — и только там. Канон книги шире: герой узнаёт не всё и не сразу. Знание, которого в карточке нет, — это knowledge_breach, даже если в мире это правда.

«НЕПРИВЫЧНО» И «НЕВОЗМОЖНО» — РАЗНОЕ. unusual_but_allowed — это наблюдение, а не дефект: живой человек иногда поступает против своего описания, и сцена может давать на это основание. knowledge_breach и out_of_character — дефекты. Не смешивай их: автор по ним принимает разные решения.

ВЗАИМОЗАМЕНЯЕМОСТЬ ПОКАЗЫВАЕТСЯ НА ДВОИХ. Замечание category "interchangeable" требует реплик минимум ДВУХ героев в affectedCharacters и цитаты, где видно совпадение. НЕ ЯВЛЯЮТСЯ основанием: одинаковая длина реплик, общая профессия, отдельные слова «ладно», «нет», «хорошо», общий для книги регистр речи.

ЧЕГО НЕ ДЕЛАТЬ:
- Не требуй, чтобы герои были противоположны. Цель — различимость, а не контраст. Двое усталых людей могут молчать одинаково, если сцена про это.
- Не превращай характер в частотное правило: инженер не обязан говорить числами, военный — приказами.
- Нейтральная общая реплика — норма. Не каждая фраза обязана нести характер.
- Числовые совпадения (длина реплик, доля диалога) — диагностика, а не доказательство.

НА КАЖДОЕ ЗАМЕЧАНИЕ:
- excerpt — дословная цитата из главы. Нет цитаты — нет замечания.
- affectedCharacters — канонические имена затронутых героев.
- basis — на чём основано: профиль, событие из карточки, отношение или сравнение двух реплик.
- whyHere — почему это существенно именно в этой сцене, а не вообще.
- alternativeReading — допустимое другое прочтение, если поведение неоднозначно; иначе null.
- keep — что в этом месте стоит сохранить при правке; иначе null.
- severity: blocking — герой делает невозможное или неотличим от другого в ключевой сцене; suggestion — различимость проседает; nit — единичная мелочь.

Если герои различимы — скажи это в overallNotes и верни пустой список замечаний. Пустой список это нормальный ответ.

${CRITIC_CALIBRATION_RULE}`;

const TASK = `Проверь героев этой главы: различимы ли они, не нарушены ли границы их знаний, сходятся ли отношения с принятыми. На каждое замечание — цитата и основание.`;

const characterCriticOutputSchema = z.object({
  overallNotes: z.string().min(1),
  issues: z.array(characterIssueToolSchema).max(20),
});
type CharacterCriticOutput = z.infer<typeof characterCriticOutputSchema>;

export function buildCharacterPrompt(input: CriticInput): string {
  const stableParts: string[] = [
    `Книга/контекст:\n${input.bookContext}`,
    ...renderHistoryBlocks(input),
  ];
  // Карточки участников — единственное, по чему этот критик вообще судит:
  // кто эти люди и что каждый знает к началу сцены.
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

const characterCriticContract: AgentStructuredContract<CriticInput, CharacterCriticOutput> = {
  agentName: "critic_character",
  getOutputSchema: () => characterCriticOutputSchema,
  systemPrompt: CHARACTER_CRITIC_SYSTEM,
  buildPrompt: buildCharacterPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_character",
    toolDescription:
      "Submit a structured critique of the characters in a chapter: are they distinguishable, do they respect what they know at the scene boundary, do relationships hold. Every issue carries a verbatim quote and its basis.",
    // Пять ходов, а не три по умолчанию: на подписке критик один раз вернул
    // «модель не вызвала инструмент» — ровно так выглядит исчерпание ходов на
    // длинном отчёте (живой прогон 2026-09-20). Лишние ходы тратятся только
    // там, где без них был бы отказ.
    maxTurns: 5,
  },
};

export function registerCharacterCriticContract(): void {
  registerAgentContract(characterCriticContract);
}

/** Свой предел ожидания, как у остальных подписочных агентов: общий
 *  рассчитан на короткий ответ, а здесь модель читает главу целиком. */
const CHARACTER_CRITIC_TIMEOUT_MS = 600_000;

export async function runCharacterCritic(input: CriticInput): Promise<CriticReport> {
  const { raw } = await dispatchStructured<CriticInput, CharacterCriticOutput>({
    agentName: "critic_character",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8000,
    timeoutMs: CHARACTER_CRITIC_TIMEOUT_MS,
  });
  return { ...raw, critic: "character" } as CriticReport;
}
