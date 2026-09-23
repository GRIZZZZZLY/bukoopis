import { useEffect, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { api } from "@/api/client";
import type { EntityAlias } from "@book-forge/shared";

interface Props {
  bookId: number;
  characterId: number;
}

/** Другие имена героя: прозвища, титулы, варианты. По ним резолвер сводит
 *  «Ваше Сиятельство» и «Алексей» к одному id — иначе события и факты,
 *  извлечённые под вторым именем, отвергаются как «героя нет в составе». */
export function AliasEditor({ bookId, characterId }: Props) {
  const [list, setList] = useState<EntityAlias[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dropped = false;
    setList(null);
    api
      .listCharacterAliases(bookId, characterId)
      .then((l) => {
        if (!dropped) setList(l);
      })
      .catch((e) => {
        if (!dropped) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dropped = true;
    };
  }, [bookId, characterId]);

  async function add(): Promise<void> {
    const alias = value.trim();
    if (!alias || busy) return;
    setBusy(true);
    setError(null);
    try {
      setList(await api.addCharacterAlias(bookId, characterId, alias));
      setValue("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /already maps/.test(msg)
          ? "Это имя уже закреплено за другим героем."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(alias: EntityAlias): Promise<void> {
    setError(null);
    try {
      await api.deleteAlias(bookId, alias.id);
      setList(await api.listCharacterAliases(bookId, characterId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="text-xs text-[var(--color-muted-foreground)]">Другие имена</div>
      <div className="flex flex-wrap gap-1 items-center">
        {(list ?? []).map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs"
          >
            {a.alias}
            <button
              type="button"
              aria-label={`Убрать имя «${a.alias}»`}
              onClick={() => void remove(a)}
              className="opacity-60 hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          className="input input-sm min-w-[12rem]"
          placeholder="Прозвище, титул, вариант имени — Enter"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={busy || list === null}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
