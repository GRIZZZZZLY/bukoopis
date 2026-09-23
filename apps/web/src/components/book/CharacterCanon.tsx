import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { Character, Relationship } from "@book-forge/shared";
import { AliasEditor } from "@/components/AliasEditor";
import { VoiceSamples } from "@/components/VoiceSamples";

/** Поля карточки, которые автор правит руками. Остальной профиль (цели,
 *  ценности, голос V2, `extra`) едет обратно нетронутым: сервер заменяет
 *  профиль целиком, и потерять то, чего форма не показывает, нельзя. */
const FIELDS = [
  { key: "description", label: "Описание", rows: 4 },
  { key: "voice", label: "Голос", rows: 3 },
  { key: "want", label: "Хочет", rows: 2 },
  { key: "need", label: "Нуждается", rows: 2 },
  { key: "lie", label: "Самообман", rows: 2 },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type Draft = { name: string } & Record<FieldKey, string>;

function draftOf(c: Character): Draft {
  const p = c.profile;
  return {
    name: c.canonicalName,
    description: p.description ?? "",
    voice: p.voice ?? "",
    want: p.want ?? "",
    need: p.need ?? "",
    lie: p.lie ?? "",
  };
}

const EMPTY: Draft = { name: "", description: "", voice: "", want: "", need: "", lie: "" };

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number } | null)?.status;
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as Array<keyof Draft>).every((k) => a[k] === b[k]);
}

export function CharacterCanon({ bookId }: { bookId: number }) {
  const [list, setList] = useState<Character[] | null>(null);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  async function load(keep?: number | "new" | null) {
    try {
      const [chars, r] = await Promise.all([
        api.listCharacters(bookId),
        api.listRelationships(bookId).catch(() => [] as Relationship[]),
      ]);
      setList(chars);
      setRels(r);
      const want = keep !== undefined ? keep : (chars[0]?.id ?? null);
      const pick = typeof want === "number" ? chars.find((c) => c.id === want) : undefined;
      if (want === "new") {
        setSelected("new");
      } else if (pick) {
        setSelected(pick.id);
        setDraft(draftOf(pick));
      } else {
        const first = chars[0];
        setSelected(first?.id ?? null);
        setDraft(first ? draftOf(first) : EMPTY);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const current = typeof selected === "number" ? list?.find((c) => c.id === selected) : undefined;
  const base = current ? draftOf(current) : EMPTY;
  const dirty = selected === "new" ? !sameDraft(draft, EMPTY) : !sameDraft(draft, base);
  const nameById = useMemo(() => new Map((list ?? []).map((c) => [c.id, c.canonicalName])), [list]);

  function choose(next: number | "new") {
    if (next === selected) return;
    if (dirty && !window.confirm("В карточке есть несохранённые правки. Бросить их?")) return;
    setError(null);
    setConflict(false);
    setNote(null);
    setVoiceOpen(false);
    setSelected(next);
    const c = typeof next === "number" ? list?.find((x) => x.id === next) : undefined;
    setDraft(c ? draftOf(c) : EMPTY);
  }

  async function save() {
    if (!draft.name.trim() || !draft.description.trim()) {
      setError("Нужны имя и описание.");
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const text = (v: string) => (v.trim() ? v.trim() : null);
      if (selected === "new") {
        const profile = {
          description: draft.description.trim(),
          voice: text(draft.voice),
          want: text(draft.want),
          need: text(draft.need),
          lie: text(draft.lie),
        };
        let created: Character;
        try {
          created = await api.createCharacter(bookId, { canonicalName: draft.name.trim(), profile });
        } catch (err) {
          // 409: тёзка. Два героя с одним именем ломают привязку фактов к
          // обоим, поэтому сервер спрашивает, а не решает сам (С2).
          if (statusOf(err) !== 409) throw err;
          if (
            !window.confirm(
              "В книге уже есть персонаж с таким именем. Два персонажа с одним именем — и факты перестанут приставать к обоим. Всё равно завести?",
            )
          )
            return;
          created = await api.createCharacter(bookId, {
            canonicalName: draft.name.trim(),
            profile,
            allowDuplicateName: true,
          });
        }
        await load(created.id);
        return;
      }
      if (!current) return;
      const saved = await api.updateCharacter(current.id, {
        expectedRevision: current.revision,
        canonicalName: draft.name.trim(),
        profile: {
          ...current.profile,
          description: draft.description.trim(),
          voice: text(draft.voice),
          want: text(draft.want),
          need: text(draft.need),
          lie: text(draft.lie),
        },
      });
      setList((prev) => (prev ?? []).map((c) => (c.id === saved.id ? saved : c)));
      setDraft(draftOf(saved));
    } catch (e) {
      if (statusOf(e) === 409) {
        setConflict(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden() {
    if (!current) return;
    try {
      const next = await api.setCharacterPromptVisibility(current.id, !current.hiddenFromPrompts);
      setList((prev) => (prev ?? []).map((c) => (c.id === next.id ? next : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!current) return;
    if (!window.confirm(`Удалить «${current.canonicalName}» вместе со связями и знаниями?`)) return;
    try {
      const lost = await api.deleteCharacter(current.id);
      const parts = [
        lost.deletedEvents > 0 ? `записей о знаниях: ${lost.deletedEvents}` : null,
        lost.deletedVoiceSamples > 0 ? `образцов речи: ${lost.deletedVoiceSamples}` : null,
        lost.deletedRelationships > 0 ? `связей: ${lost.deletedRelationships}` : null,
      ].filter(Boolean);
      // Что ушло по цепочке — вслух: удаление уносит больше, чем видно (С10).
      setNote(parts.length > 0 ? `Удалено вместе с персонажем — ${parts.join(", ")}.` : null);
      await load(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (list === null) {
    return error ? <p role="alert" className="alert-error">Ошибка: {error}</p> : <p className="muted">Загрузка…</p>;
  }

  const shown = list.filter((c) => c.canonicalName.toLowerCase().includes(query.trim().toLowerCase()));
  const myRels = current
    ? rels.filter((r) => r.fromCharacterId === current.id || r.toCharacterId === current.id)
    : [];

  return (
    <div className="canon-split">
      <div className="canon-list">
        <input
          className="input"
          placeholder="Найти персонажа"
          aria-label="Найти персонажа"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul aria-label="Персонажи">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`canon-item ${c.id === selected ? "canon-item-on" : ""} ${c.hiddenFromPrompts ? "canon-item-hidden" : ""}`}
                aria-current={c.id === selected ? "true" : undefined}
                onClick={() => choose(c.id)}
              >
                <span className="canon-item-name">{c.canonicalName}</span>
                <span className="canon-item-sub">
                  {c.hiddenFromPrompts ? "скрыт от модели · " : ""}
                  {c.profile.role || c.profile.description || "без описания"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="canon-add" onClick={() => choose("new")}>
          + Новый персонаж
        </button>
      </div>

      {selected === null ? (
        <div className="canon-card canon-card-empty">
          <p className="muted">
            Персонажей пока нет. Добавьте первого вручную или примите предложения модели в
            Мастерской.
          </p>
        </div>
      ) : (
        <div className="canon-card">
          <div className="canon-card-head">
            <div>
              <h3>{selected === "new" ? "Новый персонаж" : current?.canonicalName}</h3>
              {current && (
                <span className="muted">
                  {current.hiddenFromPrompts ? "скрыт от модели" : "в каноне"}
                </span>
              )}
            </div>
            {current && (
              <label className="switch">
                <span>Скрыть от модели</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={current.hiddenFromPrompts}
                  onChange={() => void toggleHidden()}
                />
              </label>
            )}
          </div>

          <div className="canon-card-body">
            <div className="canon-col">
              <label className="field">
                <span className="field-label">Имя</span>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              {FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span className="field-label">{f.label}</span>
                  <textarea
                    className="textarea textarea-prose"
                    rows={f.rows}
                    value={draft[f.key]}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            {current && (
              <div className="canon-col">
                <div className="field">
                  <span className="field-label">Псевдонимы</span>
                  <AliasEditor bookId={bookId} characterId={current.id} />
                </div>
                <div className="field">
                  <span className="field-label">Отношения</span>
                  {myRels.length === 0 ? (
                    <p className="faint">Связей нет. Их задают во вкладке «Связи».</p>
                  ) : (
                    <ul className="rel-list">
                      {myRels.map((r) => {
                        const other = r.fromCharacterId === current.id ? r.toCharacterId : r.fromCharacterId;
                        return (
                          <li key={r.id}>
                            <span className="strong">{nameById.get(other) ?? "—"}</span>
                            <span className="muted"> · {r.type}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="field">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-expanded={voiceOpen}
                    onClick={() => setVoiceOpen((v) => !v)}
                  >
                    Образцы речи {voiceOpen ? "▾" : "▸"}
                  </button>
                  {voiceOpen && <VoiceSamples characterId={current.id} characters={list} />}
                </div>
              </div>
            )}
          </div>

          <div className="canon-card-foot">
            <div>
              {current && (
                <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void remove()}>
                  Удалить
                </button>
              )}
              {note && <span className="faint">{note}</span>}
            </div>
            <div className="canon-card-actions">
              {conflict && (
                <span role="alert" className="text-warn">
                  Карточку изменили в другом месте.{" "}
                  <button type="button" className="btn-link" onClick={() => void load(current?.id)}>
                    Загрузить заново
                  </button>
                </span>
              )}
              {error && <span role="alert" className="text-err">{error}</span>}
              {dirty && !conflict && <span className="faint">есть несохранённые правки</span>}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!dirty || busy}
                onClick={() => setDraft(selected === "new" ? EMPTY : base)}
              >
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
