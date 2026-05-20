import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { api } from "@/api/client";
import type { BookConcept, StageId, StageState, StudioState } from "@book-forge/shared";
import { StageStepper } from "@/components/studio/StageStepper";
import { AspectRunner } from "@/components/studio/aspect-engine/AspectRunner";
import { PlaybookRunner } from "@/components/studio/aspect-engine/PlaybookRunner";
import { createMarkdownAdapter } from "@/components/studio/aspect-engine/markdownAdapter";
import {
  createLLMMarkdownVariantGenerator,
  createLLMPlaybookGenerator,
} from "@/components/studio/aspect-engine/llmGenerators";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const MARKDOWN_STAGES: ReadonlySet<string> = new Set(["world", "lore", "plot"]);

function isMarkdownStage(s: string): s is "world" | "lore" | "plot" {
  return MARKDOWN_STAGES.has(s);
}

export function MarkdownStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } =
    useParams<{ bookId: string; stageId: string }>();
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
      stages: {
        ...studio.stages,
        [stageId]: nextStage,
      },
    };
    const saved = await api.patchStudioState(bookId, expectedRevision, nextStudio);
    setStudio(saved);
    const savedStage = saved.stages[stageId];
    if (!savedStage) throw new Error("stage missing in saved state");
    return { stage: savedStage, revision: saved.revision };
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!studio || !concept) {
    return <main className="max-w-5xl mx-auto p-8">Загрузка…</main>;
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
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId={stageId}
      />
      <h1
        className="text-[28px] leading-tight"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
      >
        {STAGE_LABELS[stageId]}
      </h1>

      {stage.aspects.length === 0 ? (
        <PlaybookRunner
          stage={stage}
          revision={studio.revision}
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
    </main>
  );
}
