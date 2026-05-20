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
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!concept || !studio || !warnings) {
    return <main className="max-w-5xl mx-auto p-8">Загрузка…</main>;
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
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Studio</h1>
        <nav aria-label="Навигация по студии" className="flex gap-3 text-sm">
          <Link
            to={`/books/${bookId}/studio/settings`}
            className="underline"
          >
            ⚙ Настройки
          </Link>
          <Link
            to={`/books/${bookId}/studio/chapters`}
            className="underline"
          >
            📚 Главы
          </Link>
        </nav>
      </div>

      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId="concept"
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="h-2 flex-1 min-w-[8rem] rounded bg-[var(--color-muted)] overflow-hidden"
          role="progressbar"
          aria-label="Прогресс книги"
          aria-valuemin={0}
          aria-valuemax={7}
          aria-valuenow={progress.doneCount}
        >
          <div
            className="h-full bg-[var(--color-brass)]"
            style={{ width: `${(progress.doneCount / 7) * 100}%` }}
          />
        </div>
        <span className="text-sm text-[var(--color-muted-foreground)]">
          Готово {progress.doneCount}/7
          {progress.recommended
            ? ` · Далее: ${STAGE_LABELS[progress.recommended]}`
            : " · Книга проработана"}
        </span>
        <Link
          to={stageRoute(bookId, continueStage)}
          className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] transition-colors"
        >
          Продолжить →
        </Link>
      </div>

      <section aria-labelledby="warnings-heading" className="flex flex-col gap-2">
        <h2 id="warnings-heading" className="text-lg font-semibold">
          Предупреждения
        </h2>
        <WarningsFeed warnings={warnings} />
      </section>

      <ConceptForm
        initialConcept={concept}
        onSave={handleSaveConcept}
        onRefine={handleRefine}
      />

      <section aria-labelledby="stages-heading" className="flex flex-col gap-3">
        <h2 id="stages-heading" className="text-lg font-semibold">
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
