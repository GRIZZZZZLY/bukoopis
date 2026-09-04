import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, BookOpen, Cog } from "lucide-react";
import { api } from "@/api/client";
import {
  STAGE_IDS,
  computeRecommendedNextStage,
  computeStudioProgress,
  effectiveStageStatus,
} from "@book-forge/shared";
import type {
  Book,
  BookConcept,
  ChapterProgress,
  StageId,
  StudioState,
  StudioWarning,
} from "@book-forge/shared";
import { StageCard } from "@/components/studio/StageCard";
import { ConceptStage } from "@/components/studio/concept/ConceptStage";
import { StageStepper } from "@/components/studio/StageStepper";
import { stageRoute } from "@/lib/studio-routes";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const STATUS_RU: Record<string, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  if (d < 7) return `${d} дн. назад`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function WarningsFeed({ warnings }: { warnings: StudioWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="warn-feed">
      {warnings.map((w) => {
        const red = w.severity === "danger";
        return (
          <div
            key={w.id}
            className={`warn ${red ? "warn-red" : ""}`}
            {...(red ? { role: "alert" as const } : {})}
          >
            <span
              className={`dot sev-${red ? "red" : "amber"}`}
              style={{ width: 8, height: 8 }}
              aria-hidden="true"
            />
            <div className="warn-body">
              <div className="warn-title">{w.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StudioPage() {
  const { bookId: rawId } = useParams<{ bookId: string }>();
  const bookId = Number(rawId);

  const [book, setBook] = useState<Book | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [warnings, setWarnings] = useState<StudioWarning[] | null>(null);
  const [chapters, setChapters] = useState<ChapterProgress | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    let alive = true;
    (async () => {
      try {
        // Book fetch is optional — fall back if mock missing.
        let b: Book | null = null;
        try {
          b = api.getBook ? await api.getBook(bookId) : null;
        } catch {
          b = null;
        }
        // The chapters stage is the one whose progress lives outside studio_state.
        let ch: ChapterProgress | undefined;
        try {
          const list = api.listChapters ? await api.listChapters(bookId) : null;
          if (list) {
            ch = {
              total: list.length,
              finalized: list.filter((x) => x.status === "final").length,
            };
          }
        } catch {
          ch = undefined;
        }
        const [c, s, w] = await Promise.all([
          api.getConcept(bookId),
          api.getStudioState(bookId),
          api.getStudioWarnings(bookId),
        ]);
        if (!alive) return;
        setBook(b);
        setConcept(c);
        setStudio(s);
        setWarnings(w);
        setChapters(ch);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

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
  if (!concept || !studio || !warnings) {
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );
  }

  const recommended = computeRecommendedNextStage({
    concept,
    studioState: studio,
    ...(chapters !== undefined ? { chapters } : {}),
  });
  const progress = computeStudioProgress(concept, studio, chapters);
  const continueStage = progress.recommended ?? "chapters";

  function handleConceptChange(next: BookConcept) {
    setConcept(next);
    // Locking renames the book and moves the recommendation; both live outside the concept.
    void api.getBook(bookId).then(setBook).catch(() => {});
    void api.getStudioWarnings(bookId).then(setWarnings).catch(() => {});
  }

  const title = book?.title ?? `Книга #${bookId}`;
  const metaLine = book
    ? ` · ${book.language === "ru" ? "Русский" : book.language} · ${STATUS_RU[book.status] ?? book.status} · последняя правка ${relativeTime(book.updatedAt ?? book.createdAt)}`
    : "";

  return (
    <div className="route" data-screen-label="Studio dashboard">
      <div className="page page-studio">
        <div className="page-head">
          <div>
            <h1>Studio</h1>
            <p className="muted page-sub">
              {title}
              {metaLine}
            </p>
          </div>
          <nav aria-label="Навигация по студии" className="studio-nav">
            <Link to={`/books/${bookId}/studio/settings`}>
              <Cog size={14} aria-hidden="true" /> Настройки
            </Link>
            <Link to={`/books/${bookId}/studio/chapters`}>
              <BookOpen size={14} aria-hidden="true" /> Главы
            </Link>
          </nav>
        </div>

        <StageStepper
          bookId={bookId}
          concept={concept}
          studioState={studio}
          activeStageId="concept"
          {...(chapters !== undefined ? { chapters } : {})}
        />

        <div className="card prog-block" aria-label="Прогресс книги">
          <div className="prog-row">
            <div
              className="pbar"
              role="progressbar"
              aria-label="Прогресс книги"
              aria-valuemin={0}
              aria-valuemax={7}
              aria-valuenow={progress.doneCount}
            >
              <div
                className="pbar-fill"
                style={{ width: `${(progress.doneCount / 7) * 100}%` }}
              />
            </div>
          </div>
          <div className="prog-foot">
            <div className="prog-meta">
              <span className="strong tabular">
                {`Готово ${progress.doneCount}/7`}
              </span>
              {progress.recommended ? (
                <>
                  <span className="muted">· Далее:</span>
                  <span className="strong">
                    {STAGE_LABELS[progress.recommended]}
                  </span>
                </>
              ) : (
                <span className="muted">· Книга проработана</span>
              )}
            </div>
            <Link
              to={stageRoute(bookId, continueStage)}
              className="btn btn-primary"
            >
              Продолжить
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <WarningsFeed warnings={warnings} />

        <div className="card concept">
          <div className="concept-head">
            <h3>Замысел книги</h3>
            <span className="cap-upper">Этап 1 из 7</span>
          </div>
          <ConceptStage bookId={bookId} concept={concept} onConceptChange={handleConceptChange} />
        </div>

        <div className="stagecard-grid">
          {STAGE_IDS.map((id) => {
            const href =
              id === "world" ||
              id === "lore" ||
              id === "characters" ||
              id === "items" ||
              id === "plot"
                ? `/books/${bookId}/studio/${id}`
                : id === "chapters"
                  ? `/books/${bookId}/studio/chapters`
                  : undefined;
            return (
              <StageCard
                key={id}
                stageId={id}
                label={STAGE_LABELS[id]}
                status={effectiveStageStatus(concept, studio, id, chapters)}
                recommended={recommended === id}
                {...(href !== undefined ? { href } : {})}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
