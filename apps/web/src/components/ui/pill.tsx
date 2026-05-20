import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export type PillTone = "default" | "brass" | "amber" | "green" | "red" | "blue";

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** Leading 6-px dot in the same tone. */
  dot?: boolean;
  children?: ReactNode;
}

/** Rounded-full tag. Tones map to ink-* tokens; default is muted hairline. */
export function Pill({
  tone = "default",
  dot,
  className,
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn("lw-pill", className)}
      data-tone={tone === "default" ? undefined : tone}
      {...props}
    >
      {dot && (
        <span
          className="lw-dot"
          data-tone={tone === "default" ? undefined : tone}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
