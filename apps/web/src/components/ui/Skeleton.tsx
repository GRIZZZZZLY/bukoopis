import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-muted)]",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export function TextSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{
            width: `${85 - (i % 3) * 12}%`,
          }}
        />
      ))}
    </div>
  );
}

export function PageSkeleton({ label }: { label?: string }) {
  return (
    <main
      className="max-w-3xl mx-auto p-8 flex flex-col gap-4"
      aria-busy="true"
      aria-label={label ?? "Загрузка содержимого"}
    >
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="mt-4 flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </main>
  );
}
