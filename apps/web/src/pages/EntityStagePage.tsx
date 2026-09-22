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
import { EntityStageRunner } from "@/components/studio/aspect-engine/EntityStageRunner";
import { CastCheckPanel } from "@/components/studio/CastCheckPanel";
import { PlaybookRunner } from "@/components/studio/aspect-engine/PlaybookRunner";
import {
  createLLMEntityVariantGenerator,
  createLLMPlaybookGenerator,
} from "@/components/studio/aspect-engine/llmGenerators";

const STAGE_LABELS: Record<"characters" | "items", string> = {
  characters: "Персонажи",
  items: "Предметы",
};

const STAGE_HINTS: Record<"characters" | "items", string> = {
  characters:
    "Действующие лица: цели, конфликты, голос, биография. Принятые попадут в канон книги — их будет видеть автор глав и проверять критики.",
  items:
    "Объекты с сюжетным весом: артефакты, документы, ключи. Принятые попадут в канон книги.",
};

function isEntityStage(s: string): s is "characters" | "items" {
  return s === "characters" || s === "items";
}

export function EntityStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } = useParams<{
    bookId: string;
    stageId: string;
  }>();
  const bookId = Number(rawBookId);

  if (!rawStageId || !isEntityStage(rawStageId)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "characters" | "items" = rawStageId;

  const [studio, setStudio] = useState<StudioState | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Имена утверждённого состава: в отчёте проверки лежат номера героев. */
  const [castNames, setCastNames] = useState<ReadonlyMap<number, string>>(new Map());
  /** Растёт после каждой материализации: состав в каноне изменился, и снимок
   *  имён надо перечитать — иначе проверка различий видела ноль героев до
   *  перезагрузки страницы (F22 ревью 2026-09-22). */
  const [castEpoch, setCastEpoch] = useState(0);

  useEffect(() => {
    if (stageId !== "characters" || !Number.isFinite(bookId)) return;
    let alive = true;
    api
      .listCharacters(bookId)
      .then((list) => {
        if (alive) setCastNames(new Map(list.map((ch) => [ch.id, ch.canonicalName])));
      })
      // Список нужен только подписям в отчёте: без него панель покажет
      // номера, но экран этапа не сломается.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bookId, stageId, castEpoch]);

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
      stages: { ...studio.stages, [stageId as StageId]: nextStage },
    };
    const saved = await api.patchStudioState(
      bookId,
      expectedRevision,
      nextStudio,
    );
    setStudio(saved);
    const savedStage = saved.stages[stageId as StageId];
    if (!savedStage) throw new Error("stage missing in saved state");
    return { stage: savedStage, revision: saved.revision };
  }

  async function handleReloadStage(): Promise<{ stage: StageState; revision: number }> {
    const fresh = await api.getStudioState(bookId);
    setStudio(fresh);
    const freshStage = fresh.stages[stageId as StageId];
    if (!freshStage) throw new Error("stage missing in saved state");
    return { stage: freshStage, revision: fresh.revision };
  }

  async function handleMaterialize(
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
      }>;
    },
  ) {
    const result = await api.materializeEntitySet(bookId, aspectId, body);
    setCastEpoch((n) => n + 1);
    return result;
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

  const stage: StageState = studio.stages[stageId as StageId] ?? {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };

  const playbookGenerator = createLLMPlaybookGenerator({
    bookId,
    stageId: stageId as StageId,
  });
  const entityGenerator = createLLMEntityVariantGenerator({ bookId, stageId });

  return (
    <div className="route" data-screen-label={`stage-${stageId}`}>
      <div className="page page-stage">
        <StageStepper
          bookId={bookId}
          concept={concept}
          studioState={studio}
          activeStageId={stageId as StageId}
        />

        <div className="page-head">
          <div>
            <h1>
              {STAGE_LABELS[stageId]}
              <StageOptionalBadge stageId={stageId as StageId} />
            </h1>
            <p className="muted page-sub">{STAGE_HINTS[stageId]}</p>
          </div>
          <div className="flex items-center gap-2">
            <StageSkipControl
              stageId={stageId as StageId}
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
              Этап пропущен. Канон останется пустым — вернуть можно в любой
              момент.
            </p>
          ) : stage.aspects.length === 0 ? (
            <PlaybookRunner
              stage={stage}
              revision={studio.revision}
              payloadKind="entity_set"
              generator={playbookGenerator}
              onPatch={handlePatch}
            />
          ) : (
            <EntityStageRunner
              stage={stage}
              revision={studio.revision}
              stageId={stageId}
              generator={entityGenerator}
              onPatch={handlePatch}
              onReloadStage={handleReloadStage}
              onMaterialize={handleMaterialize}
            />
          )}
          {/* Проверка различий — только для героев: у предметов сравнивать
              первый ход не с чем (ТЗ 9.1). */}
          {stageId === "characters" && (
            <CastCheckPanel
              bookId={bookId}
              names={castNames}
              characterCount={castNames.size}
            />
          )}
        </div>
      </div>
    </div>
  );
}
