import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";
import type { VariantGenerator } from "./types.js";
import { candidateLabel, createEntityAdapter } from "./entityAdapter.js";
import { GenerationProgress } from "./GenerationProgress.js";

/** Те же подписи, что в AspectRunner: пилюля показывала внутренний код
 *  («accepted») латиницей в русском интерфейсе. */
const ASPECT_STATUS_LABEL: Record<StageAspect["status"], string> = {
  pending: "ожидает",
  generating: "генерация…",
  reviewing: "выбор",
  accepted: "принято",
  skipped: "пропущено",
};

interface EntitySetPayload {
  candidates: Array<{
    tempId: string;
    kind: "character" | "location" | "item";
    profile: unknown;
    status: "proposed" | "accepted" | "rejected" | "merged";
    materializedEntityId?: number;
    mergedIntoEntityId?: number;
  }>;
}

/** Полезная нагрузка не той формы — не повод ронять приложение. Единственная
 *  граница ошибок живёт в main.tsx, поэтому брошенное здесь исключение уводит
 *  на экран ошибки всю программу, а не портит одну карточку. Раньше сюда
 *  приезжал markdown-черновик, положенный интейком на этап сущностей. */
function UnreadablePayload() {
  return (
    <p className="text-xs text-[var(--color-ink-amber-fg)]">
      Не удалось показать это карточками — черновик сохранён в другом виде.
      Текст цел: перегенерируйте раздел или поищите его на этапе «Лор».
    </p>
  );
}

interface MaterializeResult {
  aspectId: string;
  createdEntityIds: number[];
  candidates: Array<{
    tempId: string;
    decision: "accept" | "reject";
    materializedEntityId?: number;
    mergedIntoId?: number;
  }>;
}

interface Props {
  stage: StageState;
  revision: number;
  stageId: "characters" | "items";
  generator: VariantGenerator<EntitySetPayload>;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
  onMaterialize: (
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
      }>;
    },
  ) => Promise<MaterializeResult>;
}

/** Every generated variant proposes a whole cast. The one the author picked is
 *  rarely the one with all the right people in it, so the rest stay reachable
 *  person by person instead of being thrown away. */
function OtherVariantPicker({
  aspect,
  selectedVariantId,
  onAdd,
}: {
  aspect: StageAspect;
  selectedVariantId: string;
  onAdd: (candidate: EntitySetPayload["candidates"][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = aspect.variants.filter((v) => v.id !== selectedVariantId);
  if (others.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs self-start border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
      >
        + Взять из другого варианта
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
      {others.map((v) => {
        const payload = v.payload as EntitySetPayload | undefined;
        return (
          <div key={v.id} className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--color-muted-foreground)]">
              {v.label}
            </span>
            {(payload?.candidates ?? []).map((c) => {
              const profile = c.profile as { name?: string };
              return (
                <button
                  key={`${v.id}-${c.tempId}`}
                  type="button"
                  onClick={() => onAdd(c)}
                  className="text-xs self-start border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                >
                  + {candidateLabel(profile).text}
                </button>
              );
            })}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs self-start border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
      >
        Свернуть
      </button>
    </div>
  );
}

export function EntityStageRunner({
  stage,
  revision,
  stageId,
  generator,
  onPatch,
  onMaterialize,
}: Props) {
  const adapter = createEntityAdapter(stageId);

  /** Единственная дверь к рендерерам адаптера: всё, что не прошло схему,
   *  показывается сообщением, а не падает во время рендера. */
  function renderPayload(
    payload: unknown,
    how: "variant" | "final",
  ): React.ReactNode {
    const parsed = adapter.payloadSchema.safeParse(payload);
    if (!parsed.success) return <UnreadablePayload />;
    return how === "variant"
      ? adapter.renderVariant(parsed.data)
      : adapter.renderFinal(parsed.data);
  }

  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>(
    {},
  );
  const [pendingDecisions, setPendingDecisions] = useState<
    Record<string, Record<string, "accept" | "reject">>
  >({});
  const [progressByAspect, setProgressByAspect] = useState<
    Record<string, AspectGenerationProgress>
  >({});
  /** The cast being assembled for one section. Seeded from the picked variant,
   *  but the author can edit a profile or pull someone in from another variant,
   *  so it stops being "the variant" the moment they touch it. */
  const [castByAspect, setCastByAspect] = useState<
    Record<string, EntitySetPayload["candidates"]>
  >({});

  if (stage.aspects.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        На этом этапе пока нет разделов — начните с плана.
      </p>
    );
  }

  function buildAccumulated(
    skip: string,
  ): Array<{ id: string; name: string; finalPayload: unknown }> {
    return stage.aspects
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
      }));
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
      const variants = await generator.generate(
        {
          aspect,
          accumulated: { acceptedAspects: buildAccumulated(aspect.id) },
        },
        (progress) =>
          setProgressByAspect((p) => ({ ...p, [aspect.id]: progress })),
      );
      const next = buildNextStage(
        (a) => ({
          ...a,
          status: "reviewing" as const,
          // Самопочинка legacy-состояния: аспекты entity-стадий, созданные
          // старым плейбуком, лежат с payloadKind "markdown" — PATCH таких
          // отбивался инвариантом variant_payload_kind_mismatch.
          payloadKind: "entity_set" as const,
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

  async function handlePickVariant(
    aspect: StageAspect,
    variantId: string,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const next = buildNextStage(
        (a) => ({ ...a, selectedVariantId: variantId }),
        aspect.id,
      );
      await onPatch(revision, next);
      const variant = aspect.variants.find((v) => v.id === variantId);
      const payload = variant?.payload as EntitySetPayload | undefined;
      if (payload) {
        const init: Record<string, "accept" | "reject"> = {};
        for (const c of payload.candidates) init[c.tempId] = "accept";
        setPendingDecisions((p) => ({ ...p, [aspect.id]: init }));
        setCastByAspect((p) => ({ ...p, [aspect.id]: payload.candidates }));
      }
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  /** Back to the variant list without losing the generated variants. */
  async function handleUnpickVariant(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const next = buildNextStage(
        (a) => ({ ...a, selectedVariantId: undefined }),
        aspect.id,
      );
      await onPatch(revision, next);
      setCastByAspect((p) => {
        const copy = { ...p };
        delete copy[aspect.id];
        return copy;
      });
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  function castFor(aspect: StageAspect): EntitySetPayload["candidates"] {
    const stored = castByAspect[aspect.id];
    if (stored) return stored;
    const variant = aspect.variants.find(
      (v) => v.id === aspect.selectedVariantId,
    );
    return (variant?.payload as EntitySetPayload | undefined)?.candidates ?? [];
  }

  /** Name and description are what the author actually reads later in the
   *  canon; letting them fix a clumsy generated name here beats fixing it in
   *  the entity editor after materialization. */
  function editCandidate(
    aspect: StageAspect,
    tempId: string,
    field: "name" | "description",
    value: string,
  ): void {
    const current = castFor(aspect);
    setCastByAspect((p) => ({
      ...p,
      [aspect.id]: current.map((c) =>
        c.tempId === tempId
          ? {
              ...c,
              profile: {
                ...(c.profile as Record<string, unknown>),
                [field]: value,
              },
            }
          : c,
      ),
    }));
  }

  /** Pulls one person out of a variant the author did not pick. Without this a
   *  variant is all-or-nothing, which is not how casting works. */
  function addFromVariant(
    aspect: StageAspect,
    candidate: EntitySetPayload["candidates"][number],
  ): void {
    const current = castFor(aspect);
    const taken = new Set(current.map((c) => c.tempId));
    let tempId = candidate.tempId;
    while (taken.has(tempId)) tempId = `${tempId}+`;
    setCastByAspect((p) => ({
      ...p,
      [aspect.id]: [...current, { ...candidate, tempId }],
    }));
    setPendingDecisions((p) => ({
      ...p,
      [aspect.id]: { ...(p[aspect.id] ?? {}), [tempId]: "accept" },
    }));
  }

  function toggleCandidate(aspectId: string, tempId: string): void {
    setPendingDecisions((p) => {
      const current = p[aspectId] ?? {};
      const cur = current[tempId] ?? "accept";
      return {
        ...p,
        [aspectId]: {
          ...current,
          [tempId]: cur === "accept" ? "reject" : "accept",
        },
      };
    });
  }

  async function handleMaterialize(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const variant = aspect.variants.find(
        (v) => v.id === aspect.selectedVariantId,
      );
      if (!variant) throw new Error("Вариант не выбран");
      const cast = castFor(aspect);
      const decisions = pendingDecisions[aspect.id] ?? {};
      const candidatesForApi = cast.map((c) => ({
        tempId: c.tempId,
        decision: decisions[c.tempId] ?? ("accept" as const),
        profile: c.profile,
        ...(c.materializedEntityId !== undefined
          ? { materializedEntityId: c.materializedEntityId }
          : {}),
      }));
      const result = await onMaterialize(aspect.id, {
        stageId,
        aspectName: aspect.name,
        candidates: candidatesForApi,
      });
      const tempIdToResult = new Map(
        result.candidates.map((c) => [c.tempId, c]),
      );
      const updatedCandidates = cast.map((c) => {
        const r = tempIdToResult.get(c.tempId);
        if (!r) return c;
        if (r.decision === "reject") {
          return { ...c, status: "rejected" as const };
        }
        return {
          ...c,
          status: "accepted" as const,
          ...(r.materializedEntityId !== undefined
            ? { materializedEntityId: r.materializedEntityId }
            : {}),
          ...(r.mergedIntoId !== undefined
            ? { mergedIntoEntityId: r.mergedIntoId }
            : {}),
        };
      });
      const next = buildNextStage(
        (a) => ({
          ...a,
          status: "accepted" as const,
          finalPayload: { candidates: updatedCandidates },
          variants: a.variants.map((v) =>
            v.id === aspect.selectedVariantId
              ? {
                  ...v,
                  status: "accepted" as const,
                  payload: { candidates: updatedCandidates },
                }
              : v.status === "accepted"
                ? { ...v, status: "rejected" as const }
                : v,
          ),
          emits: {
            kind: stageId === "characters" ? "character" : "item",
            entityIds: result.createdEntityIds,
          },
        }),
        aspect.id,
      );
      await onPatch(revision, next);
      setPendingDecisions((p) => {
        const copy = { ...p };
        delete copy[aspect.id];
        return copy;
      });
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  async function handleSkip(aspect: StageAspect): Promise<void> {
    await setAspectStatus(aspect, "skipped");
  }

  /** A skipped section is not a deleted one — the author can pick it back up. */
  async function handleRestore(aspect: StageAspect): Promise<void> {
    await setAspectStatus(aspect, "pending");
  }

  async function setAspectStatus(
    aspect: StageAspect,
    status: "skipped" | "pending",
  ): Promise<void> {
    const next = buildNextStage((a) => ({ ...a, status }), aspect.id);
    setBusyAspectId(aspect.id);
    try {
      await onPatch(revision, next);
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  return (
    <ul
      aria-label="entity-aspects"
      className="lw-card flex flex-col gap-4"
    >
      {stage.aspects.map((aspect) => {
        const busy = busyAspectId === aspect.id;
        const err = errorByAspect[aspect.id];
        const selectedVariant = aspect.variants.find(
          (v) => v.id === aspect.selectedVariantId,
        );
        const decisions = pendingDecisions[aspect.id] ?? {};
        const progress = progressByAspect[aspect.id];
        return (
          <li key={aspect.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-[15px] text-[var(--color-text-strong)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
              >
                {aspect.name}
              </span>
              <span
                aria-label={`status-${aspect.status}`}
                className="lw-pill"
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
                {ASPECT_STATUS_LABEL[aspect.status] ?? aspect.status}
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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                >
                  {busy ? "Генерируем…" : "Сгенерировать варианты"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip(aspect)}
                  disabled={busy}
                  className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
                >
                  Пропустить
                </button>
              </div>
            )}

            {aspect.status === "reviewing" && !aspect.selectedVariantId && (
              <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
                {aspect.variants.map((v) => (
                  <div key={v.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase text-[var(--color-muted-foreground)]">
                        {v.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePickVariant(aspect, v.id)}
                        disabled={busy}
                        className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)]"
                      >
                        Принять
                      </button>
                    </div>
                    {renderPayload(v.payload, "variant")}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)] self-start"
                >
                  Перегенерировать
                </button>
              </div>
            )}

            {aspect.status === "reviewing" &&
              aspect.selectedVariantId &&
              selectedVariant && (
                <div className="flex flex-col gap-2 border-l-2 border-[var(--color-brass)] pl-3">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Просмотрите кандидатов и решите, какие из них сохранить:
                  </p>
                  <ul className="flex flex-col gap-2">
                    {castFor(aspect).map((c) => {
                      const profile = c.profile as {
                        name?: string;
                        description?: string;
                      };
                      const decision = decisions[c.tempId] ?? "accept";
                      return (
                        <li
                          key={c.tempId}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            aria-label={`accept-${c.tempId}`}
                            checked={decision === "accept"}
                            onChange={() =>
                              toggleCandidate(aspect.id, c.tempId)
                            }
                            className="mt-1"
                          />
                          <div className="flex flex-col gap-1 flex-1">
                            <input
                              value={profile.name ?? ""}
                              onChange={(e) =>
                                editCandidate(
                                  aspect,
                                  c.tempId,
                                  "name",
                                  e.target.value,
                                )
                              }
                              aria-label={`Имя ${candidateLabel(profile).text}`}
                              placeholder="Имя"
                              className="font-medium border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-border)] rounded px-1 py-0.5 bg-transparent"
                            />
                            <textarea
                              value={profile.description ?? ""}
                              onChange={(e) =>
                                editCandidate(
                                  aspect,
                                  c.tempId,
                                  "description",
                                  e.target.value,
                                )
                              }
                              rows={2}
                              aria-label={`Описание ${candidateLabel(profile).text}`}
                              placeholder="Описание"
                              className="text-xs text-[var(--color-muted-foreground)] border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-border)] rounded px-1 py-0.5 bg-transparent"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <OtherVariantPicker
                    aspect={aspect}
                    selectedVariantId={aspect.selectedVariantId}
                    onAdd={(candidate) => addFromVariant(aspect, candidate)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleMaterialize(aspect)}
                      disabled={busy}
                      className="text-sm border border-[var(--color-brass)] bg-[var(--color-brass)] text-[var(--color-bg)] rounded-md px-3 py-1 disabled:bg-[var(--color-surface-2)] disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                    >
                      {busy ? "Добавляем…" : "Добавить в канон книги"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnpickVariant(aspect)}
                      disabled={busy}
                      className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
                    >
                      Назад к вариантам
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSkip(aspect)}
                      disabled={busy}
                      className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
                    >
                      Пропустить
                    </button>
                  </div>
                </div>
              )}

            {aspect.status === "accepted" &&
              aspect.finalPayload !== undefined && (
                <div>{renderPayload(aspect.finalPayload, "final")}</div>
              )}

            {aspect.status === "skipped" && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Пропущено
                </p>
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
              <p
                role="alert"
                className="text-xs rounded-md px-2 py-1 text-[var(--color-ink-red-fg)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
              >
                {err}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
