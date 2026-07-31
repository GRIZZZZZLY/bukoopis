import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { stageRoute } from "@/lib/studio-routes";
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
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function onCreate(e?: FormEvent) {
    e?.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBook({ title: title.trim() });
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
            <h1>Ваши книги</h1>
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
              style={{ display: "flex", gap: 8, alignItems: "center" }}
              aria-label="Создать новую книгу"
            >
              <input
                className="input"
                autoFocus
                placeholder="Название книги…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Название книги"
                style={{ width: 280 }}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !title.trim()}
              >
                {busy ? "…" : "Создать"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false);
                  setTitle("");
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
          <div className="bookshelf" aria-label="Список книг">
            {books.map((b) => {
              const s = stats[String(b.id)];
              const seed = titleSeed(b.title);
              const progress = shelfProgress(s?.done ?? 0, s?.chapters ?? 0);
              const rec = recommended[b.id];
              return (
                <div className="shelf-slot" key={b.id}>
                  <div
                    className={`shelf-book spine-tone-${spineTone(seed)}`}
                    role="link"
                    tabIndex={0}
                    aria-label={b.title}
                    title={
                      s
                        ? `${b.title} · ${s.chapters} гл. · ${s.words.toLocaleString("ru-RU")} слов`
                        : b.title
                    }
                    style={{
                      width: spineWidth(s?.chapters ?? 0),
                      height: spineHeight(s?.chapters ?? 0, seed),
                    }}
                    onClick={() => navigate(`/books/${b.id}/studio`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/books/${b.id}/studio`);
                    }}
                  >
                    {progress > 0 && (
                      <span
                        className="shelf-ribbon"
                        style={{ height: `${Math.round(progress * 100)}%` }}
                        aria-hidden="true"
                      />
                    )}
                    <h2 className="shelf-title">{b.title}</h2>
                    {rec && (
                      <Link
                        to={stageRoute(b.id, rec)}
                        className="shelf-continue"
                        aria-label="Продолжить"
                        title="Продолжить работу"
                        onClick={(e) => e.stopPropagation()}
                      >
                        →
                      </Link>
                    )}
                  </div>
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
        )}
      </div>
    </div>
  );
}
