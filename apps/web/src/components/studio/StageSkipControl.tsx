import { useState } from "react";
import type { StageId, StageState } from "@book-forge/shared";
import { isOptionalStage } from "@book-forge/shared";

interface Props {
  stageId: StageId;
  stage: StageState;
  revision: number;
  onPatch: (
    expectedRevision: number,
    nextStage: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

const SKIP_REASON = "Пропущен автором";

/** Walking past a stage is a first-class move, not a workaround: roughly half of
 *  authors discover the book by writing it. Without this the flow reads as seven
 *  mandatory gates before the first sentence. */
export function StageSkipControl({ stageId, stage, revision, onPatch }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipped = stage.status === "skipped";

  async function apply(next: StageState) {
    setError(null);
    setBusy(true);
    try {
      await onPatch(revision, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    void apply({ ...stage, status: "skipped", skippedReason: SKIP_REASON });
  }

  function handleResume() {
    // The server re-derives the real status from the aspects underneath.
    const { skippedReason: _dropped, ...rest } = stage;
    void apply({ ...rest, status: "not_started" });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {skipped ? (
        <button
          type="button"
          onClick={handleResume}
          disabled={busy}
          className="btn btn-ghost btn-sm"
        >
          {busy ? "…" : "Вернуть этап"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy}
          className="btn btn-ghost btn-sm"
          title={
            isOptionalStage(stageId)
              ? "Этот этап не обязателен — можно вернуться к нему позже"
              : "Можно вернуться к этапу позже"
          }
        >
          {busy
            ? "…"
            : isOptionalStage(stageId)
              ? "Этап не нужен"
              : "Пропустить этап"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Badge for the stage header: says whether the book needs this stage at all. */
export function StageOptionalBadge({ stageId }: { stageId: StageId }) {
  if (!isOptionalStage(stageId)) return null;
  return (
    <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>
      необязательный
    </span>
  );
}
