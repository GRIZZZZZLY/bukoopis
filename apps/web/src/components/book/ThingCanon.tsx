import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Item, Location } from "@book-forge/shared";

/** Предметы и места в Каноне: тот же вид, что у персонажей — список слева,
 *  карточка правки справа. Сервер сливает правку с прежним профилем, так
 *  что поля, которых форма не показывает (type, properties от
 *  материализации), не теряются. */
type Kind = "item" | "place";

interface Thing {
  id: number;
  name: string;
  profile: Record<string, unknown>;
}

const FIELDS: Record<Kind, Array<{ key: string; label: string; rows: number }>> = {
  item: [
    { key: "description", label: "Описание", rows: 4 },
    { key: "origin", label: "Происхождение", rows: 2 },
    { key: "significance", label: "Значение для сюжета", rows: 2 },
    { key: "notes", label: "Заметки", rows: 2 },
  ],
  place: [
    { key: "description", label: "Описание", rows: 4 },
    { key: "history", label: "История", rows: 2 },
    { key: "atmosphere", label: "Атмосфера", rows: 2 },
    { key: "notes", label: "Заметки", rows: 2 },
  ],
};

const WORDS: Record<Kind, { one: string; add: string; find: string; empty: string; del: string }> = {
  item: {
    one: "Новый предмет",
    add: "+ Новый предмет",
    find: "Найти предмет",
    empty: "Предметов пока нет. Добавьте вручную или примите предложения модели в Мастерской.",
    del: "Удалить предмет",
  },
  place: {
    one: "Новое место",
    add: "+ Новое место",
    find: "Найти место",
    empty: "Мест пока нет. Добавьте вручную или примите предложения модели в Мастерской.",
    del: "Удалить место",
  },
};

type Draft = Record<string, string>;

function draftOf(kind: Kind, t: Thing | null): Draft {
  const d: Draft = { name: t?.name ?? "" };
  for (const f of FIELDS[kind]) {
    const v = t?.profile[f.key];
    d[f.key] = typeof v === "string" ? v : "";
  }
  return d;
}

function same(a: Draft, b: Draft): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

const listOf = (kind: Kind, bookId: number): Promise<Thing[]> =>
  (kind === "item" ? api.listItems(bookId) : api.listLocations(bookId)) as Promise<Array<Item | Location>> as Promise<Thing[]>;

export function ThingCanon({ bookId, kind }: { bookId: number; kind: Kind }) {
  const [list, setList] = useState<Thing[] | null>(null);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(kind, null));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = WORDS[kind];

  async function load(keep?: number | null) {
    try {
      const all = await listOf(kind, bookId);
      setList(all);
      const pick = all.find((x) => x.id === keep) ?? all[0] ?? null;
      setSelected(pick?.id ?? null);
      setDraft(draftOf(kind, pick));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, kind]);

  const current = typeof selected === "number" ? (list?.find((x) => x.id === selected) ?? null) : null;
  const base = draftOf(kind, selected === "new" ? null : current);
  const dirty = !same(draft, base);

  function choose(next: number | "new") {
    if (next === selected) return;
    if (dirty && !window.confirm("В карточке есть несохранённые правки. Бросить их?")) return;
    setError(null);
    setSelected(next);
    setDraft(draftOf(kind, typeof next === "number" ? (list?.find((x) => x.id === next) ?? null) : null));
  }

  async function save() {
    if (!draft.name?.trim() || !draft.description?.trim()) {
      setError("Нужны название и описание.");
      return;
    }
    setBusy(true);
    setError(null);
    const profile: Record<string, string | null> = {};
    for (const f of FIELDS[kind]) {
      const v = (draft[f.key] ?? "").trim();
      profile[f.key] = f.key === "description" ? v : v || null;
    }
    const name = draft.name.trim();
    try {
      let savedId: number;
      if (selected === "new") {
        const body = { name, profile: profile as { description: string } };
        const created = kind === "item" ? await api.createItem(bookId, body) : await api.createLocation(bookId, body);
        savedId = created.id;
      } else {
        if (!current) return;
        const body = { name, profile: profile as { description: string } };
        if (kind === "item") await api.updateItem(current.id, body);
        else await api.updateLocation(current.id, body);
        savedId = current.id;
      }
      await load(savedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    if (!window.confirm(`Удалить «${current.name}»?`)) return;
    try {
      if (kind === "item") await api.deleteItem(current.id);
      else await api.deleteLocation(current.id);
      await load(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (list === null) {
    return error ? <p role="alert" className="alert-error">Ошибка: {error}</p> : <p className="muted">Загрузка…</p>;
  }
  const shown = list.filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="canon-split">
      <div className="canon-list">
        <input
          className="input"
          placeholder={words.find}
          aria-label={words.find}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul aria-label={kind === "item" ? "Предметы" : "Места"}>
          {shown.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className={`canon-item ${x.id === selected ? "canon-item-on" : ""}`}
                aria-current={x.id === selected ? "true" : undefined}
                onClick={() => choose(x.id)}
              >
                <span className="canon-item-name">{x.name}</span>
                <span className="canon-item-sub">
                  {typeof x.profile.description === "string" && x.profile.description
                    ? x.profile.description
                    : "без описания"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="canon-add" onClick={() => choose("new")}>
          {words.add}
        </button>
      </div>

      {selected === null ? (
        <div className="canon-card canon-card-empty">
          <p className="muted">{words.empty}</p>
        </div>
      ) : (
        <div className="canon-card">
          <div className="canon-card-head">
            <div>
              <h3>{selected === "new" ? words.one : current?.name}</h3>
              {current && <span className="muted">в каноне</span>}
            </div>
          </div>
          <div className="canon-card-body canon-card-body-one">
            <div className="canon-col">
              <label className="field">
                <span className="field-label">Название</span>
                <input
                  className="input"
                  value={draft.name ?? ""}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              {FIELDS[kind].map((f) => (
                <label key={f.key} className="field">
                  <span className="field-label">{f.label}</span>
                  <textarea
                    className="textarea textarea-prose"
                    rows={f.rows}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="canon-card-foot">
            <div>
              {current && (
                <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void remove()}>
                  {words.del}
                </button>
              )}
            </div>
            <div className="canon-card-actions">
              {error && <span role="alert" className="text-err">{error}</span>}
              {dirty && <span className="faint">есть несохранённые правки</span>}
              <button type="button" className="btn btn-ghost" disabled={!dirty || busy} onClick={() => setDraft(base)}>
                Отменить
              </button>
              <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
                {busy ? "Сохраняю…" : selected === "new" ? "Создать" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
