import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  STAGE_IDS,
  effectiveStageStatus,
  type BookConcept,
  type ChapterProgress,
  type StageId,
  type StudioState,
} from "@book-forge/shared";
import { stageRoute } from "@/lib/studio-routes";
import { STAGE_LABELS } from "@/lib/labels";
import { stageStatusLabel } from "@/components/book/StageStatus";

interface StageStepperProps {
  bookId: number;
  concept: BookConcept;
  studioState: StudioState;
  /** Подсветка «вы здесь». */
  activeStageId?: StageId;
  /** Без списка глав этап «Главы» просто никогда не читается готовым. */
  chapters?: ChapterProgress;
  /** План утверждён — этап «План» пройден. Без признака — прежнее поведение. */
  planApproved?: boolean;
  /** Правый край полосы: «Пропустить этап» или пояснение. */
  aside?: ReactNode;
}

/** Полоса этапов Мастерской — единственная навигация внутри неё. */
export function StageStepper({
  bookId,
  concept,
  studioState,
  activeStageId,
  chapters,
  planApproved,
  aside,
}: StageStepperProps) {
  const plan = planApproved !== undefined ? { approved: planApproved } : undefined;
  return (
    <nav className="stepper" aria-label="Этапы книги">
      <ol className="stepper-list">
        {STAGE_IDS.map((id, i) => {
          const status = effectiveStageStatus(concept, studioState, id, chapters, plan);
          const active = activeStageId === id;
          return (
            <li key={id} className={`step step-${status}${active ? " step-active" : ""}`}>
              <Link
                to={stageRoute(bookId, id)}
                className="step-inner"
                data-stage-id={id}
                {...(active ? { "aria-current": "step" as const } : {})}
              >
                <span className="step-num mono">{i + 1}</span>
                <span className="step-text">
                  <span className="step-label">{STAGE_LABELS[id]}</span>
                  <span className="step-status">{stageStatusLabel(status)}</span>
                </span>
              </Link>
              {i < STAGE_IDS.length - 1 && (
                <span className="step-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {aside && <div className="stepper-aside">{aside}</div>}
    </nav>
  );
}
