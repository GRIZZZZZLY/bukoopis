import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import {
  boardColumns,
  boardHeight,
  boardWidth,
  layoutNotes,
  threadSpan,
  COLUMN_W,
  BOARD_PAD,
} from "@/lib/board";
import type { Book, BookNote, NoteKind } from "@book-forge/shared";

const KIND_LABEL: Record<NoteKind, string> = {
  thread: "нить",
  foreshadow: "предвестие",
  arc_delta: "арка",
  theme: "тема",
  mystery: "тайна",
};

export function PlotBoardPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);

  const [book, setBook] = useState<Book | null>(null);
  const [notes, setNotes] = useState<BookNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Доска шире экрана начиная с ~6 глав, но обрезалась вплотную к краю —
   *  ни намёка, что справа ещё стикеры. Считаем состояние прокрутки и
   *  подсвечиваем края. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncEdges();
    // jsdom и старые движки без ResizeObserver: краевые градиенты просто
    // не пересчитываются при ресайзе, скролл работает.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges, notes]);

  async function load() {
    setError(null);
    try {
      const [b, n] = await Promise.all([
        api.getBook(id),
        api.listBookNotes(id),
      ]);
      setBook(b);
      setNotes(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!Number.isFinite(id)) {
    return (
      <div className="route">
        <div className="page">
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Книга не найдена
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="route">
        <div className="page">
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
  if (!book || notes === null) {
    return <PageSkeleton label="Доска загружается" />;
  }

  const columns = boardColumns(notes);
  const placed = layoutNotes(notes);

  return (
    <div className="route" data-screen-label="Plot board">
      <div className="page page-board">
        <div className="page-head">
          <h1>Доска сюжета</h1>
          <p className="muted page-sub">
            {book?.title} · {notes.length} заметок
          </p>
          <Link
            to={`/books/${id}/studio`}
            className="btn btn-ghost btn-sm"
            viewTransition
          >
            ← В Studio
          </Link>
        </div>

        {notes.length === 0 ? (
          <div className="card board-empty">
            <p>
              Доска пуста. Заметки появляются сами, когда агенты памяти
              разбирают написанные главы.
            </p>
          </div>
        ) : (
          <div
            className="board-viewport"
            data-edge-left={edges.left || undefined}
            data-edge-right={edges.right || undefined}
          >
            <div
              className="board-scroll"
              ref={scrollRef}
              onScroll={syncEdges}
              // прокрутка доски с клавиатуры: без tabIndex фокус в регион не
              // попадает и стрелками её не сдвинуть
              tabIndex={0}
              role="region"
              aria-label="Доска сюжета, прокручивается по горизонтали"
            >
            <div
              className="board-canvas"
              style={{
                width: boardWidth(columns),
                height: boardHeight(placed),
              }}
            >
              <svg
                className="board-threads"
                aria-hidden="true"
                width={boardWidth(columns)}
                height={boardHeight(placed)}
              >
                {placed.map((p) => {
                  const span = threadSpan(p.note, columns);
                  const y = p.y + 24;
                  return (
                    <path
                      key={p.note.id}
                      className={`thread ${span.open ? "thread-open" : ""}`}
                      d={`M ${span.x1} ${y} C ${span.x1 + 40} ${y + 18}, ${span.x2 - 40} ${y + 18}, ${span.x2} ${y}`}
                    />
                  );
                })}
              </svg>

              {columns.map((c, i) => (
                <div
                  key={c}
                  className="board-col-label mono faint"
                  style={{
                    left: BOARD_PAD + i * COLUMN_W,
                    top: BOARD_PAD / 2,
                    width: COLUMN_W - 12,
                  }}
                >
                  гл. {c}
                </div>
              ))}

              {placed.map((p) => (
                <article
                  key={p.note.id}
                  className={`board-note note-${p.note.kind}`}
                  style={{ left: p.x, top: p.y }}
                  aria-label={
                    p.note.resolved === null
                      ? `Открытая линия: ${p.note.title}`
                      : `${p.note.title} · закрыта в главе ${p.note.resolved}`
                  }
                >
                  <span className="board-pin" aria-hidden="true" />
                  <div className="board-note-kind cap-upper mono">
                    {KIND_LABEL[p.note.kind]}
                  </div>
                  <h2 className="board-note-title">{p.note.title}</h2>
                  <p className="board-note-body">{p.note.body}</p>
                  <div className="board-note-foot mono faint">
                    гл. {p.note.introduced}
                    {p.note.resolved !== null
                      ? ` → ${p.note.resolved}`
                      : " · открыта"}
                  </div>
                </article>
              ))}
            </div>
            </div>
          </div>
        )}

        {notes.length > 0 && (
          <div className="board-legend mono faint">
            {(Object.keys(KIND_LABEL) as NoteKind[]).map((kind) => (
              <span key={kind} className={`board-legend-item note-${kind}`}>
                {KIND_LABEL[kind]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
