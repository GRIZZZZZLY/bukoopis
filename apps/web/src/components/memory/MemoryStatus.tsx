import { AlertCircle, BookCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChapterMemoryInfo } from "@/api/client";

/**
 * ADR 0002 — per-chapter memory state chip. Shows whether the book's memory
 * (chunks/summary/facts/notes) reflects the chapter's current committed
 * version, and offers a retry when the pipeline errored.
 */
export function MemoryStatusBadge({
  memory,
  onRetry,
  retrying,
}: {
  memory: ChapterMemoryInfo | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!memory) return null;
  switch (memory.state) {
    case "fresh":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]"
          role="status"
        >
          <BookCheck className="size-3.5" aria-hidden="true" />
          Память актуальна
        </span>
      );
    case "updating":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Память обновляется…
        </span>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-destructive)]"
          role="status"
        >
          <AlertCircle className="size-3.5" aria-hidden="true" />
          Ошибка обновления памяти
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying || undefined}
          >
            Повторить
          </Button>
        </span>
      );
    case "none":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]"
          role="status"
        >
          Есть изменения, не добавленные в память
        </span>
      );
  }
}

/**
 * Book-level staleness banner: an earlier chapter was re-committed while
 * later chapters' derived memory was already built on the old state.
 */
export function MemoryStaleBanner({
  staleFromOrder,
  onRebuild,
  rebuilding,
}: {
  staleFromOrder: number | null;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  if (staleFromOrder === null) return null;
  return (
    <div
      role="status"
      className="card flex items-center justify-between gap-3 flex-wrap"
      style={{
        borderLeft: "3px solid var(--color-ink-amber)",
        fontSize: 13,
        padding: "10px 14px",
      }}
    >
      <span>
        Память книги устарела начиная с главы #{staleFromOrder}: производные
        факты и заметки более поздних глав построены на старом тексте.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRebuild}
        disabled={rebuilding}
        aria-busy={rebuilding || undefined}
      >
        {rebuilding ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Перестроение…
          </>
        ) : (
          `Перестроить с главы #${staleFromOrder}`
        )}
      </Button>
    </div>
  );
}
