import type { BookConcept } from "./concept.js";
import { isConceptComplete } from "./concept.js";
import type { StageId, StageState, StudioState } from "./studio-state.js";
import { STAGE_IDS } from "./studio-state.js";

export type StudioWarningSeverity = "info" | "warning" | "danger";

export interface StudioWarning {
  id: string;
  severity: StudioWarningSeverity;
  stageId?: StageId;
  message: string;
  action?: { label: string; href: string };
}

export interface CanonSummary {
  characterCount: number;
  locationCount: number;
  itemCount: number;
}

/** The chapters stage keeps no aspects and no `studio_state` record — the
 *  chapters table is its only truth. Everything that needs to know whether
 *  writing has started takes this alongside the studio state. */
export interface ChapterProgress {
  total: number;
  /** Chapters at status "final". */
  finalized: number;
}

export interface StudioWarningsInput {
  concept: BookConcept;
  studioState: StudioState;
  canon: CanonSummary;
  chapters?: ChapterProgress;
}

const STAGE_ORDER: readonly StageId[] = STAGE_IDS;

/** Stage names as the author sees them; the ids are internal. */
const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

function stageStatus(state: StudioState, id: StageId): StageState["status"] | undefined {
  return state.stages[id]?.status;
}

function isAdvanced(state: StudioState, id: StageId): boolean {
  const s = stageStatus(state, id);
  return s === "in_progress" || s === "complete";
}

export function computeStudioWarnings(input: StudioWarningsInput): StudioWarning[] {
  const out: StudioWarning[] = [];
  const { concept, studioState, canon, chapters } = input;
  const writingStarted =
    isAdvanced(studioState, "chapters") || (chapters?.total ?? 0) > 0;

  // 1. Genres empty but a non-concept stage already in motion.
  const advancedNonConcept = (["world", "lore", "characters", "items", "plot", "chapters"] as const).find(
    (s) => isAdvanced(studioState, s),
  );
  if ((concept.genre ?? "").trim().length === 0 && advancedNonConcept) {
    out.push({
      id: `concept_genres_empty_for_${advancedNonConcept}`,
      severity: "warning",
      stageId: "concept",
      message: `Этап «${STAGE_LABELS[advancedNonConcept]}» уже идёт, а жанр не задан — генерация опирается на него. Утвердите замысел.`,
    });
  }

  // 2. Chapters started with zero canon characters.
  if (writingStarted && canon.characterCount === 0) {
    out.push({
      id: "chapters_without_characters",
      severity: "danger",
      stageId: "chapters",
      message:
        "Главы пишутся, а в каноне книги нет ни одного персонажа. Проверка глав на противоречия канону работать не будет.",
    });
  }

  // 3. World complete, lore not started.
  if (
    stageStatus(studioState, "world") === "complete" &&
    (stageStatus(studioState, "lore") ?? "not_started") === "not_started"
  ) {
    out.push({
      id: "lore_not_started_after_world",
      severity: "info",
      stageId: "lore",
      message: "Лор обычно конкретизирует мир. Не пропускайте без причины.",
    });
  }

  // 4. Plot started but logline missing.
  if (isAdvanced(studioState, "plot") && !concept.premise.logline) {
    out.push({
      id: "plot_without_logline",
      severity: "warning",
      stageId: "plot",
      message:
        "Логлайн не задан — сюжет будет строиться вслепую. Утвердите замысел.",
    });
  }

  return out;
}

export interface RecommendedNextInput {
  concept: BookConcept;
  studioState: StudioState;
  chapters?: ChapterProgress;
}

/** The concept stage has no `studio_state` record — it is a form — so its
 *  doneness comes from the concept itself. Without this every other stage
 *  status is irrelevant: the recommendation never moves off "concept". */
function isStageDone(
  concept: BookConcept,
  state: StudioState,
  id: StageId,
  chapters?: ChapterProgress,
): boolean {
  const s = stageStatus(state, id) ?? "not_started";
  if (s === "complete" || s === "skipped") return true;
  if (id === "concept") return isConceptComplete(concept);
  if (id === "chapters") {
    // Every chapter finalized — the book is written. An empty book is not done.
    return (
      chapters !== undefined &&
      chapters.total > 0 &&
      chapters.finalized >= chapters.total
    );
  }
  return false;
}

/** What a stage tile should say. concept and chapters have no aspects to derive
 *  from, so their stored status is always "not_started" — reading it raw makes a
 *  finished book look untouched. */
export function effectiveStageStatus(
  concept: BookConcept,
  studioState: StudioState,
  id: StageId,
  chapters?: ChapterProgress,
): StageState["status"] {
  const stored = stageStatus(studioState, id) ?? "not_started";
  if (stored === "skipped" || stored === "complete") return stored;
  if (isStageDone(concept, studioState, id, chapters)) return "complete";
  if (id === "chapters" && (chapters?.total ?? 0) > 0) return "in_progress";
  if (id === "concept" && !isConceptComplete(concept)) {
    const touched =
      concept.pitches.length > 0 ||
      (concept.idea ?? "").trim().length > 0 ||
      Object.values(concept.premise).some((v) => (v ?? "").trim().length > 0);
    return touched ? "in_progress" : stored;
  }
  return stored;
}

export function computeRecommendedNextStage(
  input: RecommendedNextInput,
): StageId | undefined {
  for (const id of STAGE_ORDER) {
    if (isStageDone(input.concept, input.studioState, id, input.chapters)) {
      continue;
    }
    return id;
  }
  return undefined;
}

export interface StudioStageProgress {
  id: StageId;
  status: "done" | "current" | "todo";
  done: boolean;
}

export interface StudioProgress {
  stages: StudioStageProgress[];
  doneCount: number;
  total: 7;
  recommended: StageId | undefined;
}

export function computeStudioProgress(
  concept: BookConcept,
  studioState: StudioState,
  chapters?: ChapterProgress,
): StudioProgress {
  const recommended = computeRecommendedNextStage({
    concept,
    studioState,
    ...(chapters !== undefined ? { chapters } : {}),
  });
  const stages: StudioStageProgress[] = STAGE_IDS.map((id) => {
    const done = isStageDone(concept, studioState, id, chapters);
    const status: StudioStageProgress["status"] = done
      ? "done"
      : id === recommended
        ? "current"
        : "todo";
    return { id, status, done };
  });
  const doneCount = stages.filter((s) => s.done).length;
  return { stages, doneCount, total: 7, recommended };
}
