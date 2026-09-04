import { z } from "zod";
import {
  INTAKE_TARGETS,
  INTAKE_TARGET_LABELS,
  intakeFragmentSchema,
  type IntakeFragment,
  type ModelChoice,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

export interface MaterialClassifierInput {
  filename: string;
  content: string;
  /** Задумка книги, если она уже записана: помогает не спутать чужой мир со своим. */
  bookIdea?: string;
  /** Короткие описания того, что уже лежит на этапах, по строке на этап. */
  existingStages?: string[];
}

const materialClassifierOutputSchema = z.object({
  fragments: z.array(intakeFragmentSchema).max(40),
  /** Заполняется только если файл содержит формулировку замысла целиком. */
  bookIdea: z.string().trim().max(8000).optional(),
});
export type MaterialClassifierOutput = z.infer<typeof materialClassifierOutputSchema>;
export type { IntakeFragment };

const SYSTEM = `Ты — редактор, который разбирает рабочие материалы автора и раскладывает их по этапам подготовки книги. Работаешь на русском.

Автор даёт один файл своих заметок: это может быть оглавление, описание мира, свод правил, список персонажей, экономика, карта, готовая глава — что угодно. Твоя задача — разрезать файл на осмысленные фрагменты и каждому назначить этап.

Правила:
- Не пересказывай и не сокращай. Тело фрагмента — текст автора, перенесённый как есть, с сохранением разметки. Ты решаешь, где границы, а не что написано.
- Один фрагмент — одна тема. Файл про кухню двух регионов — два фрагмента, если регионы описаны отдельно, и один, если текст сплошной.
- Заголовок фрагмента бери из заголовка автора. Если его нет — назови коротко и по делу, 2–5 слов.
- note — одна строка, почему фрагмент отнесён именно сюда. Она станет подписью под черновиком.
- Куда что относить:
  - concept: формулировка замысла книги целиком — логлайн, центральный вопрос, тема. Не отдельные факты мира.
  - world: устройство мира — география, климат, общество, технологии, экономика, быт.
  - lore: история, мифы, происхождение, свод правил и ограничений, тайны.
  - characters: люди. Заполняй entities: имя и одна фраза о человеке, по записи на каждого.
  - items: предметы, артефакты, вещества, техника как объекты. entities заполняй так же.
  - plot: оглавление, поглавные планы, арки, матрицы раскрытия тайн, порядок событий.
  - chapters: готовая проза — сцены, написанные главы. Не планы о них.
  - skip: служебное, устаревшее, дубли, заметки «себе на память». Тело всё равно верни — автор увидит, что файл прочитан.
- entities заполняй ТОЛЬКО для characters и items. Для остальных целей оставляй пустым.
- Если файл целиком об одном — верни один фрагмент на весь файл. Дробить ради дробления не нужно.
- Не больше 40 фрагментов на файл. Если естественных разделов больше — объединяй соседние близкие по теме, а не отбрасывай часть материала.
- bookIdea заполняй только если в файле есть готовая формулировка замысла, и только если у книги её ещё нет.`;

function targetCatalogue(): string {
  return INTAKE_TARGETS.map((t) => `${t} — ${INTAKE_TARGET_LABELS[t]}`).join("\n");
}

export function buildClassifierPrompt(input: MaterialClassifierInput): string {
  const parts: string[] = [`ФАЙЛ: ${input.filename}`, ""];
  if (input.bookIdea && input.bookIdea.trim().length > 0) {
    parts.push(
      "ЗАДУМКА КНИГИ (уже есть, не заменяй её — bookIdea оставь пустым):",
      input.bookIdea.trim(),
      "",
    );
  }
  if (input.existingStages && input.existingStages.length > 0) {
    parts.push(
      "НА ЭТАПАХ УЖЕ ЛЕЖИТ (по возможности продолжай эти темы, а не дублируй их):",
      ...input.existingStages.map((s) => `- ${s}`),
      "",
    );
  }
  parts.push(
    "ЭТАПЫ (id — название):",
    targetCatalogue(),
    "",
    "СОДЕРЖИМОЕ ФАЙЛА:",
    input.content,
    "",
    "ИНСТРУКЦИЯ:",
    "Разрежь файл на фрагменты и назначь каждому этап. Тело фрагмента переноси дословно.",
  );
  return parts.join("\n");
}

const materialClassifierContract: AgentStructuredContract<
  MaterialClassifierInput,
  MaterialClassifierOutput
> = {
  agentName: "material_classifier",
  getOutputSchema: () => materialClassifierOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildClassifierPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_material_fragments",
    toolDescription:
      "Submit the author's file cut into fragments, each assigned to a book-preparation stage, with the body carried over verbatim.",
  },
};

export function registerMaterialClassifierContract(): void {
  registerAgentContract(materialClassifierContract);
}

export interface RunMaterialClassifierOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runMaterialClassifier(
  input: MaterialClassifierInput,
  options: RunMaterialClassifierOptions = {},
): Promise<MaterialClassifierOutput> {
  const { raw } = await dispatchStructured<
    MaterialClassifierInput,
    MaterialClassifierOutput
  >({
    agentName: "material_classifier",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 32000,
  });
  return raw;
}
