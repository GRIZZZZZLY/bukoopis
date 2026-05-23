import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { stageRoute } from "@/lib/studio-routes";
import type { Book, BookStatus, StageId } from "@book-forge/shared";

const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};

type Tone = "amber" | "blue" | "green" | "muted";
const STATUS_TONE: Record<BookStatus, Tone> = {
  draft: "amber",
  active: "blue",
  archived: "muted",
};

const STAGE_LABEL: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SPINE_PALETTE = ["#D49A4E", "#B5803A", "#E8B361", "#C89243", "#8E6126"];
const spineColor = (id: number) => SPINE_PALETTE[id % SPINE_PALETTE.length]!;

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
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px" }}>
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
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 96px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div>
            <h1
              className="font-display"
              style={{
                fontSize: 36,
                fontWeight: 500,
                margin: "0 0 8px",
                letterSpacing: "-0.015em",
                color: "var(--color-text-strong)",
              }}
            >
              Ваши книги
            </h1>
            <div className="text-muted" style={{ fontSize: 14 }}>
              {count === 0 ? (
                "Здесь будет ваша первая книга."
              ) : (
                <>
                  {count} {count === 1 ? "книга" : "книг"}
                  {latest && (
                    <>
                      {" · последняя правка "}
                      <span
                        className="font-mono"
                        style={{ color: "var(--color-text)" }}
                      >
                        {relativeTime(latest)}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
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

        {/* Grid */}
        {count === 0 ? (
          <div
            className="card"
            style={{
              padding: 40,
              textAlign: "center",
              borderStyle: "dashed",
            }}
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
            <h2
              className="font-display"
              style={{
                fontSize: 22,
                fontWeight: 500,
                margin: "0 0 8px",
                color: "var(--color-text-strong)",
              }}
            >
              Создайте первую книгу
            </h2>
            <p
              className="text-muted"
              style={{ fontSize: 13, maxWidth: 360, margin: "0 auto" }}
            >
              Дайте ей рабочее название — план, главы, канон и стиль будут жить
              здесь.
            </p>
          </div>
        ) : (
          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 20,
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
            aria-label="Список книг"
          >
            {books.map((b) => (
              <li key={b.id}>
                <BookCard
                  book={b}
                  recommended={recommended[b.id]}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Footer hint */}
        {count > 0 && (
          <div
            style={{
              marginTop: 48,
              color: "var(--color-text-faint)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            Нажмите <span className="kbd" style={{ verticalAlign: "middle" }}>N</span>{" "}
            чтобы создать новую книгу
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
  const tone = STATUS_TONE[b.status];
  const spine = spineColor(b.id);
  return (
    <div
      className="card hoverable"
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: 220,
      }}
    >
      {/* Faux spine */}
      <div
        className="spine"
        style={{
          height: 12,
          background: `linear-gradient(180deg, ${spine}99, ${spine} 50%, ${spine}99)`,
        }}
      >
        <div
          className="font-mono"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontSize: 8,
            color: "rgba(26,20,16,0.55)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          BKO · {String(b.id).padStart(4, "0")}
        </div>
      </div>
      {/* Paper body */}
      <div
        className="paper"
        style={{
          flex: 1,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Link
          to={`/books/${b.id}/studio`}
          style={{
            color: "var(--color-text-strong)",
            textDecoration: "none",
          }}
        >
          <h3
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: 0,
              lineHeight: 1.15,
              color: "var(--color-text-strong)",
              letterSpacing: "-0.01em",
              textWrap: "pretty",
            }}
          >
            {b.title}
          </h3>
        </Link>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          {b.language === "ru" ? "Русский" : b.language} · {STATUS_LABEL[b.status]}
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: "var(--color-text-faint)",
            marginTop: 10,
            display: "flex",
            gap: 16,
          }}
        >
          <span>
            <span style={{ color: "var(--color-text-muted)" }}>—</span> глав
          </span>
          <span>
            <span style={{ color: "var(--color-text-muted)" }}>—</span> слов
          </span>
        </div>
        {recommended && (
          <div
            className="font-mono"
            style={{ fontSize: 11, marginTop: 8 }}
          >
            <span style={{ color: "var(--color-text-faint)" }}>далее: </span>
            <Link
              to={stageRoute(b.id, recommended)}
              style={{
                color: "var(--color-brass)",
                borderBottom: "1px solid currentColor",
              }}
            >
              Продолжить → {STAGE_LABEL[recommended]}
            </Link>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 11, color: "var(--color-text-faint)" }}
          >
            {relativeTime(b.updatedAt ?? b.createdAt)}
          </span>
          <span className={`pill pill-${tone}`}>
            <span className="dot" style={{ background: "currentColor" }} />
            {STATUS_LABEL[b.status]}
          </span>
        </div>
      </div>
    </div>
  );
}
