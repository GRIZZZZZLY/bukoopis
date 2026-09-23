import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { StageStepper } from "@/components/studio/StageStepper";
import {
  ChapterStateDot,
  chapterState,
  chapterStateLabel,
} from "@/components/book/StageStatus";
import { api } from "@/api/client";
import { isPlanApproved } from "@book-forge/shared";
import type { Book, BookConcept, Chapter, StudioState } from "@book-forge/shared";

/** Мастерская · Главы — только готовность глав к письму: у каких есть план
 *  главы. Список глав с правкой, экспортом и поиском живёт в доме книги;
 *  раньше этот экран собирал ещё канон, импорт и поиск. */
export function ChaptersStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let alive = true;
    Promise.all([api.getBook(id), api.listChapters(id), api.getConcept(id), api.getStudioState(id)])
      .then(([b, chs, c, s]) => {
        if (!alive) return;
        setBook(b);
        setChapters(chs);
        setConcept(c);
        setStudio(s);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!Number.isFinite(id) || error) {
    return (
      <div className="route">
        <div className="page">
          <p role="alert" className="alert-error">
            {error ? `Ошибка: ${error}` : "Книга не найдена"}
          </p>
        </div>
      </div>
    );
  }
  if (!book || chapters === null || !concept || !studio) {
    return <PageSkeleton label="Главы загружаются" />;
  }

  const planned = chapters.filter((c) => c.planJson !== null).length;

  return (
    <div className="route studio-room" data-screen-label="Chapters">
      <StageStepper
        bookId={id}
        concept={concept}
        studioState={studio}
        activeStageId="chapters"
        chapters={{
          total: chapters.length,
          finalized: chapters.filter((c) => c.status === "final").length,
        }}
        planApproved={isPlanApproved(book.outlineJson)}
      />
      <div className="studio-body">
        <div className="stage-head">
          <div>
            <h1>Главы</h1>
            <p className="muted page-sub">
              Готовность к письму: у каких глав есть план. Сами главы, порядок и
              экспорт — в разделе{" "}
              <Link to={`/books/${id}/chapters`} className="link-quiet">
                Главы книги
              </Link>
              .
            </p>
          </div>
        </div>

        {chapters.length === 0 ? (
          <div className="empty">
            <h3>Глав пока нет</h3>
            <p className="muted">
              Утвердите план — главы появятся из него. Или создайте главу вручную в{" "}
              <Link to={`/books/${id}/chapters`} className="link-quiet">
                разделе «Главы»
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <p className="faint mono">
              план главы есть у {planned} из {chapters.length}
            </p>
            <div className="ctable" role="table" aria-label="Готовность глав">
              <div className="ctable-head ctable-head-ready" role="row">
                <span role="columnheader">№</span>
                <span role="columnheader">Глава</span>
                <span role="columnheader">План главы</span>
                <span role="columnheader">Статус</span>
              </div>
              {chapters.map((c, i) => {
                const state = chapterState(c);
                return (
                  <div key={c.id} className="ctable-row ctable-row-ready" role="row">
                    <span className="mono faint" role="cell">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span role="cell" className="ctable-title-cell">
                      <Link to={`/books/${id}/chapters/${c.id}`} className="ctable-title">
                        {c.title}
                      </Link>
                    </span>
                    <span role="cell" className={c.planJson ? "ok-text" : "faint"}>
                      {c.planJson ? "есть" : "нет"}
                    </span>
                    <span className={`ctable-state ctable-state-${state}`} role="cell">
                      <ChapterStateDot state={state} />
                      {chapterStateLabel(state)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
