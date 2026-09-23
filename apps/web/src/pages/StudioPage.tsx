import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import { isPlanApproved } from "@book-forge/shared";
import type { Book, BookConcept, ChapterProgress, StudioState } from "@book-forge/shared";
import { ConceptStage } from "@/components/studio/concept/ConceptStage";
import { StageStepper } from "@/components/studio/StageStepper";
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Мастерская · Замысел. Прежде эта страница была ещё и дашбордом книги —
 *  прогресс, приём материалов, быстрый сбор, предупреждения. Всё это живёт
 *  теперь в «Обзоре» дома книги; здесь остался только этап. */
export function StudioPage() {
  const { bookId: rawId } = useParams<{ bookId: string }>();
  const bookId = Number(rawId);

  const [book, setBook] = useState<Book | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [chapters, setChapters] = useState<ChapterProgress | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Два вызова reload (эффект и утверждение замысла) могут перекрыться —
  // номер запроса отбрасывает устаревший ответ.
  const requestIdRef = useRef(0);

  async function reload() {
    const requestId = ++requestIdRef.current;
    try {
      const [b, c, s, list] = await Promise.all([
        api.getBook(bookId).catch(() => null),
        api.getConcept(bookId),
        api.getStudioState(bookId),
        api.listChapters(bookId).catch(() => null),
      ]);
      if (requestIdRef.current !== requestId) return;
      setBook(b);
      setConcept(c);
      setStudio(s);
      setChapters(
        list
          ? { total: list.length, finalized: list.filter((x) => x.status === "final").length }
          : undefined,
      );
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    void reload();
    return () => {
      requestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  if (error) {
    return (
      <div className="route">
        <div className="page">
          <p role="alert" className="alert-error">Ошибка: {error}</p>
        </div>
      </div>
    );
  }
  if (!concept || !studio) return <PageSkeleton label="Замысел загружается" />;

  function handleConceptChange(next: BookConcept) {
    setConcept(next);
    // Утверждение переименовывает книгу и двигает степпер. Сам замысел
    // не перечитываем: ответ сервера уже в руках, а поздний GET мог бы
    // перетереть следующее сохранение.
    void api.getBook(bookId).then(setBook).catch(() => {});
    void api.getStudioState(bookId).then(setStudio).catch(() => {});
  }

  return (
    <div className="route studio-room" data-screen-label="stage-concept">
      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId="concept"
        {...(chapters !== undefined ? { chapters } : {})}
        planApproved={isPlanApproved(book?.outlineJson ?? null)}
        aside={<span className="faint">Замысел пропустить нельзя</span>}
      />
      <div className="studio-body">
        <ConceptStage bookId={bookId} concept={concept} onConceptChange={handleConceptChange} />
      </div>
    </div>
  );
}
