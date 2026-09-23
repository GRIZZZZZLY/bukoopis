import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { plural } from "@/lib/format";
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
  chapterLabels,
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
  /** Порядок глав книги — чтобы подписать колонки порядковыми номерами. */
  const [chapterOrders, setChapterOrders] = useState<number[]>([]);
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
      const [b, n, chs] = await Promise.all([
        api.getBook(id),
        api.listBookNotes(id),
        // Подписи колонок — порядковые номера глав, а не разрежённый
        // order_index: у третьей главы книги стояло «гл. 30».
        api.listChapters(id).catch(() => []),
      ]);
      setBook(b);
      setNotes(n);
      setChapterOrders(chs.map((ch) => ch.orderIndex));
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
    return <PageSkeleton label="Заметки загружаются" />;
  }

  const columns = boardColumns(notes);
  const placed = layoutNotes(notes);

  return (
    <div className="route" data-screen-label="Plot board">
      <div className="memory-sec">
        <div className="section-bar">
          <div className="memory-intro">
            <div className="section-bar-title">
              <h2>Заметки памяти</h2>
              <span className="tag tag-blue">только для чтения</span>
            </div>
            <p className="muted">
              Это память модели: что система запомнила, читая главы. Это не план
              и не канон. Чтобы что-то изменить, правьте текст главы или Канон —
              память обновится сама.
            </p>
          </div>
          <span className="mono faint">
            {notes.length} {plural(notes.length, "заметка", "заметки", "заметок")}
          </span>
        </div>

        {notes.length === 0 ? (
          <div className="card board-empty">
            <p>
              Заметок пока нет. Они появляются сами, когда модель
              разбирает сохранённые главы.
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
              aria-label="Заметки памяти, прокручиваются по горизонтали"
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

              {chapterLabels(columns, chapterOrders).map((label, i) => (
                <div
                  key={label}
                  className="board-col-label mono faint"
                  style={{
                    left: BOARD_PAD + i * COLUMN_W,
                    top: BOARD_PAD / 2,
                    width: COLUMN_W - 12,
                  }}
                >
                  гл. {label}
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
                    гл. {chapterLabels([p.note.introduced], chapterOrders)[0]}
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
