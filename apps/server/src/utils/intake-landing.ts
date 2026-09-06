import { createHash } from "node:crypto";
import {
  INTAKE_TARGET_LABELS,
  buildImportedEntityAspect,
  buildImportedMarkdownAspect,
  buildImportedPlanVariant,
  mergeAspectsIntoStage,
  type BookOutlineVariant,
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
 *  поэтому повторное перетаскивание той же папки не создаёт дублей. Каждая
 *  запись хешируется как JSON-массив — граница между именем файла и
 *  содержимым однозначна, а не просто разделена пробелом, который в имени
 *  файла ничем не отличается от пробела в тексте. */
export function intakeRequestKey(
  files: Array<{ filename: string; content: string }>,
): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    h.update(JSON.stringify([f.filename, f.content]));
  }
  return h.digest("hex").slice(0, 32);
}

/** Ключ одного файла внутри перетаскивания: журнал помнит, какие файлы прогон
 *  реально разобрал, чтобы повтор после остановки дочитал только остальные.
 *  Считается так же, как и ключ всей папки, — от пары «имя + содержимое», а не
 *  от одного имени: в папке с подпапками два разных файла легко зовутся
 *  одинаково. */
export function intakeFileKey(file: { filename: string; content: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([file.filename, file.content]))
    .digest("hex")
    .slice(0, 32);
}

export interface LandFragmentsResult {
  next: StudioState;
  landed: IntakeLanded[];
  /** Главы route обрабатывает сам — у них своя таблица, а не studio_state. */
  chapterFragments: IntakeFragment[];
  /** Варианты плана из авторских оглавлений: их кладёт в books.outline_json
   *  вызывающая сторона, потому что это колонка книги, а не studio_state. */
  planVariants: BookOutlineVariant[];
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
  const planVariants: BookOutlineVariant[] = [];
  const byStage = new Map<AspectTarget, StageAspect[]>();

  for (const fragment of fragments) {
    if (fragment.target === "chapters") {
      chapterFragments.push(fragment);
      continue;
    }
    if (!isAspectTarget(fragment.target)) continue; // concept и skip

    // Разобранное оглавление — это план, а не заметка о плане. Аспектом оно
    // становиться не должно: приземлившись абзацем прозы, самый
    // структурированный файл в материалах обесценивается, а список глав автор
    // всё равно заводит руками.
    if (fragment.target === "plot") {
      const variant = buildImportedPlanVariant(fragment);
      if (variant) {
        planVariants.push(variant);
        landed.push({ target: "plot", title: fragment.title, kind: "plan" });
        continue;
      }
      // Списка глав в тексте не было — пусть остаётся заметкой на экране плана.
    }

    // Этап сущностей умеет показывать только набор карточек. Фрагмент, из
    // которого классификатор не вытащил ни одного имени (файл про связи, где
    // никто не назван прямо, — вполне обычный ответ), карточками не станет, а
    // markdown на «Персонажах» рисовать нечем. Проза о людях — это лор:
    // единственный этап, который держит такой текст и показывает его как есть.
    let target: AspectTarget = fragment.target;
    let aspect: StageAspect | undefined;
    if (target === "characters" || target === "items") {
      aspect = buildImportedEntityAspect(fragment, 0, now);
      if (!aspect) target = "lore";
    }

    const bucket = byStage.get(target) ?? [];
    // Порядок здесь предварительный: mergeAspectsIntoStage перенумерует всё
    // от конца уже лежащих на этапе аспектов.
    aspect ??= buildImportedMarkdownAspect(fragment, bucket.length, now);
    bucket.push(aspect);
    byStage.set(target, bucket);
    landed.push({ target, title: fragment.title, kind: "aspect" });
  }

  const stages: StudioState["stages"] = { ...state.stages };
  for (const [target, aspects] of byStage) {
    stages[target] = mergeAspectsIntoStage(
      stages[target] ?? emptyStage(),
      aspects,
      now,
    );
  }

  return { next: { ...state, stages }, landed, chapterFragments, planVariants };
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
