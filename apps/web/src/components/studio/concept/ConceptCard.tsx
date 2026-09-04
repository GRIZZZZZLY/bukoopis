import { useEffect, useState } from "react";
import {
  AUDIENCE_LABELS,
  PITCH_FIELD_LABELS,
  audienceSchema,
  type Audience,
  type BookConcept,
} from "@book-forge/shared";
import { PremiseFieldPuzzle, type PremiseField } from "./PremiseFieldPuzzle";

interface RefineResponse {
  variants: Array<{ id: string; label: string; payload: string }>;
}

interface Props {
  concept: BookConcept;
  onSave: (next: BookConcept) => Promise<void>;
  onRefine: (field: PremiseField, draft?: string) => Promise<RefineResponse>;
  onUnlock: () => Promise<void>;
  busy: boolean;
}

const PREMISE_ROWS: Array<{ field: PremiseField; textarea: boolean }> = [
  { field: "logline", textarea: true },
  { field: "protagonist", textarea: true },
  { field: "conflict", textarea: true },
  { field: "stakes", textarea: true },
];

/** Утверждённый замысел. Читается как карточка, каждая строка правится по месту
 *  или переформулируется моделью; ничего не нужно заполнять с нуля. */
export function ConceptCard({ concept, onSave, onRefine, onUnlock, busy }: Props) {
  const [draft, setDraft] = useState<BookConcept>(concept);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(concept), [concept]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(concept);

  function setPremise(field: PremiseField, value: string) {
    setDraft({ ...draft, premise: { ...draft.premise, [field]: value } });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return (
    <section className="concept-lines" aria-label="Замысел книги">
      {PREMISE_ROWS.map(({ field, textarea }) => (
        <PremiseFieldPuzzle
          key={field}
          label={PITCH_FIELD_LABELS[field]}
          field={field}
          value={draft.premise[field] ?? ""}
          onChange={(v) => setPremise(field, v)}
          onRefine={onRefine}
          useTextarea={textarea}
        />
      ))}

      <label className="flex flex-col gap-1 text-sm">
        <span>{PITCH_FIELD_LABELS.hook}</span>
        <input
          className="input"
          type="text"
          aria-label={PITCH_FIELD_LABELS.hook}
          value={draft.hook ?? ""}
          onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <label className="flex flex-col gap-1 text-sm">
          <span>{PITCH_FIELD_LABELS.genre}</span>
          <input
            className="input"
            type="text"
            aria-label={PITCH_FIELD_LABELS.genre}
            value={draft.genre ?? ""}
            onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{PITCH_FIELD_LABELS.tone}</span>
          <input
            className="input"
            type="text"
            aria-label={PITCH_FIELD_LABELS.tone}
            value={draft.tone ?? ""}
            onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Для кого</span>
          <select
            className="input"
            aria-label="Для кого"
            value={draft.audience}
            onChange={(e) => {
              const parsed = audienceSchema.safeParse(e.target.value);
              if (parsed.success) setDraft({ ...draft, audience: parsed.data });
            }}
          >
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={disabled || !dirty} onClick={() => void save()}>
          {saving ? "Сохраняем…" : "Сохранить правки"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void onUnlock()}>
          Изменить замысел
        </button>
      </div>
    </section>
  );
}
