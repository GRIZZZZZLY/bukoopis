import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Pill, type PillTone } from "@/components/ui/pill";
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function BooksListPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<Record<number, StageId>>({});
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
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
    setCreating(true);
    setError(null);
    try {
      const created = await api.createBook({ title: title.trim() });
      navigate(`/books/${created.id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-8">
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

  const isEmpty = books.length === 0;
  const count = books.length;

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1
            className="text-[28px] leading-tight"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Ваши книги
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {isEmpty
              ? "Пока ни одной — начните с рабочего названия."
              : count === 1
                ? "1 книга в работе"
                : `${count} книг в работе`}
          </p>
        </div>
        <form
          onSubmit={onCreate}
          className="flex gap-2 w-full sm:w-auto sm:min-w-[360px]"
          aria-label="Создать новую книгу"
        >
          <input
            className="lw-input"
            placeholder="Например, «Маяк и письмо»"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Название книги"
          />
          <Button
            type="submit"
            disabled={creating || !title.trim()}
            aria-busy={creating || undefined}
          >
            {creating ? "…" : "Создать"}
          </Button>
        </form>
      </header>

      {isEmpty ? (
        <section
          className="border border-dashed border-[var(--color-border)] rounded-[var(--radius-shell)] p-10 flex flex-col items-center text-center gap-4"
          aria-label="Пустое состояние"
        >
          <div
            className="size-16 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] inline-flex items-center justify-center"
            aria-hidden="true"
          >
            <BookPlus className="size-8 text-[var(--color-brass)]" />
          </div>
          <div className="flex flex-col gap-1.5 max-w-md">
            <h2
              className="text-xl"
              style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
            >
              Здесь будет ваша первая книга
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              План, главы, канон и стиль — всё в одной книге. Дайте ей рабочее
              название в форме сверху, остальное добавите потом.
            </p>
          </div>
        </section>
      ) : (
        <ul
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Список книг"
        >
          {books.map((b) => (
            <li key={b.id} className="relative">
              <article className="lw-card flex flex-col gap-3 p-0 overflow-hidden h-full">
                <div className="lw-spine" aria-hidden="true" />
                <div className="flex flex-col gap-3 px-5 pt-3 pb-5 flex-1">
                  <Link
                    to={`/books/${b.id}/studio`}
                    className="flex flex-col gap-1 outline-none"
                  >
                    <h2
                      className="text-[20px] leading-snug text-[var(--color-text-strong)] hover:text-[var(--color-brass)] transition-colors"
                      style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
                    >
                      {b.title}
                    </h2>
                    <p className="lw-mono text-[11px] text-[var(--color-text-faint)]">
                      создана {formatDate(b.createdAt)}
                    </p>
                  </Link>

                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <Pill tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Pill>
                    {recommended[b.id] ? (
                      <Link
                        to={stageRoute(b.id, recommended[b.id]!)}
                        className="text-xs text-[var(--color-brass)] hover:text-[var(--color-brass-hi)] transition-colors"
                      >
                        Продолжить →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
