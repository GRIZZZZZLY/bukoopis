import type { StageId } from "@book-forge/shared";
import { Link } from "react-router-dom";
import {
  Feather,
  Map as MapIcon,
  Layers,
  Users,
  Box,
  ListChecks,
  BookOpen,
  Check,
  Circle,
  Play,
  type LucideIcon,
} from "lucide-react";

type StageStatus = "not_started" | "in_progress" | "complete" | "skipped";

interface StageCardProps {
  stageId: StageId;
  label: string;
  status: StageStatus;
  recommended: boolean;
  /** When set, the entire card becomes a Link to this URL. */
  href?: string;
}

const STAGE_ICON: Record<StageId, LucideIcon> = {
  concept: Feather,
  world: MapIcon,
  lore: Layers,
  characters: Users,
  items: Box,
  plot: ListChecks,
  chapters: BookOpen,
};

const STATUS_INFO: Record<
  StageStatus,
  { label: string; css: string; tone: string }
> = {
  complete: { label: "Готово", css: "complete", tone: " pill-green" },
  in_progress: { label: "В работе", css: "in_progress", tone: " pill-brass" },
  not_started: { label: "Не начато", css: "todo", tone: "" },
  skipped: { label: "Пропущено", css: "skipped", tone: "" },
};

function glyph(status: StageStatus) {
  switch (status) {
    case "complete":
      return <Check size={11} aria-hidden="true" />;
    case "in_progress":
      return <Play size={11} aria-hidden="true" />;
    case "skipped":
      return <span aria-hidden="true">↷</span>;
    default:
      return <Circle size={6} aria-hidden="true" />;
  }
}

/** Library-Warm stage tile. Reference: extracted app/stepper.jsx StageCard. */
export function StageCard({
  stageId,
  label,
  status,
  recommended,
  href,
}: StageCardProps) {
  const info = STATUS_INFO[status];
  const Icon = STAGE_ICON[stageId];
  const cls = `stagecard stagecard-${info.css}${recommended ? " stagecard-reco" : ""}`;

  const inner = (
    <>
      <div className="stagecard-top">
        <span className="stagecard-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span
          className={`stagecard-status pill${info.tone}`}
          aria-label={`status-${status}`}
        >
          {glyph(status)}
          {info.label}
        </span>
      </div>
      <h3 className="stagecard-title">{label}</h3>
      <div className="stagecard-meta cap mono">
        {recommended && (
          <span className="stagecard-reco-flag">↳ продолжить</span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link to={href} data-stage-id={stageId} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <div data-stage-id={stageId} className={cls}>
      {inner}
    </div>
  );
}
