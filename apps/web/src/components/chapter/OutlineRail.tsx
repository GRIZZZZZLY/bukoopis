import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Chapter } from "@book-forge/shared";

export function OutlineRail({
  bookId,
  activeChapterId,
  collapsed,
}: {
  bookId: number;
  activeChapterId: number;
  collapsed: boolean;
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
