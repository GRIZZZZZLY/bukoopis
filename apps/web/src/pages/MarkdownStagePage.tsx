import { useEffect, useState } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import { api } from "@/api/client";
import type {
  BookConcept,
  StageId,
  StageState,
  StudioState,
} from "@book-forge/shared";
import { StageStepper } from "@/components/studio/StageStepper";
import {
  StageSkipControl,
  StageOptionalBadge,
} from "@/components/studio/StageSkipControl";
import { AspectRunner } from "@/components/studio/aspect-engine/AspectRunner";
import { PlaybookRunner } from "@/components/studio/aspect-engine/PlaybookRunner";
import { createMarkdownAdapter } from "@/components/studio/aspect-engine/markdownAdapter";
import {
  createLLMMarkdownVariantGenerator,
  createLLMPlaybookGenerator,
} from "@/components/studio/aspect-engine/llmGenerators";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const STAGE_HINTS: Record<"world" | "lore" | "plot", string> = {
  world: "География, фракции, технологии, климат. Внешний слой реальности книги.",
  lore: "Мифы, история, культурные коды. Внутренний слой смыслов.",
  plot: "Опорные сюжетные точки, повороты, арки. Костяк структуры.",
};

const MARKDOWN_STAGES: ReadonlySet<string> = new Set(["world", "lore", "plot"]);

function isMarkdownStage(s: string): s is "world" | "lore" | "plot" {
  return MARKDOWN_STAGES.has(s);
}

export function MarkdownStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } = useParams<{
    bookId: string;
    stageId: string;
  }>();
  const bookId = Number(rawBookId);

  if (!rawStageId || !isMarkdownStage(rawStageId)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "world" | "lore" | "plot" = rawStageId;

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

  const adapter = createMarkdownAdapter(stageId);
  const playbookGenerator = createLLMPlaybookGenerator({ bookId, stageId });
  const variantGenerator = createLLMMarkdownVariantGenerator({
    bookId,
    stageId,
  });

  return (
    <div className="route" data-screen-label={`stage-${stageId}`}>
      <div className="page page-stage">
        <StageStepper
          bookId={bookId}
          concept={concept}
          studioState={studio}
          activeStageId={stageId}
        />

        <div className="page-head">
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
            <Link to={`/books/${bookId}/studio`} className="btn btn-ghost btn-sm">
              ← К Studio
            </Link>
          </div>
        </div>

        {/* Workspace */}
        <div className="card">
          {stage.status === "skipped" ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Этап пропущен. Генерация главы обойдётся без него — вернуть можно в
              любой момент.
            </p>
          ) : stage.aspects.length === 0 ? (
            <PlaybookRunner
              stage={stage}
              revision={studio.revision}
              payloadKind="markdown"
              generator={playbookGenerator}
              onPatch={handlePatch}
            />
          ) : (
            <AspectRunner
              stage={stage}
              revision={studio.revision}
              adapter={adapter}
              generator={variantGenerator}
              onPatch={handlePatch}
            />
          )}
        </div>
      </div>
    </div>
  );
}
