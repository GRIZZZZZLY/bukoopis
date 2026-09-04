import { createHash } from "node:crypto";
import {
  INTAKE_TARGET_LABELS,
  buildImportedEntityAspect,
  buildImportedMarkdownAspect,
  mergeAspectsIntoStage,
  type IntakeFragment,
  type IntakeLanded,
  type StageAspect,
  type StageId,
  type StageState,
  type StudioState,
} from "@book-forge/shared";

/** Этапы, на которые интейк кладёт аспекты. `concept` идёт в задумку, а не в
 *  studio_state; `chapters` — через существующий импортёр глав; `skip` никуда. */
const ASPECT_TARGETS = ["world", "lore", "characters", "items", "plot"] as const;
type AspectTarget = (typeof ASPECT_TARGETS)[number];

function isAspectTarget(t: IntakeFragment["target"]): t is AspectTarget {
  return (ASPECT_TARGETS as readonly string[]).includes(t);
}

function emptyStage(): StageState {
  return { status: "not_started", playbookGenerated: false, aspects: [] };
}

/** Один и тот же набор файлов даёт один и тот же ключ независимо от порядка,
 *  поэтому повторное перетаскивание той же папки не создаёт дублей. */
export function intakeRequestKey(
  files: Array<{ filename: string; content: string }>,
): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    h.update(f.filename);
    h.update(" ");
    h.update(f.content);
    h.update(" ");
  }
  return h.digest("hex").slice(0, 32);
}

export interface LandFragmentsResult {
  next: StudioState;
  landed: IntakeLanded[];
  /** Главы route обрабатывает сам — у них своя таблица, а не studio_state. */
  chapterFragments: IntakeFragment[];
}

/** Раскладывает фрагменты по этапам, ничего не утверждая. Входное состояние не
 *  мутируется: результат — новый объект, который вызывающая сторона отдаёт в
 *  patchStudioState вместе с ожидаемой ревизией. */
export function landFragments(
  state: StudioState,
  fragments: IntakeFragment[],
  now: string,
): LandFragmentsResult {
  const landed: IntakeLanded[] = [];
  const chapterFragments: IntakeFragment[] = [];
  const byStage = new Map<AspectTarget, StageAspect[]>();

  for (const fragment of fragments) {
    if (fragment.target === "chapters") {
      chapterFragments.push(fragment);
      continue;
    }
    if (!isAspectTarget(fragment.target)) continue; // concept и skip
    const bucket = byStage.get(fragment.target) ?? [];
    const isEntityStage =
      fragment.target === "characters" || fragment.target === "items";
    const aspect = isEntityStage
      ? buildImportedEntityAspect(fragment, bucket.length, now) ??
        buildImportedMarkdownAspect(fragment, bucket.length, now)
      : buildImportedMarkdownAspect(fragment, bucket.length, now);
    bucket.push(aspect);
    byStage.set(fragment.target, bucket);
    landed.push({ target: fragment.target, title: fragment.title, kind: "aspect" });
  }

  const stages: StudioState["stages"] = { ...state.stages };
  for (const [target, aspects] of byStage) {
    stages[target] = mergeAspectsIntoStage(
      stages[target] ?? emptyStage(),
      aspects,
      now,
    );
  }

  return { next: { ...state, stages }, landed, chapterFragments };
}

/** Короткая опись того, что уже лежит на этапах, для промпта классификатора. */
export function describeExistingStages(state: StudioState): string[] {
  const out: string[] = [];
  for (const target of ASPECT_TARGETS) {
    const stage = state.stages[target as StageId];
    if (!stage || stage.aspects.length === 0) continue;
    const names = stage.aspects.map((a) => a.name).join(", ");
    out.push(`${INTAKE_TARGET_LABELS[target]}: ${names}`);
  }
  return out;
}
