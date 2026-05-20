import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0..1 */
  value: number;
  /** Accessible label for screen readers. */
  label?: string;
}

/** 2-px brass progress bar on surface-2 track.
 *  `value` is clamped to 0..1; width transitions via --motion-3. */
export function ProgressBar({
  value,
  label,
  className,
  ...props
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn("lw-progress", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label={label ?? "Прогресс"}
      {...props}
    >
      <i style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
