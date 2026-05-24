import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Cog, List, ArrowRight } from "lucide-react";
import { api } from "@/api/client";
import {
  STAGE_IDS,
  computeRecommendedNextStage,
  computeStudioProgress,
} from "@book-forge/shared";
import type {
  Book,
  BookConcept,
  StageId,
  StudioState,
  StudioWarning,
} from "@book-forge/shared";
import { StageCard } from "@/components/studio/StageCard";
import { ConceptForm } from "@/components/studio/concept/ConceptForm";
import { StageStepper } from "@/components/studio/StageStepper";
import { stageRoute } from "@/lib/studio-routes";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
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

export function StudioPage() {
  const { bookId: rawId } = useParams<{ bookId: string }>();
  const bookId = Number(rawId);
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [warnings, setWarnings] = useState<StudioWarning[] | null>(null);
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
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px" }}>
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
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "32px",
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          Загрузка…
        </div>
      </div>
    );
  }

  const recommended = computeRecommendedNextStage({
    concept,
    studioState: studio,
  });
  const progress = computeStudioProgress(concept, studio);
  const continueStage = progress.recommended ?? "chapters";

  async function handleSaveConcept(next: BookConcept): Promise<BookConcept> {
    const saved = await api.patchConcept(bookId, next);
    setConcept(saved);
    setWarnings(await api.getStudioWarnings(bookId));
    return saved;
  }

  async function handleRefine(
    field: "protagonist" | "conflict" | "stakes" | "logline",
    draft?: string,
  ) {
    return await api.refineConceptField(bookId, field, draft);
  }

  const title = book?.title ?? `Книга #${bookId}`;
  const metaLine = book
    ? `${book.language === "ru" ? "Русский" : book.language} · ${STATUS_RU[book.status] ?? book.status} · последняя правка ${relativeTime(book.updatedAt ?? book.createdAt)}`
    : "Книга загружается…";

  return (
    <div className="route" data-screen-label="Studio dashboard">
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "32px 32px 96px",
        }}
      >
        {/* Hero */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>
              Студия
            </div>
            <h1
              className="font-display"
              style={{
                fontSize: 32,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
                letterSpacing: "-0.015em",
              }}
            >
              {title}
            </h1>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 6 }}
            >
              {metaLine}
            </div>
          </div>
          <nav
            aria-label="Навигация по студии"
            style={{ display: "flex", gap: 8 }}
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/books/${bookId}/studio/settings`)}
            >
              <Cog size={14} aria-hidden="true" />
              Настройки
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/books/${bookId}/studio/chapters`)}
            >
              <List size={14} aria-hidden="true" />
              Главы
            </button>
          </nav>
        </div>

        {/* Stage stepper bar */}
        <div
          style={{
            marginBottom: 28,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          <StageStepper
            bookId={bookId}
            concept={concept}
            studioState={studio}
            activeStageId="concept"
          />
        </div>

        {/* Progress panel */}
        <div
          className="panel"
          style={{
            padding: 24,
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 32,
            flexWrap: "wrap",
          }}
          aria-label="Прогресс книги"
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 10,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                className="font-display"
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  color: "var(--color-text-strong)",
                }}
              >
                {`Готово ${progress.doneCount}/7`}
              </span>
              <div className="text-muted" style={{ fontSize: 13 }}>
                {progress.recommended ? (
                  <>
                    Далее:{" "}
                    <span style={{ color: "var(--color-text)" }}>
                      {STAGE_LABELS[progress.recommended]}
                    </span>
                  </>
                ) : (
                  "Книга проработана"
                )}
              </div>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="Прогресс книги"
              aria-valuemin={0}
              aria-valuemax={7}
              aria-valuenow={progress.doneCount}
            >
              <div
                className="fill"
                style={{ width: `${(progress.doneCount / 7) * 100}%` }}
              />
            </div>
          </div>
          <Link
            to={stageRoute(bookId, continueStage)}
            className="btn btn-primary"
            style={{ textDecoration: "none" }}
          >
            Продолжить
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div
            className="panel"
            style={{ padding: 4, marginBottom: 24 }}
            aria-labelledby="warnings-heading"
          >
            <h2 id="warnings-heading" className="sr-only">
              Предупреждения
            </h2>
            {warnings.map((w, i) => {
              const tone: "amber" | "blue" | "red" | "green" =
                w.severity === "danger"
                  ? "red"
                  : w.severity === "warning"
                    ? "amber"
                    : "blue";
              return (
                <div
                  key={w.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "12px 16px",
                    borderTop:
                      i === 0 ? "none" : "1px solid var(--color-border-soft)",
                  }}
                >
                  <span
                    className={`dot sev-${tone}`}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      flexShrink: 0,
                      marginTop: 5,
                      display: "inline-block",
                    }}
                    aria-hidden="true"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: "var(--color-text-strong)",
                        fontWeight: 500,
                        fontSize: 13,
                      }}
                    >
                      {w.message}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Concept */}
        <div
          className="panel paper"
          style={{ padding: 28, marginTop: 8, marginBottom: 8 }}
        >
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <h2
              className="font-display"
              style={{
                fontSize: 22,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
              }}
            >
              Концепт
            </h2>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginBottom: 12 }}
            >
              Опорный документ книги. Все агенты сверяются с ним при работе.
            </div>
            <ConceptForm
              initialConcept={concept}
              onSave={handleSaveConcept}
              onRefine={handleRefine}
            />
          </div>
        </div>

        {/* Stages grid */}
        <div style={{ marginTop: 28, marginBottom: 12 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: "0 0 4px",
              color: "var(--color-text-strong)",
            }}
          >
            Этапы
          </h2>
          <div
            className="text-muted"
            style={{ fontSize: 13, marginBottom: 16 }}
          >
            Кликните, чтобы перейти к проработке.
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {STAGE_IDS.map((id) => {
            const stage = studio.stages[id];
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
                status={stage?.status ?? "not_started"}
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
