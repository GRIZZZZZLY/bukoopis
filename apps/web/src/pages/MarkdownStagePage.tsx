import { useEffect, useState } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import {
  isDocumentStage,
  stageIdSchema,
  type BookConcept,
  type StageId,
  type StageState,
  type StudioState,
} from "@book-forge/shared";
import { StageStepper } from "@/components/studio/StageStepper";
import {
  StageSkipControl,
  StageOptionalBadge,
} from "@/components/studio/StageSkipControl";
import { DocumentStageRunner } from "@/components/studio/aspect-engine/DocumentStageRunner";
import { STAGE_LABELS } from "@/lib/labels";


const STAGE_HINTS: Record<"world" | "lore", string> = {
  world: "География, фракции, технологии, климат. Внешний слой реальности книги.",
  lore: "Мифы, история, культурные коды. Внутренний слой смыслов.",
};

export function MarkdownStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } = useParams<{
    bookId: string;
    stageId: string;
  }>();
  const bookId = Number(rawBookId);

  // Список документных этапов живёт в @book-forge/shared, а не третьей копией
  // здесь: две копии («мир, лор») уже разошлись бы молча, и этап оказался бы
  // документным для одного читателя и аспектным для другого.
  const stageParse = stageIdSchema.safeParse(rawStageId);
  if (!stageParse.success || !isDocumentStage(stageParse.data)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "world" | "lore" = stageParse.data;

  const [studio, setStudio] = useState<StudioState | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    let alive = true;
    (async () => {
      try {
        const [s, c] = await Promise.all([
          api.getStudioState(bookId),
          api.getConcept(bookId),
        ]);
        if (alive) {
          setStudio(s);
          setConcept(c);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  async function handlePatch(
    expectedRevision: number,
    nextStage: StageState,
  ): Promise<{ stage: StageState; revision: number }> {
    if (!studio) throw new Error("studio state not loaded");
    const nextStudio: StudioState = {
      ...studio,
      stages: { ...studio.stages, [stageId]: nextStage },
    };
    const saved = await api.patchStudioState(
      bookId,
      expectedRevision,
      nextStudio,
    );
    setStudio(saved);
    const savedStage = saved.stages[stageId];
    if (!savedStage) throw new Error("stage missing in saved state");
    return { stage: savedStage, revision: saved.revision };
  }

  /** Перечитать этап после конфликта ревизии: автор мог принять соседний
   *  раздел, пока шла генерация этого (В11). Раннер наложит свой раздел на
   *  свежее состояние и повторит — чужая работа при этом остаётся. */
  async function handleReloadStage(): Promise<{
    stage: StageState;
    revision: number;
  }> {
    const fresh = await api.getStudioState(bookId);
    setStudio(fresh);
    const freshStage = fresh.stages[stageId] ?? {
      status: "not_started" as const,
      playbookGenerated: false,
      aspects: [],
    };
    return { stage: freshStage, revision: fresh.revision };
  }

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
  if (!studio || !concept) {
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );
  }

  const stage: StageState = studio.stages[stageId] ?? {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };

  return (
    <div className="route" data-screen-label={`stage-${stageId}`}>
      <div className="studio-room">
        <StageStepper
          bookId={bookId}
          concept={concept}
          studioState={studio}
          activeStageId={stageId}
        />

        <div className="studio-body">
        <div className="stage-head">
          <div>
            <h1>
              {STAGE_LABELS[stageId]}
              <StageOptionalBadge stageId={stageId} />
            </h1>
            <p className="muted page-sub">{STAGE_HINTS[stageId]}</p>
          </div>
          <div className="flex items-center gap-2">
            <StageSkipControl
              stageId={stageId}
              stage={stage}
              revision={studio.revision}
              onPatch={handlePatch}
            />
          </div>
        </div>

        {/* Workspace */}
        <div className="card">
          {stage.status === "skipped" ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Этап отмечен как «не нужен». Генерация главы обойдётся без него
              — вернуть можно в любой момент.
            </p>
          ) : (
            <DocumentStageRunner
              bookId={bookId}
              stageId={stageId}
              stageLabel={STAGE_LABELS[stageId]}
              stage={stage}
              revision={studio.revision}
              onPatch={handlePatch}
              onReloadStage={handleReloadStage}
            />
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
