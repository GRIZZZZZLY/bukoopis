import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/** Library-Warm Card surface. Hover lifts to surface-2 + shadow-md.
 *  Styled in apps/web/src/styles/library-warm.css under .lw-card. */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("lw-card", className)} {...props} />;
}
