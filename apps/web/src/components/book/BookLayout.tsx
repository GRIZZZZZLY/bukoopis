import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { api } from "@/api/client";
import type { Book } from "@book-forge/shared";
import { BOOK_SECTIONS } from "@/lib/labels";
import { formatWords, plural } from "@/lib/format";
import { MaterialsDialog } from "./MaterialsDialog";

export interface BookRoomContext {
  bookId: number;
  book: Book | null;
  /** Перечитать шапку: название, счётчики — после правки или разбора. */
  reloadBook: () => void;
  openMaterials: () => void;
}

/** Раздел дома книги получает книгу и действия шапки отсюда. */
export function useBookRoom(): BookRoomContext {
  return useOutletContext<BookRoomContext>();
}

interface HeaderStats {
  chapters: number;
  words: number;
  genre: string | null;
}

/** Дом книги: шапка, меню из пяти разделов, раздел. Диалог «Добавить
 *  материалы» живёт здесь, а не в разделе: разбор идёт минутами, и переход
 *  между разделами не должен его прятать. */
export function BookLayout() {
  const { bookId: raw } = useParams<{ bookId: string }>();
  const bookId = Number(raw);
  const [book, setBook] = useState<Book | null>(null);
  const [stats, setStats] = useState<HeaderStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const reloadBook = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    let alive = true;
    api
      .getBook(bookId)
      .then((b) => alive && setBook(b))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    // Счётчики и жанр — украшение шапки: их сбой не мешает работать.
    void Promise.all([
      api.getBooksStats().catch(() => ({}) as Awaited<ReturnType<typeof api.getBooksStats>>),
      api.getConcept(bookId).catch(() => null),
    ]).then(([all, concept]) => {
      if (!alive) return;
      const s = all[String(bookId)];
      setStats({
        chapters: s?.chapters ?? 0,
        words: s?.words ?? 0,
        genre: concept?.genre?.trim() || null,
      });
    });
    return () => {
      alive = false;
    };
  }, [bookId, tick]);

  if (!Number.isFinite(bookId)) {
    return (
      <div className="route">
        <div className="page">
          <p role="alert" className="alert-error">Книга не найдена</p>
        </div>
      </div>
    );
  }

  const meta = stats
    ? [
        stats.genre,
        `${stats.chapters} ${plural(stats.chapters, "глава", "главы", "глав")}`,
        stats.words > 0 ? `${formatWords(stats.words)} слов` : null,
      ].filter(Boolean)
    : [];

  const ctx: BookRoomContext = {
    bookId,
    book,
    reloadBook,
    openMaterials: () => setMaterialsOpen(true),
  };

  return (
    <div className="book-room">
      <header className="book-head">
        <div className="book-head-title">
          <h1>{book?.title ?? "…"}</h1>
          {meta.length > 0 && <span className="book-head-meta">{meta.join(" · ")}</span>}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setMaterialsOpen(true)}
        >
          <span aria-hidden="true" className="book-head-plus">+</span>
          Добавить материалы
        </button>
      </header>
      {error && (
        <p role="alert" className="alert-error" style={{ margin: "16px 32px 0" }}>
          Ошибка: {error}
        </p>
      )}
      <div className="book-body">
        <nav className="book-menu" aria-label="Разделы книги">
          {BOOK_SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={s.path ? `/books/${bookId}/${s.path}` : `/books/${bookId}`}
              end={s.path === ""}
              className={({ isActive }) => `book-menu-item ${isActive ? "book-menu-item-active" : ""}`}
            >
              <span className="book-menu-bar" aria-hidden="true" />
              <span>{s.label}</span>
              {s.id === "chapters" && stats && stats.chapters > 0 && (
                <span className="book-menu-count mono">{stats.chapters}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="book-section">
          <Outlet context={ctx} />
        </div>
      </div>
      <MaterialsDialog
        bookId={bookId}
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        onChanged={reloadBook}
      />
    </div>
  );
}
