import { useState } from "react";
import {
  GENRES,
  getRootGenres,
  getGenreChildren,
  getGenreById,
  type GenreDefinition,
} from "@book-forge/shared";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

interface IncompatPair {
  a: string;
  b: string;
}

function findIncompatibilities(selected: string[]): IncompatPair[] {
  const seen = new Set<string>();
  const out: IncompatPair[] = [];
  for (const id of selected) {
    const def = getGenreById(id);
    if (!def?.incompatibleWith) continue;
    for (const other of selected) {
      if (other === id) continue;
      if (!def.incompatibleWith.includes(other)) continue;
      const sorted = [id, other].sort();
      const key = sorted.join("␟");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: sorted[0]!, b: sorted[1]! });
    }
  }
  return out;
}

export function GenrePicker({ selected, onChange }: Props) {
  /** Roots with more than this many children get a collapse/expand toggle;
   *  roots with ≤ MAX_INLINE children always show their children inline. */
  const MAX_INLINE = 3;

  const roots = getRootGenres();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand any root that has a selected descendant.
    const init = new Set<string>();
    for (const id of selected) {
      const def = getGenreById(id);
      if (def?.parentId) init.add(def.parentId);
    }
    return init;
  });

  function toggleSelected(id: string) {
    if (selected.includes(id)) onChange(selected.filter((g) => g !== id));
    else onChange([...selected, id]);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const incompat = findIncompatibilities(selected);

  function chip(g: GenreDefinition, isLeafLike: boolean) {
    const isOn = selected.includes(g.id);
    return (
      <button
        key={g.id}
        type="button"
        aria-pressed={isOn}
        onClick={() => toggleSelected(g.id)}
        className={
          "border rounded-md px-3 py-1.5 text-sm " +
          (isOn
            ? "bg-[var(--color-brass)] text-[var(--color-bg)] border-[var(--color-brass)]"
            : "border-[var(--color-border)] hover:bg-[var(--color-muted)]") +
          (isLeafLike ? "" : " font-medium")
        }
      >
        {g.label}
      </button>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3" aria-label="Жанры">
      <legend className="text-sm font-medium">Жанры</legend>

      <div className="flex flex-col gap-2">
        {roots.map((root) => {
          const children = getGenreChildren(root.id);
          const isExpanded = expanded.has(root.id);
          return (
            <div key={root.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {chip(root, false)}
                {children.length > MAX_INLINE && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(root.id)}
                    className="text-xs text-[var(--color-muted-foreground)] underline"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "скрыть подвиды" : "показать подвиды"}
                  </button>
                )}
              </div>
              {(children.length <= MAX_INLINE || isExpanded) && children.length > 0 && (
                <div className="ml-4 flex flex-wrap gap-2">
                  {children.map((c) => chip(c, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {incompat.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="genre-incompatibilities">
          {incompat.map((p) => (
            <li
              key={`${p.a}__${p.b}`}
              className="text-xs rounded px-2 py-1 bg-amber-50 text-amber-800"
            >
              Жанры "{p.a}" и "{p.b}" помечены как несовместимые в реестре.
            </li>
          ))}
        </ul>
      )}

      <div className="text-xs text-[var(--color-muted-foreground)]">
        Выбрано: {selected.length} из {GENRES.length}
      </div>
    </fieldset>
  );
}
