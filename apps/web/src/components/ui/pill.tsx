import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type PillTone = "default" | "brass" | "amber" | "green" | "red" | "blue";

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Rounded-full tag. Tones map to ink-* tokens; default is muted hairline. */
export function Pill({ tone = "default", className, ...props }: PillProps) {
  return (
    <span
      className={cn("lw-pill", className)}
      data-tone={tone === "default" ? undefined : tone}
      {...props}
    />
  );
}
