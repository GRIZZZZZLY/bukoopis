import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type DotTone = "default" | "brass" | "amber" | "green" | "red" | "blue";

interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: DotTone;
}

/** 6-px diagnostic dot. Tones map to ink-* tokens. */
export function Dot({ tone = "default", className, ...props }: DotProps) {
  return (
    <span
      className={cn("lw-dot", className)}
      data-tone={tone === "default" ? undefined : tone}
      aria-hidden="true"
      {...props}
    />
  );
}
