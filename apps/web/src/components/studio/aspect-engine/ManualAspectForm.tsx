import { useState } from "react";
import type { PayloadKind, StageAspect, StageState } from "@book-forge/shared";

interface Props {
  stage: StageState;
  revision: number;
  payloadKind: PayloadKind;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

/** The plan the model proposes is a suggestion, not the shape of the book. An
 *  author who already knows they need a section on, say, guild law should be
 *  able to add it — `source: "user"` has always been in the schema, only the
 *  UI never offered it. */
export function ManualAspectForm({
  stage,
  revision,
  payloadKind,
  onPatch,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const duplicate = stage.aspects.some(
    (a) => a.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  async function handleAdd(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const aspect: StageAspect = {
        id: crypto.randomUUID(),
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        status: "pending",
        order: stage.aspects.length,
        required: false,
        source: "user",
        payloadKind,
        variants: [],
      };
      await onPatch(revision, {
        ...stage,
        status: stage.status === "not_started" ? "in_progress" : stage.status,
        aspects: [...stage.aspects, aspect],
        updatedAt: new Date().toISOString(),
      });
      setName("");
      setDescription("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs self-start border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
      >
        + Свой раздел
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
      <label className="text-xs flex flex-col gap-1">
        Название раздела
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Название своего раздела"
          placeholder="Например: устав гильдии картографов"
          className="border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
        />
      </label>
      <label className="text-xs flex flex-col gap-1">
        О чём он (необязательно)
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Описание своего раздела"
          className="border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
        />
      </label>
      {duplicate && trimmed.length > 0 && (
        <p className="text-xs text-[var(--color-ink-amber-fg)]">
          Раздел с таким названием уже есть.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || trimmed.length === 0 || duplicate}
          className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Добавляем…" : "Добавить"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
