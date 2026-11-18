import { z } from "zod";
import {
  pitchSchema,
  AUDIENCE_LABELS,
  type ModelChoice,
  type Pitch,
} from "@book-forge/shared";
import { CONCEPT_LANGUAGE_RULES } from "../language-rules.js";
import { findContrastClichés } from "./contrast-cliches.js";
import {
  registerAgentContract,
  dispatchStructured,
  type LocalModelRef,
  type AgentStructuredContract,
  type StructuredUsage,
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

export const PITCH_GENERATOR_SYSTEM = `Ты — редактор-разработчик замыслов. Автор приносит задумку книги, ты возвращаешь несколько разных питчей, из которых он выберет один. Работаешь на русском.

Правила:
- Всё, что автор сказал явно, сохраняй по смыслу в каждом питче. Его идею на «более правильную» не подменяй.
- Если автор задал героя или этап его пути (например, становление, первая книга цикла), каждый питч сохраняет этого героя и этот этап. Питчи тогда различаются конфликтом, противником, местом действия или масштабом. Если героя автор не задал, питчи различаются и героями.
- Два питча с одним конфликтом — брак.
- Все поля заполнены. Автор не должен ничего дописывать руками.
- workingTitle: 1–5 слов, без кавычек.
- logline: одно-два предложения, не длиннее 280 символов: кто чего хочет и что стоит на пути. Начало свободное, «Когда…» допустимо, но не обязательно. Логлайны одной партии должны начинаться по-разному.
- protagonist: кто главный и чего хочет, 30–80 слов, конкретно.
- conflict: что ему мешает и почему столкновение неизбежно, 30–80 слов.
- stakes: что он потеряет, если не справится, 20–60 слов, ощутимо, без «судьбы мира».
- hook: одна деталь или вопрос, из-за которого читатель откроет вторую главу.
- genre и tone: свободный текст на русском, 1–4 слова каждое. Не список, не словарь.
- audience: одно из ya, adult, all_ages, mg. По умолчанию adult. ya — только если автор в задумке назвал более юного читателя. Юный герой сам по себе не повод для ya.
- strength: одно простое предложение о самом сюжете: что в истории работает. risk: одно простое предложение о сюжете: что в ней может не сработать. Без оценочных прилагательных о книге.
- Факты: не добавляй биографических фактов, дат и чисел, которых автор не называл. Если питчу нужен такой факт, сформулируй его вопросом в hook или опусти.
- Если автор назвал жанр или тон прямо, сохрани их. Служебные и черновые слова из заметок («как у…», «надо», «потом») в tone и genre не переноси.
- questions: только если задумка действительно тонкая. Есть герой И конфликт — вопросов не задавай вовсе, пустой массив. Нет ни того, ни другого и меньше ~40 слов — можно до трёх, каждый отвечается одной фразой.
- Без штампов: «избранный», «древнее зло», «тайные силы», «судьба мира», если их нет у автора.
${CONCEPT_LANGUAGE_RULES}`;

export function buildPitchGeneratorPrompt(input: PitchGeneratorInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  const parts: string[] = ["ЗАДУМКА АВТОРА:", input.idea.trim(), ""];
  if (input.direction && input.direction.trim().length > 0) {
    parts.push("ПОЖЕЛАНИЕ К ЭТОЙ ПАРТИИ:", input.direction.trim(), "");
  }
  if (input.avoid && input.avoid.length > 0) {
    parts.push("УЖЕ ПОКАЗАННЫЕ ПИТЧИ (их конфликты не повторять; заданного автором героя сохранять):");
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
  systemPrompt: PITCH_GENERATOR_SYSTEM,
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
  /** Локальная модель мастерской (настройка книги); без неё — Claude. */
  local?: LocalModelRef;
  temperature?: number;
  /** Расход каждого вызова, включая повтор. */
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

function pitchContrasts(out: PitchGeneratorOutput): string[] {
  return out.pitches.flatMap((p) =>
    Object.values(p).flatMap((v) => (typeof v === "string" ? findContrastClichés(v) : [])),
  );
}

function contrastRetryDirection(direction: string | undefined, fragments: string[]): string {
  const line =
    "Пиши питчи без противопоставлений вида «не X, а Y» и «X, а не Y». " +
    `В прошлой партии они были: ${fragments.map((f) => `«${f}»`).join("; ")}. ` +
    "Каждую такую мысль скажи прямо, одним утверждением.";
  return direction?.trim() ? `${direction.trim()}\n${line}` : line;
}

/** Правило в промпте противопоставления не убрало: найденные в ответе
 *  отправляем на один повтор и берём партию, где их меньше. */
export async function runPitchGenerator(
  input: PitchGeneratorInput,
  options: RunPitchGeneratorOptions = {},
): Promise<PitchGeneratorOutput> {
  const call = async (payload: PitchGeneratorInput): Promise<PitchGeneratorOutput> => {
    const { raw, diagnostics } = await dispatchStructured<PitchGeneratorInput, PitchGeneratorOutput>({
      agentName: "pitch_generator",
      payload,
      model: options.model ?? "sonnet",
      ...(options.local ? { local: options.local } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      maxTokens: 6000,
    });
    options.onUsage?.({
      modelId: diagnostics.modelId,
      inputTokens: diagnostics.inputTokens,
      outputTokens: diagnostics.outputTokens,
      cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
      cacheReadInputTokens: diagnostics.cacheReadInputTokens,
    });
    return raw;
  };

  const first = await call(input);
  const firstHits = pitchContrasts(first);
  if (firstHits.length === 0) return first;
  let second: PitchGeneratorOutput;
  try {
    second = await call({ ...input, direction: contrastRetryDirection(input.direction, firstHits) });
  } catch {
    return first;
  }
  return pitchContrasts(second).length < firstHits.length ? second : first;
}
