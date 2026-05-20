import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/api/client";
import { STAGE_IDS } from "@book-forge/shared";
import type {
  BookConcept,
  StageId,
  StudioState,
  StudioWarning,
} from "@book-forge/shared";
import { computeRecommendedNextStage, computeStudioProgress } from "@book-forge/shared";
import { StageCard } from "@/components/studio/StageCard";
import { WarningsFeed } from "@/components/studio/WarningsFeed";
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

export function StudioPage() {
  const { bookId: rawId } = useParams<{ bookId: string }>();
  const bookId = Number(rawId);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [warnings, setWarnings] = useState<StudioWarning[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    let alive = true;
    (async () => {
      try {
        const [c, s, w] = await Promise.all([
          api.getConcept(bookId),
          api.getStudioState(bookId),
          api.getStudioWarnings(bookId),
        ]);
        if (!alive) return;
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
      <main className="max-w-5xl mx-auto p-8">
        <p
          role="alert"
          className="text-sm rounded-md px-3 py-2 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
        >
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!concept || !studio || !warnings) {
    return (
      <main className="max-w-5xl mx-auto p-8 text-sm text-[var(--color-text-muted)]">
        Загрузка…
      </main>
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

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-8">
      {/* hero */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1
            className="text-[28px] leading-tight"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Studio
          </h1>
          <p className="lw-mono text-[11px] text-[var(--color-text-faint)]">
            книга #{bookId}
          </p>
        </div>
        <nav
          aria-label="Навигация по студии"
          className="flex gap-2 text-sm"
        >
          <Link
            to={`/books/${bookId}/studio/settings`}
            className="lw-pill hover:text-[var(--color-text)] transition-colors"
          >
            ⚙ Настройки
          </Link>
          <Link
            to={`/books/${bookId}/studio/chapters`}
            className="lw-pill hover:text-[var(--color-text)] transition-colors"
          >
            📚 Главы
          </Link>
        </nav>
      </header>

      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId="concept"
      />

      {/* progress + Продолжить */}
      <section
        aria-label="Прогресс книги"
        className="lw-card flex items-center gap-4 flex-wrap"
      >
        <div className="flex flex-col gap-1.5 flex-1 min-w-[14rem]">
          <span
            className="text-sm text-[var(--color-text-strong)]"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
          >
            Готово {progress.doneCount}/7
            {progress.recommended
              ? ` · Далее: ${STAGE_LABELS[progress.recommended]}`
              : " · Книга проработана"}
          </span>
          <div
            className="h-2 rounded bg-[var(--color-surface-2)] overflow-hidden border border-[var(--color-border-soft)]"
            role="progressbar"
            aria-label="Прогресс книги"
            aria-valuemin={0}
            aria-valuemax={7}
            aria-valuenow={progress.doneCount}
          >
            <div
              className="h-full bg-[var(--color-brass)] transition-[width] duration-200"
              style={{ width: `${(progress.doneCount / 7) * 100}%` }}
            />
          </div>
        </div>
        <Link
          to={stageRoute(bookId, continueStage)}
          className="lw-btn"
          data-variant="primary"
        >
          Продолжить →
        </Link>
      </section>

      {/* warnings */}
      {warnings.length > 0 && (
        <section
          aria-labelledby="warnings-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="warnings-heading"
            className="lw-cap-upper"
          >
            Предупреждения
          </h2>
          <WarningsFeed warnings={warnings} />
        </section>
      )}

      {/* concept */}
      <section aria-labelledby="concept-heading" className="flex flex-col gap-3">
        <h2
          id="concept-heading"
          className="text-[22px]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Концепт
        </h2>
        <ConceptForm
          initialConcept={concept}
          onSave={handleSaveConcept}
          onRefine={handleRefine}
        />
      </section>

      {/* stages */}
      <section aria-labelledby="stages-heading" className="flex flex-col gap-3">
        <h2
          id="stages-heading"
          className="text-[22px]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Стадии
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      </section>
    </main>
  );
}
