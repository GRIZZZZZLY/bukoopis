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
  { label: string; glyph: string; color: string }
> = {
  complete: {
    label: "Завершено",
    glyph: "✓",
    color: "var(--color-ink-green)",
  },
  in_progress: {
    label: "В работе",
    glyph: "▶",
    color: "var(--color-brass)",
  },
  not_started: {
    label: "Не начато",
    glyph: "●",
    color: "var(--color-text-faint)",
  },
  skipped: {
    label: "Пропущено",
    glyph: "↷",
    color: "var(--color-text-faint)",
  },
};

/** Library-Warm stage tile. Reference: book_redisign/bookopis/screen-studio.jsx. */
export function StageCard({
  stageId,
  label,
  status,
  recommended,
  href,
}: StageCardProps) {
  const info = STATUS_INFO[status];
  const Icon = STAGE_ICON[stageId];
  const recommendedStyle: React.CSSProperties | undefined = recommended
    ? {
        borderColor: "var(--color-brass-soft)",
        boxShadow: "var(--shadow-glow)",
      }
    : undefined;

  const inner = (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: recommended
              ? "var(--color-brass-glow)"
              : "var(--color-surface-2)",
            color: recommended
              ? "var(--color-brass)"
              : "var(--color-text-muted)",
            display: "grid",
            placeItems: "center",
          }}
          aria-hidden="true"
        >
          <Icon size={18} />
        </div>
        <span
          aria-label={`status-${status}`}
          style={{ fontSize: 10, color: info.color }}
        >
          {info.glyph}
        </span>
      </div>
      <h3
        className="font-display"
        style={{
          fontSize: 18,
          fontWeight: 500,
          margin: 0,
          color: "var(--color-text-strong)",
        }}
      >
        {label}
      </h3>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
        {info.label}
      </div>
      {recommended && (
        <div
          className="font-mono"
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "var(--color-brass)",
          }}
        >
          → рекомендовано
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        to={href}
        data-stage-id={stageId}
        className="card hoverable"
        style={{
          textDecoration: "none",
          color: "inherit",
          ...recommendedStyle,
        }}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      data-stage-id={stageId}
      className="card"
      style={recommendedStyle}
    >
      {inner}
    </div>
  );
}
