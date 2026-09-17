import { useState } from "react";
import {
  RELATIONSHIP_QUALITY_LABELS,
  type DirectedRelationship,
  type Relationship,
} from "@book-forge/shared";
import { api } from "@/api/client";

interface Props {
  relationship: Relationship;
  onSaved: () => void | Promise<void>;
}

/** Качества одного направления A → B (ТЗ индивидуальности, раздел 5.3).
 *  Направление B → A — другая строка и другой экземпляр этого компонента:
 *  правка одного не трогает другое (INV-03). */
export function RelationshipQualities({ relationship, onSaved }: Props) {
  const [draft, setDraft] = useState<DirectedRelationship>(relationship.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: string) {
    setDraft((p) => ({ ...p, [key]: value.trim() ? value : null }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateRelationship(relationship.id, {
        expectedRevision: relationship.revision,
        profile: draft,
      });
      await onSaved();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Внутренний код в русском экране не показывается.
      setError(
        raw.includes("revision_conflict")
          ? "Связь изменилась в другом месте. Обновите страницу и повторите."
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    save().catch(() => {
      // Error is handled in save() via try-catch
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {Object.entries(RELATIONSHIP_QUALITY_LABELS).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <span className="w-32 text-[var(--color-muted-foreground)]">
              {label}
            </span>
            <input
              aria-label={label}
              value={(draft as Record<string, unknown>)[key] as string ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              placeholder="неизвестно"
              className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs">
          <span className="w-32 text-[var(--color-muted-foreground)]">
            разногласия
          </span>
          <input
            aria-label="разногласия"
            value={draft.disputes.join(", ")}
            onChange={(e) =>
              setDraft((p) => ({
                ...p,
                disputes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="через запятую"
            className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-32 text-[var(--color-muted-foreground)]">
            умолчания
          </span>
          <input
            aria-label="умолчания"
            value={draft.silences.join(", ")}
            onChange={(e) =>
              setDraft((p) => ({
                ...p,
                silences: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="через запятую"
            className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="self-start text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)]"
      >
        Сохранить
      </button>
    </div>
  );
}
