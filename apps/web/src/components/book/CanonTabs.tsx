/** Вкладки Канона «Крючки» и «Связи». Персонажи, предметы и места — в
 *  CharacterCanon и ThingCanon. */
import { useEffect, useState, type FormEvent } from "react";
import { Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelationshipQualities } from "@/components/RelationshipQualities";
import { api } from "@/api/client";
import type {
  Character,
  Hook,
  Relationship,
} from "@book-forge/shared";

/** Удаление в каноне было залитой красной кнопкой «×» на каждой карточке —
 *  самый заметный элемент страницы и без доступного имени («×» скринридеру
 *  ничего не говорит). Теперь ghost с красным hover и подписью. */
function DeleteButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="size-8 shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-ink-red-fg)] hover:bg-[var(--color-ink-red-tint)]"
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </Button>
  );
}

// ─────────── Hooks ───────────

export function HooksTab({ bookId }: { bookId: number }) {
  const [list, setList] = useState<Hook[] | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setList(await api.listHooks(bookId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { load(); }, [bookId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    try {
      await api.createHook(bookId, { description: description.trim() });
      setDescription("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function onStatus(id: number, status: Hook["status"]) {
    try { await api.updateHook(id, { status }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <p className="text-sm text-red-600">Ошибка: {error}</p>;
  if (list === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex gap-2">
        <input className="input input-sm flex-1" placeholder="Описание сюжетного крючка" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit" disabled={!description.trim()}>+</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Нет крючков.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((h) => (
            <li key={h.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <div>{h.description}</div>
                </div>
                <select
                  value={h.status}
                  onChange={(e) => onStatus(h.id, e.target.value as Hook["status"])}
                  className="select input-sm"
                  aria-label="Состояние крючка"
                >
                  <option value="open">открыт</option>
                  <option value="mentioned">упомянут</option>
                  <option value="resolved">закрыт</option>
                  <option value="deferred">отложен</option>
                </select>
                <DeleteButton
                  label="Удалить крючок"
                  onClick={async () => { await api.deleteHook(h.id); await load(); }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── Relationships ───────────

export function RelationshipsTab({ bookId }: { bookId: number }) {
  const [chars, setChars] = useState<Character[]>([]);
  const [list, setList] = useState<Relationship[] | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [type, setType] = useState("");
  const [tension, setTension] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [expandedRelId, setExpandedRelId] = useState<number | null>(null);

  async function load() {
    try {
      const [c, r] = await Promise.all([
        api.listCharacters(bookId),
        api.listRelationships(bookId),
      ]);
      setChars(c);
      setList(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { load(); }, [bookId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (from === null || to === null || !type.trim()) return;
    try {
      await api.createRelationship(bookId, {
        fromCharacterId: from,
        toCharacterId: to,
        type: type.trim(),
        tension: Number(tension),
      });
      setType(""); setTension("0");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const nameById = new Map(chars.map((c) => [c.id, c.canonicalName]));

  if (error) return <p className="text-sm text-red-600">Ошибка: {error}</p>;
  if (list === null) return <p className="text-sm">Загрузка…</p>;

  if (chars.length < 2) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">Нужно как минимум 2 персонажа.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex gap-2 flex-wrap items-center">
        <select value={from ?? ""} onChange={(e) => setFrom(Number(e.target.value))} className="select input-sm">
          <option value="">от кого</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.canonicalName}</option>)}
        </select>
        <select value={to ?? ""} onChange={(e) => setTo(Number(e.target.value))} className="select input-sm">
          <option value="">к кому</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.canonicalName}</option>)}
        </select>
        <input className="input input-sm flex-1 min-w-[150px]" placeholder="Тип (наставник, враг…)" value={type} onChange={(e) => setType(e.target.value)} />
        <input type="number" step="0.1" min="-1" max="1" className="input input-sm w-20" value={tension} onChange={(e) => setTension(e.target.value)} title="напряжение -1..1" />
        <Button type="submit" disabled={from === null || to === null || !type.trim()}>+</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Нет связей.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm">
              <div className="flex justify-between items-center">
                <div>
                  <strong>{nameById.get(r.fromCharacterId) ?? `#${r.fromCharacterId}`}</strong>
                  {" → "}
                  <strong>{nameById.get(r.toCharacterId) ?? `#${r.toCharacterId}`}</strong>
                  : {r.type} (напряжение {r.tension.toFixed(2)})
                </div>
                <DeleteButton
                  label="Удалить связь"
                  onClick={async () => { await api.deleteRelationship(r.id); await load(); }}
                />
              </div>
              <button
                type="button"
                onClick={() => setExpandedRelId(expandedRelId === r.id ? null : r.id)}
                className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-text)] mt-2 flex items-center gap-1"
              >
                <ChevronDown
                  className="size-3"
                  style={{
                    transform: expandedRelId === r.id ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 0.2s",
                  }}
                />
                Редактировать
              </button>
              {expandedRelId === r.id && (
                <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <RelationshipQualities relationship={r} onSaved={load} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
