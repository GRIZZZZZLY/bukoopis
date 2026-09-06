import { z } from "zod";

// ──────────────────────────────────────────────────────────────────
// Book outline (level 1)
// ──────────────────────────────────────────────────────────────────

export const arcOutlineSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyBeats: z.array(z.string()).min(1).max(10),
});
export type ArcOutline = z.infer<typeof arcOutlineSchema>;

// ─── Narrative architecture sheet ───
//
// Structural decisions taken before the synopsis. StoryScope (Russell et al.
// 2026) showed a classifier on narrative structure alone detects AI fiction at
// 93% F1 and that surface edits barely move it; the 2026-09-04 review of our
// own Writer confirmed the same tells (theme explained, single causal chain,
// choice+acceptance+growth ending). Making the decisions explicit fields gives
// the Plot agent something to commit to and the author something to see.
// Optional in storage so outline_json rows written before the sheet still parse.

export const themeHandlingSchema = z.enum(["stated", "implied", "withheld"]);
export const subplotModeSchema = z.enum(["none", "parallel", "contrasting", "independent"]);
export const resolutionDriverSchema = z.enum(["protagonist_choice", "mixed", "external"]);
export const endingModeSchema = z.enum([
  "external_act",
  "internal_acceptance",
  "partial",
  "open",
  "catastrophic",
]);
export const timeStructureSchema = z.enum(["linear", "moderate_anachrony", "braided"]);
export const revelationPacingSchema = z.enum(["front_loaded", "even", "back_loaded"]);
export const emotionModeSchema = z.enum(["explicit_led", "behavior_led", "embodied_led", "mixed"]);

export const narrativeArchitectureSchema = z.object({
  themeHandling: themeHandlingSchema,
  subplot: subplotModeSchema,
  resolutionDriver: resolutionDriverSchema,
  endingMode: endingModeSchema,
  timeStructure: timeStructureSchema,
  revelationPacing: revelationPacingSchema,
  emotionMode: emotionModeSchema,
  /** The one structural choice atypical for this premise. Exactly one. */
  rarityMove: z.string().min(1),
  /** 3–5 human-leaning moves chosen for this premise. Select, don't accumulate. */
  humanMoves: z.array(z.string().min(1)).min(3).max(5),
});
export type NarrativeArchitecture = z.infer<typeof narrativeArchitectureSchema>;

const RU = {
  themeHandling: { stated: "проговаривается", implied: "подразумевается", withheld: "удержана" },
  subplot: {
    none: "нет",
    parallel: "параллельный",
    contrasting: "контрастный",
    independent: "независимый",
  },
  resolutionDriver: {
    protagonist_choice: "выбор героя",
    mixed: "смешанно",
    external: "внешняя сила",
  },
  endingMode: {
    external_act: "внешнее действие",
    internal_acceptance: "внутреннее принятие",
    partial: "частичный",
    open: "открытый",
    catastrophic: "катастрофический",
  },
  timeStructure: {
    linear: "линейное",
    moderate_anachrony: "умеренная анахрония",
    braided: "переплетённое",
  },
  revelationPacing: {
    front_loaded: "в начале",
    even: "равномерно",
    back_loaded: "во второй половине",
  },
  emotionMode: {
    explicit_led: "через называние",
    behavior_led: "через поведение",
    embodied_led: "через тело",
    mixed: "смешанно",
  },
} as const;

/** Label/value pairs in Russian, one per decision, for UI and prompts. */
export function narrativeArchitectureLines(
  a: NarrativeArchitecture,
): Array<{ label: string; value: string }> {
  return [
    { label: "Тема", value: RU.themeHandling[a.themeHandling] },
    { label: "Подсюжет", value: RU.subplot[a.subplot] },
    { label: "Развязку решает", value: RU.resolutionDriver[a.resolutionDriver] },
    { label: "Финал", value: RU.endingMode[a.endingMode] },
    { label: "Время", value: RU.timeStructure[a.timeStructure] },
    { label: "Откровения", value: RU.revelationPacing[a.revelationPacing] },
    { label: "Эмоции", value: RU.emotionMode[a.emotionMode] },
    { label: "Редкий ход", value: a.rarityMove },
    { label: "Человеческие ходы", value: a.humanMoves.join("; ") },
  ];
}

export function renderNarrativeArchitecture(a: NarrativeArchitecture): string {
  return narrativeArchitectureLines(a)
    .map(({ label, value }) => `${label}: ${value}`)
    .join("\n");
}

/**
 * Tolerant read of the sheet out of a selected-variant JSON string — the shape
 * Writer and Reviser receive. Returns null for a legacy variant, an incomplete
 * sheet or anything unparseable; a prose agent must never fail over context.
 */
export function extractNarrativeArchitecture(
  outlineJson: string | null | undefined,
): NarrativeArchitecture | null {
  if (!outlineJson) return null;
  try {
    const parsed: unknown = JSON.parse(outlineJson);
    if (typeof parsed !== "object" || parsed === null) return null;
    const result = narrativeArchitectureSchema.safeParse(
      (parsed as { architecture?: unknown }).architecture,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Строка поглавного плана. Всё, кроме названия, необязательно: оглавление
 *  автора бывает голым списком, и выдумывать за него POV или конфликт — ровно
 *  то, чего фаза 5 не должна делать. */
export const outlineChapterSchema = z.object({
  title: z.string().trim().min(1).max(300),
  pov: z.string().trim().min(1).max(200).optional(),
  goal: z.string().trim().min(1).max(2000).optional(),
  conflict: z.string().trim().min(1).max(2000).optional(),
  stakes: z.string().trim().min(1).max(2000).optional(),
  hook: z.string().trim().min(1).max(2000).optional(),
});
export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

/** Намерение главы для Plot-агента: то, что автор раньше набирал руками в
 *  `PlanPanel`. Пустые поля пропускаются — строка «Конфликт: » ничего не
 *  сообщает и только сбивает модель. */
export function renderOutlineChapterIntent(ch: OutlineChapter): string {
  const lines: string[] = [ch.title];
  if (ch.pov) lines.push(`POV: ${ch.pov}`);
  if (ch.goal) lines.push(`Цель: ${ch.goal}`);
  if (ch.conflict) lines.push(`Конфликт: ${ch.conflict}`);
  if (ch.stakes) lines.push(`Ставки: ${ch.stakes}`);
  if (ch.hook) lines.push(`Крючок: ${ch.hook}`);
  return lines.join("\n");
}

/** Откуда взялся вариант плана. Автор должен видеть, что перед ним его
 *  собственное оглавление, а не выдумка модели. */
export const outlineSourceSchema = z.enum(["llm", "author_material"]);
export type OutlineSource = z.infer<typeof outlineSourceSchema>;

/** Повествовательные поля здесь необязательны, а в тулсхеме агента —
 *  обязательны. Тот же приём, что уже применён к `architecture` выше: схема
 *  хранения описывает всё, что может лежать в колонке, включая вариант из
 *  авторского оглавления, у которого нет ни синопсиса, ни арок; тулсхема
 *  описывает, что обязан вернуть генератор. Ослаблять требования к генерации
 *  это не должно — см. `bookOutlineToolSchema` в packages/agents/src/plot.ts. */
export const bookOutlineVariantSchema = z.object({
  label: z.string().min(1),
  logline: z.string().min(1).optional(),
  synopsis: z.string().min(1).optional(),
  themes: z.array(z.string()).max(8).optional(),
  protagonist: z.string().min(1).optional(),
  antagonist: z.string().nullable().optional(),
  setting: z.string().min(1).optional(),
  arcs: z.array(arcOutlineSchema).max(7).optional(),
  estimatedChapters: z.number().int().positive().max(120),
  architecture: narrativeArchitectureSchema.optional(),
  /** Поглавные строки. Есть у варианта из материалов автора и у любого
   *  варианта, который автор дополнил руками. */
  chapters: z.array(outlineChapterSchema).max(200).optional(),
  source: outlineSourceSchema.optional(),
});
export type BookOutlineVariant = z.infer<typeof bookOutlineVariantSchema>;

export const bookOutlineSchema = z.object({
  variants: z.array(bookOutlineVariantSchema).min(1).max(5),
  selectedIndex: z.number().int().nonnegative().nullable(),
  generatedAt: z.string(),
});
export type BookOutline = z.infer<typeof bookOutlineSchema>;

// ──────────────────────────────────────────────────────────────────
// Chapter beat-sheet (level 3)
// ──────────────────────────────────────────────────────────────────

export const beatSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.enum([
    "hook",
    "setup",
    "rising_action",
    "midpoint",
    "complication",
    "climax",
    "resolution",
    "transition",
  ]),
  summary: z.string().min(1),
  goal: z.string().min(1),
  conflict: z.string().min(1),
  outcome: z.string().min(1),
});
export type Beat = z.infer<typeof beatSchema>;

// How the chapter ends. All three reviewed Writer versions closed on the same
// tripod (protagonist choice + internal acceptance + growth) with a long
// reflection tail; naming the closing as a decision is how the Plot agent stops
// defaulting to it. Optional in storage for plan_json rows written before it.
export const chapterClosingModeSchema = z.enum([
  "external_act",
  "open",
  "partial",
  "internal_acceptance",
  "catastrophic",
  "cut_mid_action",
]);
export const chapterClosingSchema = z.object({
  mode: chapterClosingModeSchema,
  /** One line: the concrete action, line or image the chapter ends on. */
  note: z.string().min(1),
});
export type ChapterClosing = z.infer<typeof chapterClosingSchema>;

const CLOSING_RU: Record<ChapterClosing["mode"], string> = {
  external_act: "внешнее действие",
  open: "открытый",
  partial: "частичный",
  internal_acceptance: "внутреннее принятие",
  catastrophic: "катастрофа",
  cut_mid_action: "обрыв посреди действия",
};

export function renderChapterClosing(c: ChapterClosing): string {
  return `${CLOSING_RU[c.mode]} — ${c.note}`;
}

export const chapterBeatSheetVariantSchema = z.object({
  label: z.string().min(1),
  pov: z.string().min(1),
  emotionalGoal: z.string().min(1),
  estimatedWords: z.number().int().positive().max(20000),
  beats: z.array(beatSchema).min(3).max(15),
  closing: chapterClosingSchema.optional(),
});
export type ChapterBeatSheetVariant = z.infer<
  typeof chapterBeatSheetVariantSchema
>;

export const chapterPlanSchema = z.object({
  variants: z.array(chapterBeatSheetVariantSchema).min(1).max(5),
  selectedIndex: z.number().int().nonnegative().nullable(),
  generatedAt: z.string(),
});
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

// ──────────────────────────────────────────────────────────────────
// Generation config (per-call overrides)
// ──────────────────────────────────────────────────────────────────

export const modelChoiceSchema = z.enum(["sonnet", "opus"]);
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const generationConfigSchema = z.object({
  variants: z.number().int().min(1).max(5).default(2),
  temperature: z.number().min(0).max(1).optional(),
  model: modelChoiceSchema.optional(),
});
export type GenerationConfig = z.infer<typeof generationConfigSchema>;

// ──────────────────────────────────────────────────────────────────
// API input types
// ──────────────────────────────────────────────────────────────────

export const generateBookOutlineInputSchema = z.object({
  config: generationConfigSchema.optional(),
});
export type GenerateBookOutlineInput = z.infer<
  typeof generateBookOutlineInputSchema
>;

export const selectBookOutlineInputSchema = z.object({
  selectedIndex: z.number().int().nonnegative(),
});
export type SelectBookOutlineInput = z.infer<
  typeof selectBookOutlineInputSchema
>;

export const generateChapterPlanInputSchema = z.object({
  intent: z.string().min(1).max(20000),
  config: generationConfigSchema.optional(),
});
export type GenerateChapterPlanInput = z.infer<
  typeof generateChapterPlanInputSchema
>;

export const selectChapterPlanInputSchema = z.object({
  selectedIndex: z.number().int().nonnegative(),
});
export type SelectChapterPlanInput = z.infer<
  typeof selectChapterPlanInputSchema
>;

export const writeChapterInputSchema = z.object({
  config: generationConfigSchema.optional(),
});
export type WriteChapterInput = z.infer<typeof writeChapterInputSchema>;
