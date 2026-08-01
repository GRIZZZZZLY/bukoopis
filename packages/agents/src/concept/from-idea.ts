import { z } from "zod";
import {
  GENRES,
  TONES,
  audienceSchema,
  emptyBookConcept,
  type Audience,
  type BookConcept,
  type ModelChoice,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

/** Free-form braindump: whatever the author has in their head, one line or ten. */
export interface ConceptFromIdeaInput {
  idea: string;
}

const conceptFromIdeaOutputSchema = z.object({
  genres: z.array(z.string().min(1)).max(4),
  tones: z.array(z.string().min(1)).max(3),
  audience: audienceSchema,
  protagonist: z.string().min(1).max(2000),
  conflict: z.string().min(1).max(2000),
  stakes: z.string().min(1).max(2000),
  logline: z.string().min(1).max(600),
});

export type ConceptFromIdeaOutput = z.infer<typeof conceptFromIdeaOutputSchema>;

const SYSTEM = `Ты — литературный редактор, который слушает автора и раскладывает его замысел по полкам. Работаешь на русском.

Автор даёт свободный текст: одну фразу, абзац или сбивчивый поток мыслей о книге, которую хочет написать. Твоя задача — не придумать за него новую историю, а вытащить то, что он уже сказал, и достроить минимально необходимое.

Правила:
- Всё, что автор сказал явно, сохраняй по смыслу. Не заменяй его идею на более «правильную».
- Чего автор не сказал — выведи из сказанного, самым осторожным способом. Не добавляй «избранных», «древнее зло» и «судьбу мира», если их нет.
- Жанры и тон подбирай из выданных списков по id. Если ничего не подходит — верни свой короткий ярлык на русском.
- Аудиторию выбирай из: ya (young adult), adult, all_ages, mg (middle grade). По умолчанию adult.
- Логлайн — одно-два предложения ≤ 280 символов, формат: "Когда [инцидент], [протагонист] должен [действие], или [последствие]".
- Протагонист, конфликт и ставки — по короткому абзацу (30–80 слов) каждый, конкретно и без штампов.`;

function genreCatalogue(): string {
  return GENRES.map((g) => `${g.id} — ${g.label}`).join("\n");
}

function toneCatalogue(): string {
  return TONES.map((t) => `${t.id} — ${t.label}`).join("\n");
}

function buildPrompt(input: ConceptFromIdeaInput): string {
  return [
    "ИДЕЯ АВТОРА:",
    input.idea.trim(),
    "",
    "ДОСТУПНЫЕ ЖАНРЫ (id — название):",
    genreCatalogue(),
    "",
    "ДОСТУПНЫЕ ТОНА (id — название):",
    toneCatalogue(),
    "",
    "ИНСТРУКЦИЯ:",
    "Разложи идею автора в структуру концепта: 1–4 жанра, 1–3 тона, аудитория, протагонист, конфликт, ставки, логлайн.",
    "Жанры и тона возвращай как id из списков выше; свой ярлык — только если в списках нет ничего близкого.",
  ].join("\n");
}

const conceptFromIdeaContract: AgentStructuredContract<
  ConceptFromIdeaInput,
  ConceptFromIdeaOutput
> = {
  agentName: "concept_from_idea",
  getOutputSchema: () => conceptFromIdeaOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_concept",
    toolDescription:
      "Submit a structured book concept (genres, tones, audience, protagonist, conflict, stakes, logline) derived from the author's free-form idea.",
  },
};

export function registerConceptFromIdeaContract(): void {
  registerAgentContract(conceptFromIdeaContract);
}

const GENRE_IDS = new Set(GENRES.map((g) => g.id));
const TONE_IDS = new Set(TONES.map((t) => t.id));

/** Splits the model's labels into registry ids and free-text ones. A label the
 *  registry does not know still belongs in the concept — as a custom genre/tone,
 *  which the pickers already render — rather than being dropped. */
function splitByRegistry(
  labels: string[],
  known: Set<string>,
): { ids: string[]; custom: string[] } {
  const ids: string[] = [];
  const custom: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label.length === 0) continue;
    if (known.has(label)) {
      if (!ids.includes(label)) ids.push(label);
    } else if (!custom.includes(label)) {
      custom.push(label);
    }
  }
  return { ids, custom };
}

/** Maps the agent output onto a BookConcept the concept form can load directly.
 *  `idea` is carried through so the structured concept keeps a record of the
 *  sentence it was derived from. */
export function toBookConcept(
  out: ConceptFromIdeaOutput,
  audienceFallback: Audience = "adult",
  idea?: string,
): BookConcept {
  const genres = splitByRegistry(out.genres, GENRE_IDS);
  const tones = splitByRegistry(out.tones, TONE_IDS);
  return {
    ...emptyBookConcept(),
    ...(idea !== undefined && idea.trim().length > 0
      ? { idea: idea.trim() }
      : {}),
    genres: genres.ids,
    ...(genres.custom.length > 0 ? { customGenres: genres.custom } : {}),
    tones: tones.ids,
    ...(tones.custom.length > 0 ? { customTones: tones.custom } : {}),
    audience: out.audience ?? audienceFallback,
    premise: {
      protagonist: out.protagonist,
      conflict: out.conflict,
      stakes: out.stakes,
      logline: out.logline,
    },
  };
}

export interface RunConceptFromIdeaOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runConceptFromIdea(
  input: ConceptFromIdeaInput,
  options: RunConceptFromIdeaOptions = {},
): Promise<BookConcept> {
  const { raw } = await dispatchStructured<
    ConceptFromIdeaInput,
    ConceptFromIdeaOutput
  >({
    agentName: "concept_from_idea",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 2048,
  });
  return toBookConcept(raw, "adult", input.idea);
}
