import { useState } from "react";
import type { BookConcept, Audience } from "@book-forge/shared";
import { GenrePicker } from "./GenrePicker";
import { TonePicker } from "./TonePicker";
import { AudiencePicker } from "./AudiencePicker";
import { PremiseFieldPuzzle, type PremiseField } from "./PremiseFieldPuzzle";
import { IdeaBraindump } from "./IdeaBraindump";

interface Props {
  initialConcept: BookConcept;
  onSave: (next: BookConcept) => Promise<BookConcept>;
  onRefine: (
    field: PremiseField,
    draft?: string,
  ) => Promise<{
    variants: Array<{ id: string; label: string; payload: string }>;
  }>;
  /** Present when the braindump entry is wired up: free idea → concept draft. */
  bookId?: number;
  onFromIdea?: (idea: string) => Promise<BookConcept>;
}

function isEqualConcept(a: BookConcept, b: BookConcept): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isBlank(value: string | undefined): boolean {
  return (value ?? "").trim().length === 0;
}

/** Fills the author's empty slots and touches nothing they already wrote —
 *  expanding an idea must never overwrite a decision. */
function mergeConcept(current: BookConcept, incoming: BookConcept): BookConcept {
  const untouched =
    current.genres.length === 0 &&
    (current.customGenres ?? []).length === 0 &&
    Object.values(current.premise).every(isBlank);
  const customGenres =
    (current.customGenres ?? []).length > 0
      ? current.customGenres
      : incoming.customGenres;
  const customTones =
    (current.customTones ?? []).length > 0
      ? current.customTones
      : incoming.customTones;
  return {
    ...current,
    genres: current.genres.length > 0 ? current.genres : incoming.genres,
    ...(customGenres !== undefined ? { customGenres } : {}),
    tones: current.tones.length > 0 ? current.tones : incoming.tones,
    ...(customTones !== undefined ? { customTones } : {}),
    // "adult" is also the default, so an explicit choice is only distinguishable
    // on a concept the author has otherwise not touched.
    audience: untouched ? incoming.audience : current.audience,
    premise: {
      protagonist: isBlank(current.premise.protagonist)
        ? incoming.premise.protagonist
        : current.premise.protagonist,
      conflict: isBlank(current.premise.conflict)
        ? incoming.premise.conflict
        : current.premise.conflict,
      stakes: isBlank(current.premise.stakes)
        ? incoming.premise.stakes
        : current.premise.stakes,
      logline: isBlank(current.premise.logline)
        ? incoming.premise.logline
        : current.premise.logline,
    },
  };
}

export function ConceptForm({
  initialConcept,
  onSave,
  onRefine,
  bookId,
  onFromIdea,
}: Props) {
  const [draft, setDraft] = useState<BookConcept>(initialConcept);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !isEqualConcept(draft, initialConcept);

  function patchPremise<K extends keyof BookConcept["premise"]>(
    key: K,
    value: BookConcept["premise"][K],
  ) {
    setDraft((d) => ({ ...d, premise: { ...d.premise, [key]: value } }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const saved = await onSave(draft);
      setDraft(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="concept-heading"
      className="flex flex-col gap-4 border border-[var(--color-border)] rounded-lg p-4"
    >
      <h2 id="concept-heading" className="text-lg font-semibold">
        Концепт
      </h2>

      {onFromIdea && bookId !== undefined && (
        <IdeaBraindump
          bookId={bookId}
          onExpand={onFromIdea}
          onExpanded={(incoming) =>
            setDraft((d) => mergeConcept(d, incoming))
          }
        />
      )}

      <GenrePicker
        selected={draft.genres}
        onChange={(next) => setDraft((d) => ({ ...d, genres: next }))}
      />

      <TonePicker
        selected={draft.tones}
        onChange={(next) => setDraft((d) => ({ ...d, tones: next }))}
      />

      <AudiencePicker
        value={draft.audience}
        onChange={(next: Audience) =>
          setDraft((d) => ({ ...d, audience: next }))
        }
      />

      <fieldset className="flex flex-col gap-3" aria-label="Премиса">
        <legend className="text-sm font-medium">Премиса</legend>

        <PremiseFieldPuzzle
          label="Протагонист"
          field="protagonist"
          value={draft.premise.protagonist ?? ""}
          onChange={(v) => patchPremise("protagonist", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Конфликт"
          field="conflict"
          value={draft.premise.conflict ?? ""}
          onChange={(v) => patchPremise("conflict", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Ставки"
          field="stakes"
          value={draft.premise.stakes ?? ""}
          onChange={(v) => patchPremise("stakes", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Логлайн"
          field="logline"
          value={draft.premise.logline ?? ""}
          onChange={(v) => patchPremise("logline", v)}
          onRefine={onRefine}
          useTextarea
        />

        <p className="text-xs text-[var(--color-muted-foreground)]">
          ✨ Кнопка под каждым полем спрашивает у LLM 2–3 альтернативы. Текущий черновик становится подсказкой.
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={
            "border rounded-md px-4 py-1.5 text-sm " +
            (dirty && !saving
              ? "bg-[var(--color-brass)] text-[var(--color-bg)] border-[var(--color-brass)]"
              : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed")
          }
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}
