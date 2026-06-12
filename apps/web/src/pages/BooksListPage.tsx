import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal, Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { stageRoute } from "@/lib/studio-routes";
import type { Book, BookStatus, StageId } from "@book-forge/shared";

const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};

type Tone = "amber" | "blue" | "muted";
const STATUS_TONE: Record<BookStatus, Tone> = {
  draft: "amber",
  active: "blue",
  archived: "muted",
};

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
          <div className="bookgrid" aria-label="Список книг">
            {books.map((b) => (
              <BookCard key={b.id} book={b} recommended={recommended[b.id]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookCard({
  book: b,
  recommended,
}: {
  book: Book;
  recommended: StageId | undefined;
}) {
  const navigate = useNavigate();
  const tone = STATUS_TONE[b.status];

  return (
    <div
      className="bookcard"
      role="link"
      tabIndex={0}
      aria-label={b.title}
      onClick={() => navigate(`/books/${b.id}/studio`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/books/${b.id}/studio`);
      }}
    >
      <div className="spine">
        <span className="spine-emboss mono" aria-hidden="true">
          {b.title}
        </span>
      </div>
      <div className="bookcard-body paper-grain">
        <div className="bookcard-meta cap-upper">
          {b.language === "ru" ? "Русский" : b.language} ·{" "}
          {STATUS_LABEL[b.status]}
        </div>
        <h2 className="bookcard-title">{b.title}</h2>
        <div className="bookcard-stats mono">
          <span>— глав</span>
          <span className="faint">·</span>
          <span>— слов</span>
        </div>
        {recommended && (
          <Link
            className="bookcard-continue mono"
            to={stageRoute(b.id, recommended)}
            onClick={(e) => e.stopPropagation()}
          >
            Продолжить →
          </Link>
        )}
      </div>
      <div className="bookcard-foot">
        <span className="cap">{relativeTime(b.updatedAt ?? b.createdAt)}</span>
        <span className="bookcard-foot-spacer" />
        <span className={`pill pill-${tone === "muted" ? "strong" : tone}`}>
          {STATUS_LABEL[b.status]}
        </span>
        <button
          type="button"
          className="bookcard-kebab"
          aria-label="Действия"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
