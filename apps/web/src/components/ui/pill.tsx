import { cn } from "@/lib/utils";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type PillTone = "default" | "brass" | "amber" | "green" | "red" | "blue";

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** Leading 6-px dot in the same tone. */
  dot?: boolean;
  children?: ReactNode;
}

const TONE_STYLE: Record<PillTone, CSSProperties> = {
  default: {
    color: "var(--color-text-muted)",
    borderColor: "var(--color-border)",
    background: "transparent",
  },
  brass: {
    color: "var(--color-brass)",
    borderColor: "var(--color-brass-soft)",
    background: "rgba(212,154,78,0.10)",
  },
  amber: {
    color: "var(--color-ink-amber)",
    borderColor: "rgba(201,162,74,0.55)",
    background: "rgba(201,162,74,0.14)",
  },
  green: {
    color: "var(--color-ink-green)",
    borderColor: "rgba(106,142,78,0.55)",
    background: "rgba(106,142,78,0.14)",
  },
  red: {
    color: "var(--color-ink-red)",
    borderColor: "rgba(196,69,54,0.55)",
    background: "rgba(196,69,54,0.14)",
  },
  blue: {
    color: "var(--color-ink-blue)",
    borderColor: "rgba(91,122,153,0.55)",
    background: "rgba(91,122,153,0.16)",
  },
};

const TONE_DOT: Record<PillTone, string> = {
  default: "var(--color-text-faint)",
  brass: "var(--color-brass)",
  amber: "var(--color-ink-amber)",
  green: "var(--color-ink-green)",
  red: "var(--color-ink-red)",
  blue: "var(--color-ink-blue)",
};

/** Rounded-full tag. Tones map to ink-* tokens; default is muted hairline. */
export function Pill({
  tone = "default",
  dot,
  className,
  children,
  style,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border h-[22px] px-2.5 text-[11px] font-medium tracking-[0.02em] whitespace-nowrap",
        className,
      )}
      style={{ ...TONE_STYLE[tone], ...style }}
      data-tone={tone === "default" ? undefined : tone}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="inline-block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: TONE_DOT[tone],
          }}
        />
      )}
      {children}
    </span>
  );
}
