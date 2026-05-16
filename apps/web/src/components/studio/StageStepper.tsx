import { Link } from "react-router-dom";
import {
  STAGE_IDS,
  computeStudioProgress,
  type BookConcept,
  type StageId,
  type StudioState,
} from "@book-forge/shared";
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

const STATUS_ICON: Record<"done" | "current" | "todo", string> = {
  done: "✓",
  current: "▶",
  todo: "●",
};

interface StageStepperProps {
  bookId: number;
  concept: BookConcept;
  studioState: StudioState;
  /** Highlight "you are here"; undefined for non-stage pages (e.g. settings). */
  activeStageId?: StageId;
}

export function StageStepper({
  bookId,
  concept,
  studioState,
  activeStageId,
}: StageStepperProps) {
  const progress = computeStudioProgress(concept, studioState);
  const byId = new Map(progress.stages.map((s) => [s.id, s]));

  return (
    <nav
      aria-label="Этапы книги"
      className="flex items-center gap-2 flex-wrap text-sm"
    >
      <span
        className="text-xs font-medium text-[var(--color-muted-foreground)] mr-1"
        aria-label={`Готово ${progress.doneCount} из 7`}
      >
        {progress.doneCount}/7
      </span>
      {STAGE_IDS.map((id) => {
        const stage = byId.get(id);
        const status = stage?.status ?? "todo";
        const skipped = studioState.stages[id]?.status === "skipped";
        const isActive = activeStageId === id;
        const icon = skipped ? "↷" : STATUS_ICON[status];
        return (
          <Link
            key={id}
            to={stageRoute(bookId, id)}
            data-stage-id={id}
            {...(isActive ? { "aria-current": "step" as const } : {})}
            className={
              "inline-flex items-center gap-1 rounded px-2 py-1 " +
              (isActive
                ? "bg-blue-100 text-blue-800 font-medium"
                : "hover:bg-[var(--color-muted)] text-[var(--color-foreground)]")
            }
          >
            <span aria-hidden="true">{icon}</span>
            <span>{STAGE_LABELS[id]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
