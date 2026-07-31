import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { VariantGenerator } from "./types.js";
import { candidateLabel, createEntityAdapter } from "./entityAdapter.js";

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

export function EntityStageRunner({
  stage,
  revision,
  stageId,
  generator,
  onPatch,
  onMaterialize,
}: Props) {
  const adapter = createEntityAdapter(stageId);
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>(
    {},
  );
  const [pendingDecisions, setPendingDecisions] = useState<
    Record<string, Record<string, "accept" | "reject">>
  >({});

  if (stage.aspects.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        В стадии нет аспектов. Запустите генерацию плейбука.
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

  async function handleGenerate(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const variants = await generator.generate({
        aspect,
        accumulated: { acceptedAspects: buildAccumulated(aspect.id) },
      });
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
      const payload = variant.payload as EntitySetPayload;
      const decisions = pendingDecisions[aspect.id] ?? {};
      const candidatesForApi = payload.candidates.map((c) => ({
        tempId: c.tempId,
        decision: decisions[c.tempId] ?? ("accept" as const),
        profile: c.profile,
      }));
      const result = await onMaterialize(aspect.id, {
        stageId,
        aspectName: aspect.name,
        candidates: candidatesForApi,
      });
      const tempIdToResult = new Map(
        result.candidates.map((c) => [c.tempId, c]),
      );
      const updatedCandidates = payload.candidates.map((c) => {
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
    const next = buildNextStage(
      (a) => ({ ...a, status: "skipped" as const }),
      aspect.id,
    );
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
                    {adapter.renderVariant(v.payload as EntitySetPayload)}
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
                  <ul className="flex flex-col gap-1">
                    {(selectedVariant.payload as EntitySetPayload).candidates.map(
                      (c) => {
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
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {candidateLabel(profile).text}
                              </span>
                              {profile.description && (
                                <span className="text-xs text-[var(--color-muted-foreground)]">
                                  {profile.description}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleMaterialize(aspect)}
                      disabled={busy}
                      className="text-sm border border-[var(--color-brass)] bg-[var(--color-brass)] text-[var(--color-bg)] rounded-md px-3 py-1 disabled:bg-[var(--color-surface-2)] disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
                    >
                      {busy ? "Материализуем…" : "Материализовать"}
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
                <div>{adapter.renderFinal(aspect.finalPayload as EntitySetPayload)}</div>
              )}

            {aspect.status === "skipped" && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Пропущено
              </p>
            )}

            {err && (
              <p role="alert" className="text-xs text-[var(--color-ink-red)]">
                {err}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
