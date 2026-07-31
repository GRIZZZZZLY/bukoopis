import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Chapter } from "@book-forge/shared";

export function OutlineRail({
  bookId,
  activeChapterId,
  collapsed,
  onActivePosition,
}: {
  bookId: number;
  activeChapterId: number;
  collapsed: boolean;
  /** Позиция активной главы в оглавлении (1-based) — шапка рукописи
      показывает её вместо order_index, который к номеру не равен. */
  onActivePosition?: (position: number | null) => void;
}) {
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .listChapters(bookId)
      .then((cs) => {
        if (alive) setChapters(cs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    if (!onActivePosition) return;
    const idx = chapters.findIndex((ch) => ch.id === activeChapterId);
    onActivePosition(idx >= 0 ? idx + 1 : null);
  }, [chapters, activeChapterId, onActivePosition]);

  if (collapsed) return <aside className="outline-rail outline-rail-collapsed" aria-hidden="true" />;

  return (
    <aside className="outline-rail" aria-label="Оглавление">
      <div className="outline-head cap-upper">Оглавление</div>
      <ol className="outline-list">
        {chapters.map((ch, i) => (
          <li
            key={ch.id}
            className={`outline-item ${ch.id === activeChapterId ? "outline-item-active" : ""}`}
          >
            <Link to={`/books/${bookId}/chapters/${ch.id}`} viewTransition>
              <span className="outline-bar" aria-hidden="true" />
              <span className="outline-num mono">{i + 1}</span>
              <span className="outline-title">{ch.title}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="outline-foot faint mono">{chapters.length} гл.</div>
    </aside>
  );
}
