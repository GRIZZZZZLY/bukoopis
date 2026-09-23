import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { STAGE_LABELS } from "@/lib/labels";
import { formatWhen } from "@/lib/format";
import {
  shelfProgress,
  spineHeight,
  spineTone,
  spineWidth,
  titleSeed,
  type BookStats,
} from "@/lib/shelf";
import type { Book, StageId } from "@book-forge/shared";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  if (d < 7) return `${d} дн. назад`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function bookWord(n: number): string {
  const r = n % 10;
  const rr = n % 100;
  if (rr >= 11 && rr <= 14) return "книг";
  if (r === 1) return "книга";
  if (r >= 2 && r <= 4) return "книги";
  return "книг";
}

export function BooksListPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<Record<number, StageId>>({});
  const [stats, setStats] = useState<Record<string, BookStats>>({});
  const [creating, setCreating] = useState(false);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  /** Выбранная на полке книга: её карточка справа. По умолчанию — та,
   *  которую правили последней. */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logline, setLogline] = useState<{ id: number; text: string | null } | null>(null);
  const navigate = useNavigate();

  async function load() {
    setError(null);
    try {
      const list = await api.listBooks();
      setBooks(list);
      try {
        setRecommended(await api.listRecommended());
      } catch {
        setRecommended({});
      }
      api.getBooksStats().then(setStats).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selected =
    books?.find((b) => b.id === selectedId) ??
    [...(books ?? [])].sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    )[0] ??
    null;

  // Логлайн — из замысла выбранной книги; украшение, сбой не мешает.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    api
      .getConcept(selected.id)
      .then((c) => alive && setLogline({ id: selected.id, text: c.premise?.logline?.trim() || c.idea?.trim() || null }))
      .catch(() => alive && setLogline({ id: selected.id, text: null }));
    return () => {
      alive = false;
    };
  }, [selected?.id]);

  const IDEA_MIN = 10;

  async function onCreate(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length < IDEA_MIN) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBook({ idea: trimmed });
      navigate(`/books/${created.id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="route">
        <div className="page page-books">
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  }
  if (books === null) return <PageSkeleton label="Список книг загружается" />;

  const count = books.length;
  const latest = books
    .map((b) => b.updatedAt ?? b.createdAt)
    .sort()
    .at(-1);

  return (
    <div className="route" data-screen-label="Books list">
      <div className="page page-books">
        <div className="page-head">
          <div>
            <h1>Полка</h1>
            <p className="muted page-sub">
              {count === 0 ? (
                "Здесь будет ваша первая книга."
              ) : (
                <>
                  {count} {bookWord(count)}
                  {latest && <> · последняя правка {relativeTime(latest)}</>}
                </>
              )}
            </p>
          </div>
          {!creating ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} aria-hidden="true" />
              Новая книга
            </button>
          ) : (
            <form
              onSubmit={onCreate}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%", maxWidth: 720 }}
              aria-label="Создать новую книгу"
            >
              <textarea
                className="input"
                autoFocus
                rows={3}
                placeholder="Одной фразой или сбивчиво, как думается. Название придумается позже."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                aria-label="О чём книга?"
                style={{ flex: 1, resize: "vertical" }}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || idea.trim().length < IDEA_MIN}
              >
                {busy ? "…" : "Начать"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false);
                  setIdea("");
                }}
                disabled={busy}
              >
                Отмена
              </button>
            </form>
          )}
        </div>

        {count === 0 ? (
          <div
            className="card"
            style={{ padding: 40, textAlign: "center", borderStyle: "dashed" }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 999,
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-brass)",
                marginBottom: 12,
              }}
              aria-hidden="true"
            >
              <Plus size={28} />
            </div>
            <h2 style={{ marginBottom: 8 }}>Создайте первую книгу</h2>
            <p
              className="muted"
              style={{ fontSize: 13, maxWidth: 360, margin: "0 auto" }}
            >
              Дайте ей рабочее название — план, главы, канон и стиль будут жить
              здесь.
            </p>
          </div>
        ) : (
          <div className="shelf-room">
          <div className="bookshelf" aria-label="Список книг">
            {books.map((b) => {
              const s = stats[String(b.id)];
              const seed = titleSeed(b.title);
              const progress = shelfProgress(s?.done ?? 0, s?.chapters ?? 0);
              const on = selected?.id === b.id;
              return (
                <div className="shelf-slot" key={b.id}>
                  <button
                    type="button"
                    className={`shelf-book spine-tone-${spineTone(seed)} ${on ? "shelf-book-on" : ""}`}
                    aria-label={b.title}
                    aria-pressed={on}
                    title={
                      s
                        ? `${b.title} · ${s.chapters} гл. · ${s.words.toLocaleString("ru-RU")} слов`
                        : b.title
                    }
                    style={{
                      width: spineWidth(s?.chapters ?? 0),
                      height: spineHeight(s?.chapters ?? 0, seed),
                    }}
                    onClick={() => setSelectedId(b.id)}
                    onDoubleClick={() => navigate(`/books/${b.id}`)}
                  >
                    {progress > 0 && (
                      <span
                        className="shelf-ribbon"
                        style={{ height: `${Math.round(progress * 100)}%` }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="shelf-title">{b.title}</span>
                  </button>
                </div>
              );
            })}
            <div className="shelf-slot">
              <button
                type="button"
                className="shelf-book shelf-book-ghost"
                aria-label="Добавить книгу"
                title="Добавить книгу"
                onClick={() => setCreating(true)}
              >
                +
              </button>
            </div>
          </div>
          {selected && (
            <SelectedBook
              book={selected}
              stats={stats[String(selected.id)]}
              stage={recommended[selected.id]}
              logline={logline?.id === selected.id ? logline.text : null}
              onOpen={() => navigate(`/books/${selected.id}`)}
            />
          )}
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedBook({
  book,
  stats,
  stage,
  logline,
  onOpen,
}: {
  book: Book;
  stats: BookStats | undefined;
  stage: StageId | undefined;
  logline: string | null;
  onOpen: () => void;
}) {
  const chapters = stats?.chapters ?? 0;
  return (
    <aside className="shelf-card" aria-label="Выбранная книга">
      <div className="shelf-card-head">
        <span className="cap">Выбрана</span>
        <h2>{book.title}</h2>
        {logline && <p className="shelf-card-logline">{logline}</p>}
      </div>
      <dl className="shelf-card-rows">
        <div>
          <dt>Глав</dt>
          <dd className="mono">
            {chapters === 0
              ? "пока нет"
              : `${chapters} · готово ${stats?.done ?? 0}`}
          </dd>
        </div>
        {stats && stats.words > 0 && (
          <div>
            <dt>Объём</dt>
            <dd className="mono">{stats.words.toLocaleString("ru-RU")} слов</dd>
          </div>
        )}
        <div>
          <dt>Последняя правка</dt>
          <dd className="mono">{formatWhen(book.updatedAt ?? book.createdAt)}</dd>
        </div>
        <div>
          <dt>Следующий шаг</dt>
          <dd className="shelf-card-stage">{stage ? STAGE_LABELS[stage] : "книга проработана"}</dd>
        </div>
      </dl>
      <button type="button" className="btn btn-secondary shelf-card-open" onClick={onOpen}>
        Открыть книгу
      </button>
    </aside>
  );
}
