import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type {
  Character,
  CharacterProfile,
  Hook,
  Item,
  Location,
  LocationProfile,
  ItemProfile,
  Relationship,
} from "@book-forge/shared";

interface Props {
  bookId: number;
}

type Tab = "characters" | "locations" | "items" | "hooks" | "relationships";

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

export function KnowledgePanel({ bookId }: Props) {
  const [tab, setTab] = useState<Tab>("characters");
  return (
    <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
      <h2 className="text-xl font-semibold">Канон</h2>
      <div className="flex gap-1 flex-wrap">
        {(["characters", "locations", "items", "hooks", "relationships"] as Tab[]).map(
          (t) => (
            <Button
              key={t}
              variant={tab === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t)}
            >
              {labelFor(t)}
            </Button>
          ),
        )}
      </div>
      {tab === "characters" && <CharactersTab bookId={bookId} />}
      {tab === "locations" && <LocationsTab bookId={bookId} />}
      {tab === "items" && <ItemsTab bookId={bookId} />}
      {tab === "hooks" && <HooksTab bookId={bookId} />}
      {tab === "relationships" && <RelationshipsTab bookId={bookId} />}
    </section>
  );
}

function labelFor(t: Tab): string {
  switch (t) {
    case "characters": return "Персонажи";
    case "locations": return "Локации";
    case "items": return "Артефакты";
    case "hooks": return "Крючки";
    case "relationships": return "Отношения";
  }
}

// ─────────── Characters ───────────

function CharactersTab({ bookId }: { bookId: number }) {
  const [list, setList] = useState<Character[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [want, setWant] = useState("");
  const [need, setNeed] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setList(await api.listCharacters(bookId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { load(); }, [bookId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    setCreating(true);
    try {
      const profile: CharacterProfile = {
        description: description.trim(),
        want: want.trim() || null,
        need: need.trim() || null,
      };
      await api.createCharacter(bookId, {
        canonicalName: name.trim(),
        profile,
      });
      setName(""); setDescription(""); setWant(""); setNeed("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Удалить персонажа? (вместе со связями и знаниями)")) return;
    try { await api.deleteCharacter(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <p className="text-sm text-red-600">Ошибка: {error}</p>;
  if (list === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex flex-col gap-2 border border-[var(--color-border)] rounded-md p-3">
        <input className="border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex gap-2">
          <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Хочет (want)" value={want} onChange={(e) => setWant(e.target.value)} />
          <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Нуждается (need)" value={need} onChange={(e) => setNeed(e.target.value)} />
        </div>
        <Button type="submit" disabled={creating || !name.trim() || !description.trim()} className="self-start">+ Добавить персонажа</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Персонажей нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => (
            <li key={c.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm">
              <div className="flex justify-between items-center">
                <strong>{c.canonicalName}</strong>
                <DeleteButton
                  label={`Удалить персонажа «${c.canonicalName}»`}
                  onClick={() => onDelete(c.id)}
                />
              </div>
              <div className="text-[var(--color-muted-foreground)]">{c.profile.description}</div>
              {c.profile.want && <div>Хочет: {c.profile.want}</div>}
              {c.profile.need && <div>Нуждается: {c.profile.need}</div>}
              {c.profile.lie && <div>Самообман: {c.profile.lie}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── Locations ───────────

function LocationsTab({ bookId }: { bookId: number }) {
  const [list, setList] = useState<Location[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setList(await api.listLocations(bookId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { load(); }, [bookId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    try {
      const profile: LocationProfile = { description: description.trim() };
      await api.createLocation(bookId, { name: name.trim(), profile });
      setName(""); setDescription("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <p className="text-sm text-red-600">Ошибка: {error}</p>;
  if (list === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex gap-2">
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Название локации" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || !description.trim()}>+</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Нет локаций.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((l) => (
            <li key={l.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm">
              <div className="flex justify-between">
                <strong>{l.name}</strong>
                <DeleteButton
                  label={`Удалить локацию «${l.name}»`}
                  onClick={async () => { await api.deleteLocation(l.id); await load(); }}
                />
              </div>
              <div className="text-[var(--color-muted-foreground)]">{l.profile.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── Items ───────────

function ItemsTab({ bookId }: { bookId: number }) {
  const [list, setList] = useState<Item[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setList(await api.listItems(bookId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { load(); }, [bookId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    try {
      const profile: ItemProfile = { description: description.trim() };
      await api.createItem(bookId, { name: name.trim(), profile });
      setName(""); setDescription("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <p className="text-sm text-red-600">Ошибка: {error}</p>;
  if (list === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onCreate} className="flex gap-2">
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Название предмета" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || !description.trim()}>+</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Нет предметов.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((i) => (
            <li key={i.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm">
              <div className="flex justify-between">
                <strong>{i.name}</strong>
                <DeleteButton
                  label={`Удалить предмет «${i.name}»`}
                  onClick={async () => { await api.deleteItem(i.id); await load(); }}
                />
              </div>
              <div className="text-[var(--color-muted-foreground)]">{i.profile.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── Hooks ───────────

function HooksTab({ bookId }: { bookId: number }) {
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
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm" placeholder="Описание сюжетного крючка" value={description} onChange={(e) => setDescription(e.target.value)} />
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
                  <div className="text-xs text-[var(--color-muted-foreground)] mb-1">[{h.status}]</div>
                  <div>{h.description}</div>
                </div>
                <select
                  value={h.status}
                  onChange={(e) => onStatus(h.id, e.target.value as Hook["status"])}
                  className="border border-[var(--color-input)] rounded-md px-2 py-1 text-xs"
                >
                  <option value="open">open</option>
                  <option value="mentioned">mentioned</option>
                  <option value="resolved">resolved</option>
                  <option value="deferred">deferred</option>
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

function RelationshipsTab({ bookId }: { bookId: number }) {
  const [chars, setChars] = useState<Character[]>([]);
  const [list, setList] = useState<Relationship[] | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [type, setType] = useState("");
  const [tension, setTension] = useState("0");
  const [error, setError] = useState<string | null>(null);

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
        <select value={from ?? ""} onChange={(e) => setFrom(Number(e.target.value))} className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm">
          <option value="">от кого</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.canonicalName}</option>)}
        </select>
        <select value={to ?? ""} onChange={(e) => setTo(Number(e.target.value))} className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm">
          <option value="">к кому</option>
          {chars.map((c) => <option key={c.id} value={c.id}>{c.canonicalName}</option>)}
        </select>
        <input className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-1 text-sm min-w-[150px]" placeholder="Тип (наставник, враг…)" value={type} onChange={(e) => setType(e.target.value)} />
        <input type="number" step="0.1" min="-1" max="1" className="w-20 border border-[var(--color-input)] rounded-md px-2 py-1 text-sm" value={tension} onChange={(e) => setTension(e.target.value)} title="напряжение -1..1" />
        <Button type="submit" disabled={from === null || to === null || !type.trim()}>+</Button>
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Нет связей.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.id} className="border border-[var(--color-border)] rounded-md p-3 text-sm flex justify-between items-center">
              <div>
                <strong>{nameById.get(r.fromCharacterId) ?? `#${r.fromCharacterId}`}</strong>
                {" → "}
                <strong>{nameById.get(r.toCharacterId) ?? `#${r.toCharacterId}`}</strong>
                : {r.type} (tension: {r.tension.toFixed(2)})
              </div>
              <DeleteButton
                label="Удалить связь"
                onClick={async () => { await api.deleteRelationship(r.id); await load(); }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
