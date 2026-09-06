import { z } from "zod";
import type { AspectVariant, StageAspect, StageState } from "./studio-state.js";
import {
  outlineChapterSchema,
  type BookOutlineVariant,
  type OutlineChapter,
} from "./plot.js";

/** Куда классификатор может отправить фрагмент. `skip` — «не пригодилось»:
 *  автор видит, что файл прочитан, но в этапы ничего не легло. */
export const INTAKE_TARGETS = [
  "concept",
  "world",
  "lore",
  "characters",
  "items",
  "plot",
  "chapters",
  "skip",
] as const;
export type IntakeTarget = (typeof INTAKE_TARGETS)[number];

/** Названия для автора. Внутренние id этапов ему не показываются. */
export const INTAKE_TARGET_LABELS: Record<IntakeTarget, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "План книги",
  chapters: "Готовые главы",
  skip: "Не пригодилось",
};

export const intakeEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
});
export type IntakeEntity = z.infer<typeof intakeEntitySchema>;

export const intakeFragmentSchema = z.object({
  target: z.enum(INTAKE_TARGETS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(60000),
  /** Одна строка, почему фрагмент отнесён сюда; становится описанием аспекта. */
  note: z.string().trim().max(400).optional(),
  /** Только для characters/items. Пусто для остальных целей. */
  entities: z.array(intakeEntitySchema).max(40).optional(),
  /** Только для цели `plot`: оглавление, разобранное на строки. Пусто, если в
   *  тексте не было поглавного списка — тогда фрагмент останется заметкой. */
  chapters: z.array(outlineChapterSchema).max(200).optional(),
});
export type IntakeFragment = z.infer<typeof intakeFragmentSchema>;

/** Что именно легло — для сводки автору. */
export interface IntakeLanded {
  target: IntakeTarget;
  title: string;
  kind: "aspect" | "chapter" | "idea" | "plan";
}

const VARIANT_LABEL = "из ваших материалов";

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function importedVariant(
  payloadKind: AspectVariant["payloadKind"],
  payload: unknown,
  now: string,
): AspectVariant {
  return {
    id: newId(),
    label: VARIANT_LABEL,
    payloadKind,
    payload,
    status: "generated",
    editSource: "manual",
    generatedAt: now,
  };
}

/** Черновик из материалов автора: аспект в `reviewing` без `finalPayload`, с
 *  единственным непринятым вариантом. Ровно то состояние, из которого
 *  `AspectRunner` умеет принять текст одной кнопкой. */
export function buildImportedMarkdownAspect(
  fragment: IntakeFragment,
  order: number,
  now: string,
): StageAspect {
  return {
    id: newId(),
    name: fragment.title,
    ...(fragment.note !== undefined ? { description: fragment.note } : {}),
    status: "reviewing",
    order,
    required: false,
    source: "import",
    payloadKind: "markdown",
    variants: [importedVariant("markdown", fragment.body, now)],
  };
}

/** То же для этапов сущностей. Кандидаты приходят `proposed` — материализация
 *  в канон остаётся отдельным решением автора. */
export function buildImportedEntityAspect(
  fragment: IntakeFragment,
  order: number,
  now: string,
): StageAspect | undefined {
  const entities = fragment.entities ?? [];
  if (entities.length === 0) return undefined;
  const kind = fragment.target === "items" ? "item" : "character";
  const candidates = entities.map((e) => ({
    tempId: newId(),
    kind,
    profile: { name: e.name, summary: e.summary },
    status: "proposed" as const,
  }));
  return {
    id: newId(),
    name: fragment.title,
    ...(fragment.note !== undefined ? { description: fragment.note } : {}),
    status: "reviewing",
    order,
    required: false,
    source: "import",
    payloadKind: "entity_set",
    variants: [importedVariant("entity_set", { candidates }, now)],
  };
}

/** Дописывает импортированные аспекты в конец этапа, продолжая нумерацию.
 *  Статус этапа не понижается: уже завершённый этап остаётся завершённым,
 *  нетронутый переходит в работу.
 *
 *  Явно пропущенный этап тоже открывается заново — и это не отмена решения
 *  автора, а его же новое решение: `deriveStageStatus` никогда не снимает
 *  «пропущен» сам, поэтому иначе брошенные на такой этап черновики остались бы
 *  невидимыми навсегда. */
export function mergeAspectsIntoStage(
  stage: StageState,
  fresh: StageAspect[],
  now: string,
): StageState {
  if (fresh.length === 0) return stage;
  const base = stage.aspects.length;
  const { skippedReason: _dropped, ...rest } = stage;
  const reopened = stage.status === "not_started" || stage.status === "skipped";
  return {
    ...rest,
    status: reopened ? "in_progress" : stage.status,
    aspects: [
      ...stage.aspects,
      ...fresh.map((a, i) => ({ ...a, order: base + i })),
    ],
    updatedAt: now,
  };
}

/** Авторское оглавление как вариант плана рядом со сгенерированными.
 *  Ничего не досочиняет: ни синопсиса, ни арок, ни архитектуры — только то,
 *  что автор написал сам. `estimatedChapters` берётся из длины списка, а не
 *  из догадки. */
export function buildImportedPlanVariant(
  fragment: IntakeFragment,
): BookOutlineVariant | undefined {
  const chapters: OutlineChapter[] = fragment.chapters ?? [];
  if (chapters.length === 0) return undefined;
  return {
    label: `${VARIANT_LABEL}: ${fragment.title}`,
    estimatedChapters: chapters.length,
    source: "author_material",
    chapters,
  };
}

export interface IntakeSummaryRow {
  target: IntakeTarget;
  label: string;
  count: number;
  titles: string[];
}

/** Сводка «что и куда легло», в порядке этапов конвейера. */
export function summarizeIntake(landed: IntakeLanded[]): IntakeSummaryRow[] {
  const rows: IntakeSummaryRow[] = [];
  for (const target of INTAKE_TARGETS) {
    const mine = landed.filter((l) => l.target === target);
    if (mine.length === 0) continue;
    rows.push({
      target,
      label: INTAKE_TARGET_LABELS[target],
      count: mine.length,
      titles: mine.map((l) => l.title),
    });
  }
  return rows;
}
