import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { BookPlus } from "lucide-react";
import { api } from "@/api/client";
import type { Book } from "@book-forge/shared";

export function BooksListPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setError(null);
    try {
      setBooks(await api.listBooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
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
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (books === null) return <PageSkeleton label="Список книг загружается" />;

  const isEmpty = books.length === 0;

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Книги</h1>
        <div className="flex gap-3">
          <Link to="/style-profiles" className="text-sm underline">
            Стилевые профили →
          </Link>
          <Link to="/usage" className="text-sm underline">
            Расходы →
          </Link>
        </div>
      </div>

      {isEmpty ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg p-10 flex flex-col items-center text-center gap-4">
          <div
            className="size-14 rounded-full bg-[var(--color-muted)] inline-flex items-center justify-center"
            aria-hidden="true"
          >
            <BookPlus className="size-7 text-[var(--color-muted-foreground)]" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Создайте первую книгу</h2>
            <p className="text-sm text-[var(--color-muted-foreground)] max-w-sm">
              План, главы, канон и стиль — всё хранится в одной книге. Дайте ей
              рабочее название, остальное добавите потом.
            </p>
          </div>
          <form
            onSubmit={onCreate}
            className="flex gap-2 w-full max-w-sm mt-2"
          >
            <input
              className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              placeholder="Например, «Маяк и письмо»"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
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
        </div>
      ) : (
        <>
          <form
            onSubmit={onCreate}
            className="flex gap-2"
            aria-label="Создать новую книгу"
          >
            <input
              className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              placeholder="Название книги"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Название книги"
            />
            <Button
              type="submit"
              disabled={creating || !title.trim()}
              aria-busy={creating || undefined}
            >
              + Новая книга
            </Button>
          </form>

          <ul className="flex flex-col gap-2">
            {books.map((b) => (
              <li
                key={b.id}
                className="border border-[var(--color-border)] rounded-md p-4 hover:bg-[var(--color-accent)] hover:shadow-sm transition-shadow"
              >
                <Link to={`/books/${b.id}/studio`} className="block">
                  <div className="font-medium">{b.title}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {new Date(b.createdAt).toLocaleString("ru-RU")} · {b.status}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
