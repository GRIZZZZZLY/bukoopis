import { z } from "zod";
import {
  pitchSchema,
  AUDIENCE_LABELS,
  type ModelChoice,
  type Pitch,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

export interface PitchGeneratorInput {
  /** Задумка автора как есть: фраза, абзац, поток мыслей. */
  idea: string;
  /** Пожелание к новой партии: «мрачнее», «камернее», «ближе к первой». */
  direction?: string;
  /** Уже показанные питчи: новые не должны их повторять. */
  avoid?: Array<{ workingTitle: string; logline: string }>;
  /** Сколько питчей просить, 3–5. По умолчанию 4. */
  count?: number;
}

export const pitchDraftSchema = pitchSchema.omit({ id: true });
export type PitchDraft = z.infer<typeof pitchDraftSchema>;

const pitchGeneratorOutputSchema = z.object({
  pitches: z.array(pitchDraftSchema).min(3).max(5),
  /** До трёх вопросов автору, если задумка слишком тонкая. Пусто — вопросов нет. */
  questions: z.array(z.string().min(1).max(300)).max(3),
});
export type PitchGeneratorOutput = z.infer<typeof pitchGeneratorOutputSchema>;

const DEFAULT_COUNT = 4;

const SYSTEM = `Ты — редактор-разработчик замыслов. Автор приносит задумку книги, ты возвращаешь несколько разных питчей, из которых он выберет один. Работаешь на русском.

Правила:
- Всё, что автор сказал явно, сохраняй по смыслу в каждом питче. Питчи различаются углом, героем, конфликтом или масштабом, но не подменяют его идею на «более правильную».
- Питчи должны быть по-настоящему разными: разные протагонисты, разные конфликты или разный масштаб истории. Два питча с одним героем и одним конфликтом — брак.
- Все поля заполнены. Автор не должен ничего дописывать руками.
- workingTitle: 1–5 слов, без кавычек.
- logline: одно-два предложения, не длиннее 280 символов. Схема: «Когда [событие], [герой с особенностью] должен [действие], иначе [цена]».
- protagonist: кто главный и чего хочет, 30–80 слов, конкретно.
- conflict: что ему мешает и почему столкновение неизбежно, 30–80 слов.
- stakes: что он потеряет, если не справится, 20–60 слов, ощутимо, без «судьбы мира».
- hook: одна деталь или вопрос, из-за которого читатель откроет вторую главу.
- genre и tone: свободный текст на русском, 1–4 слова каждое. Не список, не словарь.
- audience: одно из ya, adult, all_ages, mg. По умолчанию adult.
- strength: чем этот питч сильнее остальных, одно предложение. risk: где он может провалиться, одно предложение. Честно.
- questions: только если задумка действительно тонкая (нет ни героя, ни конфликта, меньше ~40 слов). Не больше трёх, каждый отвечается одной фразой. Если задумки достаточно — пустой массив.
- Без штампов: «избранный», «древнее зло», «тайные силы», «судьба мира», если их нет у автора.`;

export function buildPitchGeneratorPrompt(input: PitchGeneratorInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  const parts: string[] = ["ЗАДУМКА АВТОРА:", input.idea.trim(), ""];
  if (input.direction && input.direction.trim().length > 0) {
    parts.push("ПОЖЕЛАНИЕ К ЭТОЙ ПАРТИИ:", input.direction.trim(), "");
  }
  if (input.avoid && input.avoid.length > 0) {
    parts.push("УЖЕ ПОКАЗАННЫЕ ПИТЧИ (не повторять ни героя, ни конфликт):");
    for (const a of input.avoid) {
      parts.push(`- «${a.workingTitle}»: ${a.logline}`);
    }
    parts.push("");
  }
  parts.push(
    "ИНСТРУКЦИЯ:",
    `Верни ровно ${count} питча(ей), заметно разных между собой, и список уточняющих вопросов (пустой, если задумки достаточно).`,
    `Аудитории: ${Object.entries(AUDIENCE_LABELS)
      .map(([id, label]) => `${id} — ${label}`)
      .join("; ")}.`,
  );
  return parts.join("\n");
}

const pitchGeneratorContract: AgentStructuredContract<
  PitchGeneratorInput,
  PitchGeneratorOutput
> = {
  agentName: "pitch_generator",
  getOutputSchema: () => pitchGeneratorOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildPitchGeneratorPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_pitches",
    toolDescription:
      "Submit 3–5 materially different book pitches derived from the author's idea, plus up to three clarifying questions if the idea is too thin.",
  },
};

export function registerPitchGeneratorContract(): void {
  registerAgentContract(pitchGeneratorContract);
}

function trimDraft(d: PitchDraft): PitchDraft {
  return {
    workingTitle: d.workingTitle.trim(),
    logline: d.logline.trim(),
    protagonist: d.protagonist.trim(),
    conflict: d.conflict.trim(),
    stakes: d.stakes.trim(),
    hook: d.hook.trim(),
    genre: d.genre.trim(),
    tone: d.tone.trim(),
    audience: d.audience,
    strength: d.strength.trim(),
    risk: d.risk.trim(),
  };
}

/** Присваивает id и чистит пробелы. Id выдаёт вызывающая сторона — сервер
 *  использует randomUUID, тесты — счётчик. */
export function toPitches(drafts: PitchDraft[], makeId: () => string): Pitch[] {
  return drafts.map((d) => ({ id: makeId(), ...trimDraft(d) }));
}

export interface RunPitchGeneratorOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runPitchGenerator(
  input: PitchGeneratorInput,
  options: RunPitchGeneratorOptions = {},
): Promise<PitchGeneratorOutput> {
  const { raw } = await dispatchStructured<PitchGeneratorInput, PitchGeneratorOutput>({
    agentName: "pitch_generator",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 6000,
  });
  return raw;
}
