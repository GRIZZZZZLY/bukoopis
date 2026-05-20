import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Kbd } from "@/components/ui/kbd";
import { api } from "@/api/client";
import { stageRoute } from "@/lib/studio-routes";
import type { Book, BookStatus, StageId } from "@book-forge/shared";

const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};
const STATUS_TONE: Record<BookStatus, PillTone> = {
  draft: "amber",
  active: "blue",
  archived: "default",
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function spineColor(bookId: number): string {
  const palette = ["#D49A4E", "#B5803A", "#E8B361", "#C89243", "#8E6126"];
  return palette[bookId % palette.length]!;
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

  async function onCreate(e: FormEvent) {
    e.preventDefault();
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
      <main className="max-w-[1280px] mx-auto px-8 pt-10 pb-24">
        <p
          role="alert"
          className="text-sm rounded-md px-3 py-2 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
        >
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (books === null) return <PageSkeleton label="Список книг загружается" />;

  const count = books.length;
  const latest = books
    .map((b) => b.updatedAt ?? b.createdAt)
    .sort()
    .at(-1);

  return (
    <main className="max-w-[1280px] mx-auto px-8 pt-10 pb-24 flex flex-col gap-8">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="flex flex-col gap-2">
          <h1
            className="text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--color-text-strong)]"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Ваши книги
          </h1>
          <div className="text-sm text-[var(--color-text-muted)]">
            {count === 0 ? (
              "Здесь будет ваша первая книга."
            ) : (
              <>
                {count} {count === 1 ? "книга" : "книг"}
                {latest && (
                  <>
                    {" · последняя правка "}
                    <span className="lw-mono text-[var(--color-text)]">
                      {relativeTime(latest)}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {!creating ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Новая книга
          </Button>
        ) : (
          <form
            onSubmit={onCreate}
            className="flex items-center gap-2"
            aria-label="Создать новую книгу"
          >
            <input
              className="lw-input w-[280px]"
              autoFocus
              placeholder="Название книги…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Название книги"
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "…" : "Создать"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setTitle("");
              }}
              disabled={busy}
            >
              Отмена
            </Button>
          </form>
        )}
      </header>

      {count === 0 ? (
        <section
          className="lw-card p-10 flex flex-col items-center text-center gap-4 border-dashed"
          aria-label="Пустое состояние"
        >
          <div
            className="size-14 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] inline-flex items-center justify-center"
            aria-hidden="true"
          >
            <Plus className="size-7 text-[var(--color-brass)]" />
          </div>
          <h2
            className="text-xl"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Создайте первую книгу
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
            Дайте ей рабочее название — план, главы, канон и стиль будут жить
            здесь.
          </p>
        </section>
      ) : (
        <ul
          className="grid gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}
          aria-label="Список книг"
        >
          {books.map((b) => (
            <li key={b.id}>
              <article
                className="lw-card p-0 overflow-hidden flex flex-row"
                style={{ height: 280, padding: 0 }}
              >
                <div
                  className="lw-spine-v"
                  style={{ ["--spine-color" as string]: spineColor(b.id) }}
                  aria-hidden="true"
                >
                  <span className="lw-spine-label">
                    BKO · {String(b.id).padStart(4, "0")} · {STATUS_LABEL[b.status]}
                  </span>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="lw-paper flex-1 flex flex-col px-6 pt-5 pb-4">
                    <div className="lw-cap-upper">
                      BKO · {String(b.id).padStart(4, "0")}
                    </div>
                    <Link
                      to={`/books/${b.id}/studio`}
                      className="outline-none group/title mt-2"
                    >
                      <h3
                        className="text-[28px] leading-[1.1] tracking-[-0.015em] text-[var(--color-text-strong)] m-0 group-hover/title:text-[var(--color-brass)] transition-colors"
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 500,
                          textWrap: "pretty",
                        }}
                      >
                        {b.title}
                      </h3>
                    </Link>
                    <div className="lw-mono text-[12px] text-[var(--color-text-faint)] mt-4">
                      создана {relativeTime(b.createdAt)}
                    </div>
                    <div className="flex-1" />
                    {recommended[b.id] && (
                      <div className="lw-mono text-[13px] mt-4">
                        <Link
                          to={stageRoute(b.id, recommended[b.id]!)}
                          className="text-[var(--color-brass)] hover:text-[var(--color-brass-hi)] transition-colors"
                          style={{ borderBottom: "1px solid currentColor" }}
                        >
                          Продолжить → {STAGE_LABEL[recommended[b.id]!]}
                        </Link>
                      </div>
                    )}
                  </div>
                  <div
                    className="flex items-center justify-between gap-3 px-6 py-3.5"
                    style={{
                      background: "var(--color-bg)",
                      borderTop: "1px solid var(--color-border-strong)",
                      boxShadow: "inset 0 1px 0 rgba(0,0,0,0.25)",
                    }}
                  >
                    <span className="lw-mono text-[11px] text-[var(--color-text-muted)]">
                      {relativeTime(b.updatedAt ?? b.createdAt)}
                    </span>
                    <Pill tone={STATUS_TONE[b.status]} dot>
                      {STATUS_LABEL[b.status]}
                    </Pill>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <p className="lw-mono text-[12px] text-[var(--color-text-faint)] mt-2">
          Нажмите <Kbd>N</Kbd> чтобы создать новую книгу
        </p>
      )}
    </main>
  );
}
