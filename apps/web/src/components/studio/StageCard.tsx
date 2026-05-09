import type { StageId } from "@book-forge/shared";
import { Link } from "react-router-dom";

interface StageCardProps {
  stageId: StageId;
  label: string;
  status: "not_started" | "in_progress" | "complete" | "skipped";
  recommended: boolean;
  /** When set, the entire card becomes a Link to this URL. */
  href?: string;
}

const STATUS_ICON: Record<StageCardProps["status"], string> = {
  not_started: "●",
  in_progress: "▶",
  complete: "✓",
  skipped: "↷",
};

export function StageCard({
  stageId,
  label,
  status,
  recommended,
  href,
}: StageCardProps) {
  const className =
    "border rounded-lg p-4 flex flex-col gap-2 " +
    (recommended ? "border-blue-500 bg-blue-50" : "border-[var(--color-border)]") +
    (href ? " hover:bg-[var(--color-muted)] transition-colors" : "");

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span aria-label={`status-${status}`} className="text-lg">
          {STATUS_ICON[status]}
        </span>
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {status}
      </div>
      {recommended && (
        <div className="text-xs text-blue-700">Рекомендуем сейчас →</div>
      )}
    </>
  );

  if (href) {
    return (
      <Link to={href} data-stage-id={stageId} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <div data-stage-id={stageId} className={className}>
      {inner}
    </div>
  );
}
