import { useState } from "react";
import type { BookConcept, Audience } from "@book-forge/shared";
import { GenrePicker } from "./GenrePicker";
import { TonePicker } from "./TonePicker";
import { AudiencePicker } from "./AudiencePicker";

interface Props {
  initialConcept: BookConcept;
  onSave: (next: BookConcept) => Promise<BookConcept>;
}

function isEqualConcept(a: BookConcept, b: BookConcept): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ConceptForm({ initialConcept, onSave }: Props) {
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

      <fieldset className="flex flex-col gap-2" aria-label="Премиса">
        <legend className="text-sm font-medium">Премиса (черновик)</legend>
        <label className="flex flex-col gap-1 text-sm">
          <span>Протагонист</span>
          <input
            type="text"
            value={draft.premise.protagonist ?? ""}
            onChange={(e) => patchPremise("protagonist", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Конфликт</span>
          <input
            type="text"
            value={draft.premise.conflict ?? ""}
            onChange={(e) => patchPremise("conflict", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Ставки</span>
          <input
            type="text"
            value={draft.premise.stakes ?? ""}
            onChange={(e) => patchPremise("stakes", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Логлайн</span>
          <textarea
            value={draft.premise.logline ?? ""}
            onChange={(e) => patchPremise("logline", e.target.value)}
            rows={2}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Phase B1: ручной ввод. В Phase B2 эти поля заполнит пазл-рефайнер.
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
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed")
          }
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}
