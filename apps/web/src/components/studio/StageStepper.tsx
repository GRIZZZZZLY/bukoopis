import { Link } from "react-router-dom";
import { Check, Circle, Play } from "lucide-react";
import {
  STAGE_IDS,
  computeStudioProgress,
  type BookConcept,
  type ChapterProgress,
  type StageId,
  type StudioState,
} from "@book-forge/shared";
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

type StepStatus = "complete" | "in_progress" | "todo" | "skipped";

const PROGRESS_TO_STEP: Record<"done" | "current" | "todo", StepStatus> = {
  done: "complete",
  current: "in_progress",
  todo: "todo",
};

function glyph(status: StepStatus) {
  switch (status) {
    case "complete":
      return <Check aria-hidden="true" />;
    case "in_progress":
      return <Play aria-hidden="true" />;
    case "skipped":
      return <span aria-hidden="true">↷</span>;
    default:
      return <Circle aria-hidden="true" />;
  }
}

interface StageStepperProps {
  bookId: number;
  concept: BookConcept;
  studioState: StudioState;
  /** Highlight "you are here"; undefined for non-stage pages (e.g. settings). */
  activeStageId?: StageId;
  /** Omit on pages that have not loaded the chapter list; the chapters step
   *  then simply never reads as done. */
  chapters?: ChapterProgress;
}

/** Reference: extracted app/stepper.jsx (.stepper / .step idiom). */
export function StageStepper({
  bookId,
  concept,
  studioState,
  activeStageId,
  chapters,
}: StageStepperProps) {
  const progress = computeStudioProgress(concept, studioState, chapters);
  const byId = new Map(progress.stages.map((s) => [s.id, s]));

  return (
    <nav className="stepper" aria-label="Этапы книги">
      <ol className="stepper-list">
        {STAGE_IDS.map((id, i) => {
          const skipped = studioState.stages[id]?.status === "skipped";
          const status: StepStatus = skipped
            ? "skipped"
            : PROGRESS_TO_STEP[byId.get(id)?.status ?? "todo"];
          const active = activeStageId === id;
          return (
            <li
              key={id}
              className={`step step-${status}${active ? " step-active" : ""}`}
            >
              <Link
                to={stageRoute(bookId, id)}
                className="step-inner"
                data-stage-id={id}
                {...(active ? { "aria-current": "step" as const } : {})}
              >
                <span className="step-num mono">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="step-glyph">{glyph(status)}</span>
                <span className="step-label">{STAGE_LABELS[id]}</span>
              </Link>
              {i < STAGE_IDS.length - 1 && (
                <span className="step-rail" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
      <div
        className="stepper-counter mono"
        aria-label={`Готово ${progress.doneCount} из 7`}
      >
        <span className="strong">{progress.doneCount}</span>
        <span className="faint">/7</span>
      </div>
    </nav>
  );
}
