import { useEffect, useState } from "react";
import type { BookConcept } from "@book-forge/shared";

interface Props {
  bookId: number;
  /** Lives on the concept, so it is saved with everything else and survives a
   *  move to another machine. */
  value: string;
  onChange: (idea: string) => void;
  onExpand: (idea: string) => Promise<BookConcept>;
  onExpanded: (concept: BookConcept) => void;
}

const MIN_LENGTH = 10;

function storageKey(bookId: number): string {
  return `bf-idea-${bookId}`;
}

/** The entry point authors actually start from: one line of "what if", in their
 *  own words, before any genre or antagonist exists. */
export function IdeaBraindump({
  bookId,
  value,
  onChange,
  onExpand,
  onExpanded,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idea = value;

  // Ideas typed before the field moved onto the concept still sit in
  // localStorage; adopt them once, then stop reading that key.
  useEffect(() => {
    if (value.trim().length > 0) return;
    try {
      const stranded = localStorage.getItem(storageKey(bookId));
      if (stranded && stranded.trim().length > 0) {
        onChange(stranded);
        localStorage.removeItem(storageKey(bookId));
      }
    } catch {
      /* private mode / storage disabled — nothing to recover */
    }
    // Recovery is a one-shot per book; re-running on every keystroke would
    // fight the author's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  function handleChange(next: string) {
    onChange(next);
  }

  async function handleExpand() {
    setError(null);
    setBusy(true);
    try {
      onExpanded(await onExpand(idea.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tooShort = idea.trim().length < MIN_LENGTH;

  return (
    <fieldset className="flex flex-col gap-2" aria-label="Идея книги">
      <legend className="text-sm font-medium">Идея</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Напиши своими словами, о чём книга — одной фразой или сбивчиво, как
        думается. Остальное ниже можно вывести из этого.
      </p>
      <textarea
        aria-label="Свободное описание идеи"
        value={idea}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        placeholder="Например: девочка находит в подвале карту города, которого нет ни на одной другой карте — и он начинает её узнавать."
        className="w-full border border-[var(--color-border)] rounded-md px-3 py-2 text-sm bg-transparent"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleExpand}
          disabled={tooShort || busy}
          className={
            "border rounded-md px-3 py-1.5 text-sm " +
            (!tooShort && !busy
              ? "bg-[var(--color-brass)] text-[var(--color-bg)] border-[var(--color-brass)]"
              : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed")
          }
        >
          {busy ? "Раскладываем…" : "✨ Разложить в концепт"}
        </button>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {tooShort
            ? "Хотя бы пара слов о замысле"
            : "Заполнит только пустые поля ниже"}
        </span>
      </div>
    </fieldset>
  );
}
