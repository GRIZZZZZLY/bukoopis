import { aspectModelLabel } from "./aspect-model-label.js";
import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookOutlineSchema,
  isDocumentStage,
  type AspectVariant,
  type BookConcept,
  type BookOutline,
  type ContextRef,
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
import {
  runAspectDocument,
  toStoredDocumentVariant,
  type DocumentSectionOut,
} from "@book-forge/agents/aspects/document";
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
  // Мир и лор — документные этапы (фаза 3): ветка стоит до чтения плейбука,
  // потому что для них плейбука с вариантами на раздел больше нет вовсе.
  if (isDocumentStage(stageId)) {
    await generateDocumentStage(deps, stageId);
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

/** Живой вариант раздела: выбранный автором, если он не вытеснен и не
 *  отвергнут, иначе последний живой. Дублирует `currentVariant` из
 *  `apps/web/src/components/studio/aspect-engine/documentSections.ts` (commit
 *  83be751) нарочно — общего кода между apps/server и apps/web для документных
 *  этапов нет (решение фазы 3), но правило обязано совпадать: иначе кнопка на
 *  экране и быстрый сбор разошлись бы в том, что считать «уже заполненным». */
function currentDocumentVariant(aspect: StageAspect): AspectVariant | null {
  if (aspect.selectedVariantId) {
    const picked = aspect.variants.find((v) => v.id === aspect.selectedVariantId);
    // Прежний экран при уточнении помечал вариант superseded, не снимая
    // selectedVariantId — старые разделы мира/лора хранят выбор, указывающий
    // на мёртвый вариант.
    if (picked && picked.status !== "superseded" && picked.status !== "rejected") {
      return picked;
    }
  }
  for (let i = aspect.variants.length - 1; i >= 0; i -= 1) {
    const v = aspect.variants[i];
    if (!v) continue;
    if (v.status === "superseded" || v.status === "rejected") continue;
    return v;
  }
  return null;
}

/** Текст раздела или `null`, если его по сути ещё нет. Принятый текст сильнее
 *  вариантов. Зеркало `sectionText` того же файла веба. */
function documentSectionText(aspect: StageAspect): string | null {
  if (typeof aspect.finalPayload === "string" && aspect.finalPayload.trim()) {
    return aspect.finalPayload;
  }
  const v = currentDocumentVariant(aspect);
  if (v && typeof v.payload === "string" && v.payload.trim()) return v.payload;
  return null;
}

/** Имена разделов — не канон сущностей: живут внутри одного этапа, тёзок не
 *  бывает, падежей у них нет. Поэтому регистра и краёв достаточно. */
function normalizeSectionName(name: string): string {
  return name.trim().toLocaleLowerCase("ru");
}

/** Слияние ответа `aspect_document` в состояние этапа. Зеркалит
 *  `mergeDocumentSections` из документного экрана веба (тот же файл, что и
 *  выше) — две реализации намеренно, но правила обязаны совпадать:
 *  · раздел с текстом (по правилу `documentSectionText`) не трогается;
 *  · пропущенный раздел не воскрешается;
 *  · один и тот же раздел дважды в ответе модели не удваивает запись —
 *    только первое вхождение считается. */
function mergeDocumentSections(
  stage: StageState,
  sections: DocumentSectionOut[],
  meta: { contextRef: ContextRef; modelId: string },
): StageState {
  const byName = new Map<string, StageAspect>();
  for (const a of stage.aspects) byName.set(normalizeSectionName(a.name), a);

  let maxOrder = stage.aspects.reduce((m, a) => Math.max(m, a.order), -1);
  const updates = new Map<string, StageAspect>();
  const added: StageAspect[] = [];
  const handled = new Set<string>();

  for (const section of sections) {
    const key = normalizeSectionName(section.name);
    // Модель возвращает один раздел дважды чаще, чем кажется. Второй экземпляр
    // не должен завести второй раздел с тем же именем.
    if (handled.has(key)) continue;
    handled.add(key);
    const variant = toStoredDocumentVariant(section, meta);
    const existing = byName.get(key);
    if (!existing) {
      maxOrder += 1;
      added.push({
        id: randomUUID(),
        name: section.name,
        description: section.description,
        status: "reviewing",
        order: maxOrder,
        required: false,
        source: "llm",
        payloadKind: "markdown",
        variants: [variant],
      });
      continue;
    }
    if (existing.status === "skipped") continue;
    if (documentSectionText(existing) !== null) continue;
    updates.set(existing.id, {
      ...existing,
      status: "reviewing",
      variants: [...existing.variants, variant],
    });
  }

  if (updates.size === 0 && added.length === 0) return stage;
  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: [...stage.aspects.map((a) => updates.get(a.id) ?? a), ...added],
  };
}

/** Мир и лор собираются одним вызовом: раздел документа и есть аспект этапа.
 *  Плейбук с вариантами на каждый раздел давал те же черновики за шесть-семь
 *  вызовов вместо одного — фаза 3 конвейера. Разделы, где текст уже есть,
 *  уходят в промпт как материал автора и не переписываются. */
async function generateDocumentStage(
  deps: QuickStartDeps,
  stageId: StageId,
): Promise<void> {
  const { repo, bookId, sqlite } = deps;
  const concept = repo.loadConcept(bookId);
  const stage = repo.loadStudioState(bookId).stages[stageId];
  const live = (stage?.aspects ?? []).filter((a) => a.status !== "skipped");

  const existingSections: Array<{ name: string; text: string }> = [];
  const emptySectionNames: string[] = [];
  for (const a of live) {
    const text = documentSectionText(a);
    if (text !== null) {
      existingSections.push({ name: a.name, text });
    } else {
      emptySectionNames.push(a.name);
    }
  }

  // Всё заполнено — писать нечего, платить за вызов не за что.
  if (emptySectionNames.length === 0 && existingSections.length > 0) {
    return;
  }

  const contextRef = buildContextRef({
    stageId,
    concept,
    accumulated: existingSections.map((s) => ({
      id: s.name,
      name: s.name,
      finalPayload: s.text,
    })),
    extra: { kind: "document", emptySectionNames },
  });

  const result = await runAspectDocument(
    {
      stageId,
      concept,
      existingSections,
      emptySectionNames,
      ...(stage?.authorNotes !== undefined ? { authorNotes: stage.authorNotes } : {}),
      contextRef,
    },
    {
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: "studio.aspect_document",
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId,
        }),
    },
  );

  const modelId = aspectModelLabel("aspect_document");
  patchStage(deps, stageId, (current) =>
    mergeDocumentSections(current, result.sections, { contextRef, modelId }),
  );
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
