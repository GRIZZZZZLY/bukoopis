import { useState } from "react";
import type {
  AspectVariant,
  StageAspect,
  StageState,
} from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";
import type {
  AccumulatedContext,
  StageAdapter,
  VariantGenerator,
} from "./types.js";
import { GenerationProgress } from "./GenerationProgress.js";
import { ManualAspectForm } from "./ManualAspectForm.js";

interface Props<TPayload> {
  stage: StageState;
  /** Current StudioState revision — passed back to parent on patch. */
  revision: number;
  adapter: StageAdapter<TPayload>;
  generator: VariantGenerator<TPayload>;
  /** Parent callback that owns the API patch. Returns new state + revision
   *  after server confirms. */
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

const STATUS_LABEL: Record<StageAspect["status"], string> = {
  pending: "ожидает",
  generating: "генерация…",
  reviewing: "выбор",
  accepted: "принято",
  skipped: "пропущено",
};

export function AspectRunner<TPayload>({
  stage,
  revision,
  adapter,
  generator,
  onPatch,
}: Props<TPayload>) {
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>(
    {},
  );
  const [refiningVariantId, setRefiningVariantId] = useState<string | null>(null);
  const [refineInstructions, setRefineInstructions] = useState<string>("");
  const [progressByAspect, setProgressByAspect] = useState<
    Record<string, AspectGenerationProgress>
  >({});
  /** Author's own starting text, handed to the model as a seed. */
  const [seedByAspect, setSeedByAspect] = useState<Record<string, string>>({});
  const [editingAspectId, setEditingAspectId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [batchIds, setBatchIds] = useState<ReadonlySet<string>>(new Set());

  if (stage.aspects.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        На этом этапе пока нет разделов — начните с плана.
      </p>
    );
  }

  function buildAccumulatedContext(skip?: string): AccumulatedContext {
    return {
      acceptedAspects: stage.aspects
        .filter(
          (a) =>
            a.status === "accepted" &&
            a.id !== skip &&
            a.finalPayload !== undefined,
        )
        .sort((a, b) => a.order - b.order)
        .map((a) => ({
          id: a.id,
          name: a.name,
          finalPayload: a.finalPayload,
        })),
    };
  }

  function buildNextStage(
    updater: (a: StageAspect) => StageAspect,
    aspectId: string,
  ): StageState {
    return {
      ...stage,
      status: stage.status === "not_started" ? "in_progress" : stage.status,
      aspects: stage.aspects.map((a) => (a.id === aspectId ? updater(a) : a)),
      updatedAt: new Date().toISOString(),
    };
  }

  async function applyPatch(
    aspectId: string,
    next: StageState,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspectId]: "" }));
    setBusyAspectId(aspectId);
    try {
      await onPatch(revision, next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorByAspect((p) => ({ ...p, [aspectId]: msg }));
    } finally {
      setBusyAspectId(null);
    }
  }

  function trackProgress(
    aspectId: string,
  ): (p: AspectGenerationProgress) => void {
    return (progress) =>
      setProgressByAspect((p) => ({ ...p, [aspectId]: progress }));
  }

  function clearProgress(aspectId: string): void {
    setProgressByAspect((p) => {
      if (!(aspectId in p)) return p;
      const copy = { ...p };
      delete copy[aspectId];
      return copy;
    });
  }

  async function handleGenerate(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const seed = (seedByAspect[aspect.id] ?? "").trim();
      const variants = await generator.generate(
        {
          aspect,
          accumulated: buildAccumulatedContext(aspect.id),
          ...(seed.length > 0 ? { draft: seed } : {}),
        },
        trackProgress(aspect.id),
      );
      const next = buildNextStage(
        (a) => ({
          ...a,
          status: "reviewing" as const,
          variants,
          ...(a.selectedVariantId !== undefined
            ? { selectedVariantId: undefined }
            : {}),
        }),
        aspect.id,
      );
      await onPatch(revision, next);
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
      clearProgress(aspect.id);
    }
  }

  async function handleAccept(
    aspect: StageAspect,
    variant: AspectVariant,
  ): Promise<void> {
    const next = buildNextStage(
      (a) => ({
        ...a,
        status: "accepted" as const,
        selectedVariantId: variant.id,
        finalPayload: variant.payload,
        variants: a.variants.map((v) =>
          v.id === variant.id
            ? { ...v, status: "accepted" as const }
            : v.status === "accepted"
              ? { ...v, status: "rejected" as const }
              : v,
        ),
      }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  async function handleSkip(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "skipped" as const }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  async function handleRestore(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "pending" as const }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  /** Reopens the variant list. The accepted text stays on the aspect so that
   *  walking away mid-reconsideration loses nothing; accepting again just
   *  overwrites it. */
  async function handleReopen(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "reviewing" as const }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  /** One request per section at ~2 minutes each turns a nine-section stage into
   *  a twenty-minute queue of single clicks. This runs the untouched ones a few
   *  at a time and lands them in ONE patch: concurrent patches would each carry
   *  the same stale revision and lose all but one to a 409.
   *
   *  The trade-off is real and stated in the UI — batched sections are written
   *  against the context accepted so far, so they do not see each other. */
  async function handleGenerateAll(): Promise<void> {
    const queue = stage.aspects.filter((a) => a.status === "pending");
    if (queue.length === 0) return;
    setBatchIds(new Set(queue.map((a) => a.id)));
    setErrorByAspect({});

    const accumulated = buildAccumulatedContext();
    const results = new Map<string, AspectVariant[]>();
    const failures: Record<string, string> = {};
    const CONCURRENCY = 3;
    let cursor = 0;

    async function worker(): Promise<void> {
      for (;;) {
        const aspect = queue[cursor++];
        if (!aspect) return;
        const seed = (seedByAspect[aspect.id] ?? "").trim();
        try {
          const variants = await generator.generate(
            {
              aspect,
              accumulated,
              ...(seed.length > 0 ? { draft: seed } : {}),
            },
            trackProgress(aspect.id),
          );
          results.set(aspect.id, variants);
        } catch (e) {
          failures[aspect.id] = e instanceof Error ? e.message : String(e);
        } finally {
          clearProgress(aspect.id);
          setBatchIds((prev) => {
            const copy = new Set(prev);
            copy.delete(aspect.id);
            return copy;
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
    );

    if (results.size > 0) {
      const next: StageState = {
        ...stage,
        status: stage.status === "not_started" ? "in_progress" : stage.status,
        aspects: stage.aspects.map((a) => {
          const variants = results.get(a.id);
          if (!variants) return a;
          return {
            ...a,
            status: "reviewing" as const,
            variants,
            ...(a.selectedVariantId !== undefined
              ? { selectedVariantId: undefined }
              : {}),
          };
        }),
        updatedAt: new Date().toISOString(),
      };
      try {
        await onPatch(revision, next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        for (const id of results.keys()) failures[id] = msg;
      }
    }
    if (Object.keys(failures).length > 0) setErrorByAspect(failures);
  }

  /** Saves the author's own wording as a new accepted variant. The model's
   *  version becomes its superseded parent, so the edit is a step in the
   *  aspect's history rather than an overwrite. */
  async function handleSaveEdit(aspect: StageAspect): Promise<void> {
    const editable = adapter.editable;
    if (!editable) return;
    const parsed = adapter.payloadSchema.safeParse(editable.fromText(editText));
    if (!parsed.success) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: `Текст не подходит: ${parsed.error.issues[0]?.message ?? "неизвестная причина"}`,
      }));
      return;
    }
    const payload = parsed.data;
    const variant: AspectVariant = {
      id: crypto.randomUUID(),
      label: "моя правка",
      payloadKind: adapter.payloadKind,
      payload,
      status: "accepted",
      editSource: "manual",
      generatedAt: new Date().toISOString(),
      ...(aspect.selectedVariantId !== undefined
        ? { parentVariantId: aspect.selectedVariantId }
        : {}),
    };
    const next = buildNextStage(
      (a) => ({
        ...a,
        status: "accepted" as const,
        selectedVariantId: variant.id,
        finalPayload: payload,
        variants: [
          ...a.variants.map((v) =>
            v.id === a.selectedVariantId
              ? { ...v, status: "superseded" as const }
              : v.status === "accepted"
                ? { ...v, status: "rejected" as const }
                : v,
          ),
          variant,
        ],
      }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
    setEditingAspectId(null);
    setEditText("");
  }

  async function handleRefineSubmit(
    aspect: StageAspect,
    variant: AspectVariant,
    instructions: string,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const parsed = adapter.payloadSchema.safeParse(variant.payload);
      if (!parsed.success) {
        throw new Error(
          `payload не валиден: ${parsed.error.message}`,
        );
      }
      const newVariants = await generator.generate(
        {
          aspect,
          accumulated: buildAccumulatedContext(aspect.id),
          refineFrom: {
            variantId: variant.id,
            payload: parsed.data,
            instructions,
          },
        },
        trackProgress(aspect.id),
      );
      const next = buildNextStage(
        (a) => ({
          ...a,
          variants: [
            ...a.variants.map((v) =>
              v.id === variant.id
                ? { ...v, status: "superseded" as const }
                : v,
            ),
            ...newVariants,
          ],
        }),
        aspect.id,
      );
      await onPatch(revision, next);
      setRefiningVariantId(null);
      setRefineInstructions("");
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
      clearProgress(aspect.id);
    }
  }

  function renderVariantPayload(variant: AspectVariant): React.ReactNode {
    const parsed = adapter.payloadSchema.safeParse(variant.payload);
    if (!parsed.success) {
      return (
        <p className="text-xs text-[var(--color-ink-red)]">
          Не удалось разобрать payload: {parsed.error.message}
        </p>
      );
    }
    return adapter.renderVariant(parsed.data);
  }

  function renderFinalPayload(payload: unknown): React.ReactNode {
    const parsed = adapter.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return (
        <p className="text-xs text-[var(--color-ink-red)]">
          Не удалось разобрать финальный payload: {parsed.error.message}
        </p>
      );
    }
    return adapter.renderFinal(parsed.data);
  }

  const pendingCount = stage.aspects.filter(
    (a) => a.status === "pending",
  ).length;
  const batchRunning = batchIds.size > 0;

  return (
    <ul
      aria-label="aspects"
      className="lw-card flex flex-col gap-4"
    >
      {pendingCount > 1 && (
        <li className="flex flex-col gap-1 border-b border-[var(--color-border)] pb-3">
          <button
            type="button"
            onClick={handleGenerateAll}
            disabled={batchRunning || busyAspectId !== null}
            className="text-sm self-start border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
          >
            {batchRunning
              ? `Генерируем… осталось ${batchIds.size}`
              : `Сгенерировать все оставшиеся (${pendingCount})`}
          </button>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Разделы пишутся сразу и не видят друг друга — только то, что вы уже
            приняли. По одному выйдет связнее, зато дольше.
          </span>
        </li>
      )}
      {stage.aspects.map((aspect) => {
        const busy = busyAspectId === aspect.id || batchIds.has(aspect.id);
        const err = errorByAspect[aspect.id];
        const progress = progressByAspect[aspect.id];
        return (
          <li
            key={aspect.id}
            data-aspect-id={aspect.id}
            className="flex flex-col gap-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[15px] text-[var(--color-text-strong)]"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
                >
                  {aspect.name}
                </span>
                {aspect.required && (
                  <span className="text-xs text-[var(--color-ink-amber)]">
                    (обязательно)
                  </span>
                )}
              </div>
              <span
                aria-label={`status-${aspect.status}`}
                className={
                  "lw-pill " +
                  (aspect.status === "accepted"
                    ? ""
                    : aspect.status === "pending"
                      ? ""
                      : "")
                }
                data-tone={
                  aspect.status === "accepted"
                    ? "green"
                    : aspect.status === "pending"
                      ? "amber"
                      : aspect.status === "generating" ||
                          aspect.status === "reviewing"
                        ? "brass"
                        : undefined
                }
              >
                {STATUS_LABEL[aspect.status]}
              </span>
            </div>

            {aspect.description && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {aspect.description}
              </p>
            )}

            {progress && (
              <GenerationProgress
                progress={progress}
                label={`progress-${aspect.id}`}
              />
            )}

            {aspect.status === "pending" && (
              <div className="flex flex-col gap-2">
                <textarea
                  value={seedByAspect[aspect.id] ?? ""}
                  onChange={(e) =>
                    setSeedByAspect((p) => ({
                      ...p,
                      [aspect.id]: e.target.value,
                    }))
                  }
                  rows={2}
                  aria-label={`Свой черновик для «${aspect.name}»`}
                  placeholder="Если уже знаете, что здесь должно быть, — напишите. ИИ оттолкнётся от вашего текста."
                  className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
                />
                <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className={
                    "text-sm border rounded-md px-3 py-1 " +
                    (busy
                      ? "bg-[var(--color-muted)] cursor-not-allowed"
                      : "border-[var(--color-brass)] text-[var(--color-brass)] hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)]")
                  }
                >
                  {busy ? "Генерируем…" : "Сгенерировать варианты"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip(aspect)}
                  disabled={busy}
                  className="text-sm border rounded-md px-3 py-1 border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                >
                  Пропустить
                </button>
                </div>
              </div>
            )}

            {aspect.status === "reviewing" && aspect.variants.length > 0 && (
              <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
                {aspect.variants
                  .filter((v) => v.status !== "superseded")
                  .map((v) => {
                    const isRefining = refiningVariantId === v.id;
                    return (
                      <div key={v.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                            {v.label}
                          </span>
                          {v.id === aspect.selectedVariantId && (
                            <span className="lw-pill" data-tone="green">
                              сейчас выбран
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleAccept(aspect, v)}
                            disabled={busy}
                            className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)]"
                          >
                            Принять
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRefiningVariantId(isRefining ? null : v.id);
                              setRefineInstructions("");
                            }}
                            disabled={busy}
                            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                          >
                            {isRefining ? "Закрыть" : "✏️ Уточнить"}
                          </button>
                        </div>
                        {renderVariantPayload(v)}
                        {isRefining && (
                          <div className="flex flex-col gap-2 mt-1 border-l-2 border-[var(--color-brass)] pl-3">
                            <textarea
                              value={refineInstructions}
                              onChange={(e) =>
                                setRefineInstructions(e.target.value)
                              }
                              placeholder="Сделай мрачнее, добавь фракцию X…"
                              rows={2}
                              aria-label={`refine-instructions-${v.id}`}
                              className="border border-[var(--color-border)] rounded px-2 py-1 text-sm"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleRefineSubmit(
                                    aspect,
                                    v,
                                    refineInstructions,
                                  )
                                }
                                disabled={busy || !refineInstructions.trim()}
                                className={
                                  "text-xs border rounded-md px-2 py-1 " +
                                  (busy || !refineInstructions.trim()
                                    ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed"
                                    : "bg-[var(--color-brass)] text-[var(--color-bg)] border-[var(--color-brass)]")
                                }
                              >
                                Применить
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRefiningVariantId(null);
                                  setRefineInstructions("");
                                }}
                                className="text-xs border border-[var(--color-border)] rounded-md px-2 py-1 hover:bg-[var(--color-muted)]"
                              >
                                Отменить
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerate(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Перегенерировать
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Пропустить
                  </button>
                </div>
              </div>
            )}

            {aspect.status === "accepted" &&
              aspect.finalPayload !== undefined &&
              editingAspectId === aspect.id &&
              adapter.editable && (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={10}
                    aria-label={`Текст раздела «${aspect.name}»`}
                    className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent font-[var(--font-body)]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(aspect)}
                      disabled={busy || editText.trim().length === 0}
                      className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? "Сохраняем…" : "Сохранить правку"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAspectId(null);
                        setEditText("");
                      }}
                      disabled={busy}
                      className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

            {aspect.status === "accepted" &&
              aspect.finalPayload !== undefined &&
              editingAspectId !== aspect.id && (
                <div className="flex flex-col gap-2">
                  {renderFinalPayload(aspect.finalPayload)}
                  <div className="flex gap-2">
                    {adapter.editable && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAspectId(aspect.id);
                          setEditText(
                            adapter.editable!.toText(
                              aspect.finalPayload as TPayload,
                            ),
                          );
                        }}
                        disabled={busy}
                        className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                      >
                        Редактировать текст
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReopen(aspect)}
                      disabled={busy}
                      className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                    >
                      Выбрать другой вариант
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSkip(aspect)}
                      disabled={busy}
                      title="Раздел останется в списке — его можно вернуть"
                      className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                    >
                      Пропустить раздел
                    </button>
                  </div>
                </div>
              )}

            {aspect.status === "skipped" && (
              <div>
                <button
                  type="button"
                  onClick={() => handleRestore(aspect)}
                  disabled={busy}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                >
                  Вернуть раздел
                </button>
              </div>
            )}

            {err && (
              <p role="alert" className="text-xs text-[var(--color-ink-red)]">
                {err}
              </p>
            )}
          </li>
        );
      })}
      <li>
        <ManualAspectForm
          stage={stage}
          revision={revision}
          payloadKind={adapter.payloadKind}
          onPatch={onPatch}
        />
      </li>
    </ul>
  );
}
