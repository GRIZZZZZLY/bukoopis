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
import { computeRecommendedNextStage } from "@book-forge/shared";
import { StageCard } from "@/components/studio/StageCard";
import { WarningsFeed } from "@/components/studio/WarningsFeed";
import { ConceptForm } from "@/components/studio/concept/ConceptForm";

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
        <Link to={`/books/${bookId}`} className="text-sm underline">
          ← к книге
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
            return (
              <StageCard
                key={id}
                stageId={id}
                label={STAGE_LABELS[id]}
                status={stage?.status ?? "not_started"}
                recommended={recommended === id}
              />
            );
          })}
        </div>
      </section>

      <p className="text-xs text-[var(--color-muted-foreground)]">
        Phase A: dashboard shell. Контент стадий появится в фазах B–H.
      </p>
    </main>
  );
}
