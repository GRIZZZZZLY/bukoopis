import { aspectModelLabel } from "./aspect-model-label.js";
import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookOutlineSchema,
  type AspectVariant,
  type BookConcept,
  type BookOutline,
  type StageAspect,
  type StageId,
  type StageState,
  type StudioState,
} from "@book-forge/shared";
import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import {
  runAspectVariants,
  toStoredVariants,
} from "@book-forge/agents/aspects/variants";
import {
  runAspectEntityVariants,
  toStoredEntityVariants,
} from "@book-forge/agents/aspects/entity-variants";
import { runBookPlanning } from "@book-forge/agents";
import type { StudioRepository } from "../db/studio.js";
import { buildContextRef } from "../services/studio/contextHash.js";
import { loadBookContext } from "../routes/plot.js";
import { loadStudioContext, studioContextToPrompt } from "./studio-context.js";
import { logUsage } from "./usageLogger.js";

/** Порядок сбора — порядок этапов конвейера без замысла (его утверждает автор
 *  до всего) и без глав (они появляются из утверждённого плана). */
export const QUICK_START_STAGES = [
  "world",
  "lore",
  "characters",
  "items",
  "plot",
] as const satisfies readonly StageId[];

export interface QuickStartStageEvent {
  index: number;
  total: number;
  stageId: StageId;
  status: "started" | "done" | "skipped" | "failed";
  /** Причина отказа или пропуска. */
  message?: string;
}

export interface QuickStartResult {
  stages: QuickStartStageEvent[];
  cancelled: boolean;
  revision: number;
}

export interface QuickStartDeps {
  sqlite: DatabaseType;
  hasVec: boolean;
  repo: StudioRepository;
  bookId: number;
}

export interface QuickStartInput {
  onStage?: (e: QuickStartStageEvent) => void;
  shouldStop?: () => boolean;
}

/** Событие не должно ронять сбор: кривой потребитель — его беда, не наша. */
function emit(
  onStage: ((e: QuickStartStageEvent) => void) | undefined,
  e: QuickStartStageEvent,
): void {
  if (!onStage) return;
  try {
    onStage(e);
  } catch {
    /* consumer's problem, not ours */
  }
}

function log(message: string): void {
  console.warn(`[quick-start] ${message}`);
}

/** Готовит черновики всех подготовительных этапов подряд.
 *
 *  Ничего не утверждает: аспекты приходят `reviewing`, как из приёма
 *  материала, и глав не создаёт — их делает «Утвердить план», которое жмёт
 *  автор. Правило «без автора ничего не утверждается» держит и интейк, и
 *  предложения прозы; кнопка быстрого сбора его не отменяет.
 *
 *  Этап, на котором уже что-то лежит, пропускается: повторный сбор не должен
 *  удваивать черновики, а автор мог половину уже разобрать.
 *
 *  Отказ одного этапа не уносит остальные — как отказ одного файла в приёме
 *  материала. Останов проверяется между этапами: прервать идущий вызов агента
 *  нечем. */
export async function runQuickStart(
  deps: QuickStartDeps,
  input: QuickStartInput,
): Promise<QuickStartResult> {
  const { sqlite, repo, bookId } = deps;
  const { onStage, shouldStop } = input;
  const stages: QuickStartStageEvent[] = [];
  const total = QUICK_START_STAGES.length;
  let cancelled = false;

  for (let index = 0; index < total; index++) {
    const stageId = QUICK_START_STAGES[index]!;
    if (shouldStop?.()) {
      cancelled = true;
      log(`book ${bookId}: остановлен перед этапом ${stageId}`);
      break;
    }

    const started: QuickStartStageEvent = { index, total, stageId, status: "started" };
    stages.push(started);
    emit(onStage, started);

    const state: StudioState = repo.loadStudioState(bookId);
    // В12 ревью 2026-09-19: «здесь уже есть черновики» считалось по числу
    // разделов, а список разделов пишется ДО генерации вариантов. Если
    // варианты не собрались (упал бэкенд, конфликт ревизии), этап оставался
    // с пустыми заголовками — и повторный сбор его пропускал, потому что
    // «разделы есть». Автор получал оглавление без содержимого и никакой
    // кнопки, чтобы это доделать. Черновиком считается раздел, у которого
    // есть варианты или решение автора, а не одно имя.
    //
    // Считается по НЕзаполненным, а не по заполненным: «хотя бы один раздел
    // с вариантами» пропускало этап, где собрались три раздела из пяти, и
    // недобранные два не догенерировались никогда.
    const stageAspects = state.stages[stageId]?.aspects ?? [];
    const already =
      stageId === "plot"
        ? planAlreadyThere(sqlite, bookId)
        : stageAspects.length > 0 &&
          !stageAspects.some((a) => a.variants.length === 0 && a.status === "pending");
    if (already) {
      const skipped: QuickStartStageEvent = {
        index,
        total,
        stageId,
        status: "skipped",
        message: "здесь уже есть черновики",
      };
      stages.push(skipped);
      emit(onStage, skipped);
      continue;
    }

    const startedAt = Date.now();
    try {
      await generateStage(deps, stageId);
      const done: QuickStartStageEvent = { index, total, stageId, status: "done" };
      stages.push(done);
      emit(onStage, done);
      log(`book ${bookId}: ${stageId} готов за ${Math.round((Date.now() - startedAt) / 1000)} с`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failed: QuickStartStageEvent = { index, total, stageId, status: "failed", message };
      stages.push(failed);
      emit(onStage, failed);
      log(`book ${bookId}: ${stageId} не собрался — ${message}`);
    }
  }

  const revision = repo.loadStudioState(bookId).revision;
  return { stages, cancelled, revision };
}

/** У плана нет аспектов: его наличие видно по колонке книги. */
function planAlreadyThere(sqlite: DatabaseType, bookId: number): boolean {
  const row = sqlite
    .prepare("SELECT outline_json FROM books WHERE id = ?")
    .get(bookId) as { outline_json: string | null } | undefined;
  return Boolean(row?.outline_json);
}

const ENTITY_STAGES = new Set<StageId>(["characters", "items"]);

/** Столько разделов пишется разом. Ровно как в `AspectRunner.handleGenerateAll`
 *  и с той же платой: разделы одной пачки друг друга не видят. Один за другим
 *  этап из девяти разделов занял бы двадцать минут. */
const CONCURRENCY = 3;

/** Один этап. Вызовы агентов здесь — те же, что делают обработчики Мастерской
 *  (`/stages/:stageId/playbook` и `/aspects/:aspectId/generate`), а для плана —
 *  тот же `runBookPlanning`, что и `POST /books/:id/outline`. Аспекты
 *  сохраняются `reviewing`, как их кладёт приём материала. */
async function generateStage(deps: QuickStartDeps, stageId: StageId): Promise<void> {
  if (stageId === "plot") {
    await generatePlan(deps);
    return;
  }
  const { repo, bookId } = deps;
  const concept: BookConcept = repo.loadConcept(bookId);
  const isEntity = ENTITY_STAGES.has(stageId);

  // Разделы без вариантов остались от прогона, чья генерация не дошла до
  // конца. Второй список поверх них был бы дублем заголовков: доделываем
  // именно эти (В12).
  const existing = repo.loadStudioState(bookId).stages[stageId]?.aspects ?? [];
  const unfinished = existing.filter(
    (a) => a.variants.length === 0 && a.status === "pending",
  );
  if (unfinished.length > 0) {
    await fillVariants(deps, stageId, concept, unfinished);
    return;
  }

  // 1. План разделов этапа. Тот же вызов, что за кнопкой «Составить план
  //    разделов»; вид payload по стадии решает сервер, как и в маршруте.
  const playbook = await runAspectPlaybook({
    stageId,
    concept,
    existingAspectNames: [],
    contextRef: buildContextRef({
      stageId,
      concept,
      accumulated: [],
      extra: { kind: "playbook" },
    }),
  });
  const proposed = playbook.aspects.map((a) => ({
    ...a,
    payloadKind: isEntity ? ("entity_set" as const) : a.payloadKind,
  }));
  if (proposed.length === 0) return;

  // 2. Список разделов сохраняется сразу: если варианты не соберутся, автор
  //    хотя бы увидит план этапа, а не пустоту после пятиминутного ожидания.
  const aspects: StageAspect[] = proposed.map((p, i) => ({
    id: randomUUID(),
    name: p.name,
    description: p.description,
    status: "pending",
    order: i,
    required: p.required,
    source: "llm",
    payloadKind: p.payloadKind,
    variants: [],
  }));
  patchStage(deps, stageId, (stage) => ({
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    playbookGenerated: true,
    aspects: [...stage.aspects, ...aspects],
  }));

  // 3. Варианты каждого раздела. Накопленного контекста нет: ничего ещё не
  //    принято, и принимать за автора мы не собираемся.
  await fillVariants(deps, stageId, concept, aspects);
}

/** Собирает варианты для перечисленных разделов и кладёт их в состояние.
 *  Вынесено, потому что зовётся с двух сторон: на свежем этапе и при
 *  догенерации разделов, оставшихся без вариантов (В12). */
async function fillVariants(
  deps: QuickStartDeps,
  stageId: StageId,
  concept: BookConcept,
  aspects: StageAspect[],
): Promise<void> {
  if (aspects.length === 0) return;
  const results = new Map<string, AspectVariant[]>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const aspect = aspects[cursor++];
      if (!aspect) return;
      const variants = await generateVariants(concept, stageId, aspect);
      results.set(aspect.id, variants);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, aspects.length) }, worker),
  );

  if (results.size === 0) return;
  patchStage(deps, stageId, (stage) => ({
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: stage.aspects.map((a) => {
      const variants = results.get(a.id);
      if (!variants || variants.length === 0) return a;
      // `reviewing` — то самое состояние, из которого AspectRunner принимает
      // одной кнопкой. Ничего не принято и никакого finalPayload.
      return { ...a, status: "reviewing" as const, variants };
    }),
  }));
}

async function generateVariants(
  concept: BookConcept,
  stageId: StageId,
  aspect: StageAspect,
): Promise<AspectVariant[]> {
  const aspectRef = {
    id: aspect.id,
    name: aspect.name,
    ...(aspect.description !== undefined ? { description: aspect.description } : {}),
  };
  if (aspect.payloadKind === "entity_set") {
    const contextRef = buildContextRef({
      stageId,
      concept,
      accumulated: [],
      extra: { kind: "entity_variants", aspectId: aspect.id },
    });
    const result = await runAspectEntityVariants({
      stageId: stageId as "characters" | "items",
      concept,
      aspect: aspectRef,
      accumulated: [],
      contextRef,
    });
    return toStoredEntityVariants(result, {
      contextRef,
      modelId: aspectModelLabel("aspect_entity_variants"),
    });
  }
  const contextRef = buildContextRef({
    stageId,
    concept,
    accumulated: [],
    extra: { kind: "variants", aspectId: aspect.id },
  });
  const result = await runAspectVariants({
    stageId,
    concept,
    aspect: aspectRef,
    accumulated: [],
    contextRef,
  });
  return toStoredVariants(result, {
    contextRef,
    modelId: aspectModelLabel("aspect_variants"),
  });
}

/** План книги. Варианты дописываются к тем, что уже есть (их мог принести
 *  приём материала), и выбор за автора не делается. */
async function generatePlan(deps: QuickStartDeps): Promise<void> {
  const { sqlite, bookId } = deps;
  const ctx = loadBookContext(sqlite, bookId);
  if (!ctx) throw new Error(`book ${bookId} not found`);
  if (!ctx.premise || ctx.premise === "(премиса не задана)") {
    throw new Error("сначала утвердите замысел книги");
  }
  const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, bookId));
  const variants = await runBookPlanning({
    bookTitle: ctx.title,
    premise: ctx.premise,
    language: ctx.language,
    ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
    config: { variants: 2, model: ctx.plotModel },
    onUsage: (usage) =>
      logUsage(sqlite, {
        route: "quick_start.book_outline",
        model: usage.modelId,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
        },
        bookId,
      }),
  });
  if (variants.length === 0) return;

  const row = sqlite
    .prepare("SELECT outline_json FROM books WHERE id = ?")
    .get(bookId) as { outline_json: string | null } | undefined;
  const now = new Date().toISOString();
  let outline: BookOutline = { variants: [], selectedIndex: null, generatedAt: now };
  if (row?.outline_json) {
    const parsed = bookOutlineSchema.safeParse(JSON.parse(row.outline_json));
    if (parsed.success) outline = parsed.data;
  }
  const merged = [...outline.variants, ...variants].slice(0, 5);
  sqlite
    .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
    .run(
      JSON.stringify({ ...outline, variants: merged, generatedAt: now }),
      now,
      bookId,
    );
}

/** Читает состояние заново перед каждой записью: между двумя патчами одного
 *  этапа проходят минуты, и автор в соседней вкладке мог что-то поменять. */
function patchStage(
  deps: QuickStartDeps,
  stageId: StageId,
  update: (stage: StageState) => StageState,
): void {
  const { repo, bookId } = deps;
  const state = repo.loadStudioState(bookId);
  const stage: StageState = state.stages[stageId] ?? {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };
  const next: StudioState = {
    ...state,
    stages: {
      ...state.stages,
      [stageId]: { ...update(stage), updatedAt: new Date().toISOString() },
    },
  };
  repo.patchStudioState(bookId, { expectedRevision: state.revision, next });
}
