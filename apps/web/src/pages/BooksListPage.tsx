import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { STAGE_LABELS } from "@/lib/labels";
import { formatWhen, formatWords, plural } from "@/lib/format";
import { annotationFor, titleSeed, type BookStats } from "@/lib/shelf";
import { BookSpread, ShelfFlat } from "@/components/shelf/ShelfFlat";
import type { ShelfBook } from "@/components/shelf/coverArt";
import type { Book, BookConcept, StageId } from "@book-forge/shared";

// three.js грузится только здесь и только когда он нужен: остальное
// приложение его не несёт.
const ShowcaseScene = lazy(() => import("@/components/shelf/ShowcaseScene"));

/** jsdom и машины без ускорения графики WebGL не дают — тогда плоская витрина. */
function webglAvailable(): boolean {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function BooksListPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<Record<number, StageId>>({});
  const [stats, setStats] = useState<Record<string, BookStats>>({});
  const [concepts, setConcepts] = useState<Record<number, BookConcept | null>>({});
  const [creating, setCreating] = useState(false);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [webgl, setWebgl] = useState(webglAvailable);
  const [reducedMotion] = useState(prefersReducedMotion);
  const navigate = useNavigate();

  async function load() {
    setError(null);
    try {
      const list = await api.listBooks();
      setBooks(list);
      api.listRecommended().then(setRecommended).catch(() => setRecommended({}));
      api.getBooksStats().then(setStats).catch(() => {});
      // Жанр и аннотация — из замысла каждой книги; сбой одной не мешает остальным.
      void Promise.all(
        list.map((b) =>
          api
            .getConcept(b.id)
            .then((c) => [b.id, c] as const)
            .catch(() => [b.id, null] as const),
        ),
      ).then((pairs) => setConcepts(Object.fromEntries(pairs)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const shelf: ShelfBook[] = useMemo(
    () =>
      (books ?? []).map((b) => {
        const s = stats[String(b.id)];
        const c = concepts[b.id] ?? null;
        const rec = recommended[b.id];
        const meta: Array<[string, string]> = [
          [
            "Главы",
            !s || s.chapters === 0 ? "пока нет" : `${s.chapters} · готово ${s.done}`,
          ],
        ];
        if (s && s.words > 0) meta.push(["Объём", `${formatWords(s.words)} слов`]);
        meta.push(["Последняя правка", formatWhen(b.updatedAt ?? b.createdAt)]);
        meta.push(["Следующий шаг", rec ? STAGE_LABELS[rec] : "книга проработана"]);
        return {
          id: b.id,
          title: b.title,
          genre: c?.genre?.trim() || null,
          annotation: annotationFor(c),
          meta,
          seed: titleSeed(b.title),
        };
      }),
    [books, stats, concepts, recommended],
  );

  const IDEA_MIN = 10;

  async function onCreate(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length < IDEA_MIN) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBook({ idea: trimmed });
      navigate(`/books/${created.id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (shelf.length === 0) return;
    if (e.key === "Escape" && openId !== null) {
      e.preventDefault();
      setOpenId(null);
    } else if (openId === null && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setFocusIndex((i) => (i < 0 ? 0 : (i + d + shelf.length) % shelf.length));
    } else if (openId === null && (e.key === "Enter" || e.key === " ") && focusIndex >= 0) {
      e.preventDefault();
      setOpenId(shelf[focusIndex]!.id);
    }
  }

  if (error) {
    return (
      <div className="route">
        <div className="page page-books">
          <p role="alert" className="alert-error">Ошибка: {error}</p>
        </div>
      </div>
    );
  }
  if (books === null) return <PageSkeleton label="Список книг загружается" />;

  const count = books.length;
  const latest = books
    .map((b) => b.updatedAt ?? b.createdAt)
    .sort()
    .at(-1);
  const open = shelf.find((b) => b.id === openId) ?? null;

  return (
    <div className="route shelf-page" data-screen-label="Books list">
      <div className="shelf-head">
        <div>
          <h1>Полка</h1>
          <p className="muted page-sub">
            {count === 0
              ? "Здесь будет ваша первая книга."
              : `${count} ${plural(count, "книга", "книги", "книг")}${latest ? ` · последняя правка ${formatWhen(latest)}` : ""}`}
          </p>
        </div>
        {!creating ? (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            Новая книга
          </button>
        ) : (
          <form onSubmit={onCreate} className="shelf-create" aria-label="Создать новую книгу">
            <textarea
              className="textarea"
              autoFocus
              rows={3}
              placeholder="Одной фразой или сбивчиво, как думается. Название придумается позже."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              aria-label="О чём книга?"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || idea.trim().length < IDEA_MIN}>
              {busy ? "…" : "Начать"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setCreating(false);
                setIdea("");
              }}
              disabled={busy}
            >
              Отмена
            </button>
          </form>
        )}
      </div>

      {count === 0 ? (
        <div className="empty shelf-empty">
          <h3>На полке пока нет книг</h3>
          <p className="muted">
            Нажмите «Новая книга» и опишите идею — замысел, план, главы, канон и стиль будут жить здесь.
          </p>
        </div>
      ) : (
        <>
          <div
            className="showcase"
            tabIndex={0}
            onKeyDown={onKey}
            aria-label="Витрина книг: стрелки — выбрать книгу, Enter — раскрыть, Esc — закрыть"
          >
            {webgl ? (
              <Suspense fallback={<div className="showcase-loading">Расставляю книги…</div>}>
                <ShowcaseScene
                  books={shelf}
                  openId={openId}
                  focusIndex={focusIndex}
                  onPick={setOpenId}
                  onHover={setFocusIndex}
                  onFail={() => setWebgl(false)}
                  reducedMotion={reducedMotion}
                />
              </Suspense>
            ) : (
              <ShelfFlat books={shelf} openId={openId} focusIndex={focusIndex} onPick={setOpenId} />
            )}

            {webgl && openId === null && focusIndex >= 0 && shelf[focusIndex] && (
              <div className="showcase-hint" aria-hidden="true">
                {shelf[focusIndex]!.title}
              </div>
            )}

            {open && (
              <div className="showcase-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOpenId(null)}>
                  Закрыть
                </button>
                <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/books/${open.id}`)}>
                  Открыть книгу
                </button>
              </div>
            )}
          </div>

          {/* Для чтения с экрана и клавиатуры: 3D-сцена сама по себе немая. */}
          {webgl && (
            <>
              <ul className="sr-only" aria-label="Книги на полке">
                {shelf.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setOpenId(b.id)}>
                      {b.title} — раскрыть
                    </button>
                  </li>
                ))}
              </ul>
              <div className="sr-only" aria-live="polite">
                {open && <BookSpread book={open} className="spread-sr" />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
