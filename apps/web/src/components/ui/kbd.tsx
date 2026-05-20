import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/** Library-Warm keyboard hint pill. Mono 12. */
export function Kbd({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <kbd className={cn("lw-kbd", className)} {...props} />;
}
