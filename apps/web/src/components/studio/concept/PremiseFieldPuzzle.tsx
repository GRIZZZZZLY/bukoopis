import { useState } from "react";

export type PremiseField = "protagonist" | "conflict" | "stakes" | "logline";

interface Variant {
  id: string;
  label: string;
  payload: string;
}

interface RefineResponse {
  variants: Variant[];
}

interface Props {
  label: string;
  field: PremiseField;
  value: string;
  onChange: (next: string) => void;
  onRefine: (field: PremiseField, draft?: string) => Promise<RefineResponse>;
  /** When true, render a multi-line textarea instead of a single-line input. */
  useTextarea?: boolean;
}

export function PremiseFieldPuzzle({
  label,
  field,
  value,
  onChange,
  onRefine,
  useTextarea = false,
}: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefine() {
    setError(null);
    setBusy(true);
    try {
      const draft = value.trim() || undefined;
      const r = await onRefine(field, draft);
      setVariants(r.variants);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVariants([]);
    } finally {
      setBusy(false);
    }
  }

  function pick(v: Variant) {
    onChange(v.payload);
    setVariants([]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span>{label}</span>
        {useTextarea ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        )}
      </label>

      <div>
        <button
          type="button"
          onClick={handleRefine}
          disabled={busy}
          className={
            "text-xs border rounded-md px-2 py-1 " +
            (busy
              ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed"
              : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
          }
        >
          {busy ? "Думаем…" : "Другие формулировки"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {variants.length > 0 && (
        <ul
          className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3"
          aria-label={`${field}-variants`}
        >
          {variants.map((v) => (
            <li key={v.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {v.label}
                </span>
                <button
                  type="button"
                  onClick={() => pick(v)}
                  className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] transition-colors"
                >
                  Принять
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{v.payload}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
