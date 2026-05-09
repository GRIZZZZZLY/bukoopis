import type { BookConcept } from "./concept.js";
import type { StageId, StageState, StudioState } from "./studio-state.js";
import { STAGE_IDS } from "./studio-state.js";
import { GENRES } from "./genre-registry.js";

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

export interface StudioWarningsInput {
  concept: BookConcept;
  studioState: StudioState;
  canon: CanonSummary;
}

const STAGE_ORDER: readonly StageId[] = STAGE_IDS;

function stageStatus(state: StudioState, id: StageId): StageState["status"] | undefined {
  return state.stages[id]?.status;
}

function isAdvanced(state: StudioState, id: StageId): boolean {
  const s = stageStatus(state, id);
  return s === "in_progress" || s === "complete";
}

export function computeStudioWarnings(input: StudioWarningsInput): StudioWarning[] {
  const out: StudioWarning[] = [];
  const { concept, studioState, canon } = input;

  // 1. Genres empty but a non-concept stage already in motion.
  const advancedNonConcept = (["world", "lore", "characters", "items", "plot", "chapters"] as const).find(
    (s) => isAdvanced(studioState, s),
  );
  if (concept.genres.length === 0 && (concept.customGenres ?? []).length === 0 && advancedNonConcept) {
    out.push({
      id: `concept_genres_empty_for_${advancedNonConcept}`,
      severity: "warning",
      stageId: "concept",
      message: `Жанр не выбран, а стадия "${advancedNonConcept}" уже запущена. Сначала зафиксируйте жанры.`,
    });
  }

  // 2. Chapters started with zero canon characters.
  if (isAdvanced(studioState, "chapters") && canon.characterCount === 0) {
    out.push({
      id: "chapters_without_characters",
      severity: "danger",
      stageId: "chapters",
      message: "Главы пишутся без персонажей в каноне. Critic_canon выдаст пустой результат.",
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
      message: "Сюжет генерируется без зафиксированной логлайн-премисы.",
    });
  }

  // 5. Incompatible genre pair from registry. Dedup by sorted-pair key so
  //    symmetric incompatibleWith entries (A→B and B→A) emit one warning.
  const seenPairs = new Set<string>();
  for (const id of concept.genres) {
    const def = GENRES.find((g) => g.id === id);
    if (!def?.incompatibleWith) continue;
    for (const other of concept.genres) {
      if (other === id) continue;
      if (!def.incompatibleWith.includes(other)) continue;
      const pairKey = [id, other].sort().join("␟");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const [a, b] = [id, other].sort();
      out.push({
        id: `incompatible_genres__${a}__${b}`,
        severity: "warning",
        stageId: "concept",
        message: `Жанры "${a}" и "${b}" помечены как несовместимые в реестре.`,
      });
    }
  }

  return out;
}

export interface RecommendedNextInput {
  concept: BookConcept;
  studioState: StudioState;
}

export function computeRecommendedNextStage(
  input: RecommendedNextInput,
): StageId | undefined {
  for (const id of STAGE_ORDER) {
    const s = stageStatus(input.studioState, id) ?? "not_started";
    if (s === "complete" || s === "skipped") continue;
    return id;
  }
  return undefined;
}
