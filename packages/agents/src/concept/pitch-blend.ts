import {
  PITCH_MIX_FIELDS,
  PITCH_FIELD_LABELS,
  type ModelChoice,
  type Pitch,
  type PitchMixField,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { pitchDraftSchema, type PitchDraft } from "./pitches.js";

export interface PitchBlenderInput {
  idea: string;
  /** Питчи-источники целиком: модель должна видеть, откуда взято поле. */
  sources: Pitch[];
  /** Какое поле из какого питча взять (значение — id питча). Остальные поля
   *  модель согласует сама. */
  picks: Partial<Record<PitchMixField, string>>;
  note?: string;
}

const SYSTEM = `Ты — редактор-разработчик замыслов. Автор выбрал части из разных питчей одной книги и просит собрать из них один согласованный питч. Работаешь на русском.

Правила:
- Поля, которые автор указал «из питча X», сохраняй по смыслу; править можно только для согласования (имена, время, место).
- Остальные поля перепиши так, чтобы они естественно следовали из взятых. Не тяни в них детали из питчей, которые автор не выбирал, если они противоречат взятым.
- Заполни все поля. Форматы те же, что у питча: workingTitle 1–5 слов; logline ≤ 280 символов по схеме «Когда [событие], [герой] должен [действие], иначе [цена]»; protagonist и conflict 30–80 слов; stakes 20–60 слов; hook одна деталь; genre и tone свободный текст 1–4 слова; audience одно из ya, adult, all_ages, mg; strength и risk по одному предложению, честно.`;

const LETTERS = "ABCDEFGHIJ";

export function buildPitchBlenderPrompt(input: PitchBlenderInput): string {
  const letterOf = new Map<string, string>();
  input.sources.forEach((s, i) => letterOf.set(s.id, LETTERS[i] ?? String(i + 1)));

  const parts: string[] = ["ЗАДУМКА АВТОРА:", input.idea.trim(), "", "ИСТОЧНИКИ:"];
  for (const s of input.sources) {
    parts.push(
      `ПИТЧ ${letterOf.get(s.id) ?? "?"} «${s.workingTitle}»`,
      `  ${PITCH_FIELD_LABELS.logline}: ${s.logline}`,
      `  ${PITCH_FIELD_LABELS.protagonist}: ${s.protagonist}`,
      `  ${PITCH_FIELD_LABELS.conflict}: ${s.conflict}`,
      `  ${PITCH_FIELD_LABELS.stakes}: ${s.stakes}`,
      `  ${PITCH_FIELD_LABELS.hook}: ${s.hook}`,
      `  ${PITCH_FIELD_LABELS.genre}: ${s.genre}; ${PITCH_FIELD_LABELS.tone}: ${s.tone}; аудитория: ${s.audience}`,
      "",
    );
  }

  parts.push("ВЗЯТЬ:");
  for (const field of PITCH_MIX_FIELDS) {
    const pitchId = input.picks[field];
    if (!pitchId) continue;
    parts.push(`- ${PITCH_FIELD_LABELS[field]} — из питча ${letterOf.get(pitchId) ?? "?"}`);
  }
  parts.push("");

  if (input.note && input.note.trim().length > 0) {
    parts.push("ПОЖЕЛАНИЕ АВТОРА:", input.note.trim(), "");
  }

  parts.push("ИНСТРУКЦИЯ:", "Собери один согласованный питч. Взятые поля сохрани по смыслу, остальные перепиши под них.");
  return parts.join("\n");
}

const pitchBlenderContract: AgentStructuredContract<PitchBlenderInput, PitchDraft> = {
  agentName: "pitch_blender",
  getOutputSchema: () => pitchDraftSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildPitchBlenderPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_blended_pitch",
    toolDescription:
      "Submit one coherent book pitch assembled from the fields the author picked out of several source pitches.",
  },
};

export function registerPitchBlenderContract(): void {
  registerAgentContract(pitchBlenderContract);
}

export interface RunPitchBlenderOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runPitchBlender(
  input: PitchBlenderInput,
  options: RunPitchBlenderOptions = {},
): Promise<PitchDraft> {
  const { raw } = await dispatchStructured<PitchBlenderInput, PitchDraft>({
    agentName: "pitch_blender",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 2048,
  });
  return raw;
}
