import { useState } from "react";
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
          {freshLabel(memory)}
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
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-red-fg)]"
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
 * «Память актуальна» само по себе говорит только то, что задания дошли до
 * конца. Оно оставалось верным и когда глава не разбиралась вовсе (короткая),
 * и когда из разобранного не прижилось ничего. Подпись называет обе.
 */
function freshLabel(memory: ChapterMemoryInfo): string {
  if (memory.skipped === "short") {
    return "Глава короче 80 слов — в память не попала";
  }
  const dropped =
    (memory.events
      ? memory.events.rejectedEvidence + memory.events.unresolved
      : 0) + memory.malformed;
  if (dropped > 0) {
    // Имена — единственное, по чему автор может действовать: расхождение
    // между замыслом и составом лечится псевдонимом или переименованием.
    const names = memory.events?.unresolvedNames ?? [];
    const why =
      names.length > 0 ? ` — в составе книги нет: ${names.join(", ")}` : "";
    return `Память актуальна · не прижилось записей: ${dropped}${why}`;
  }
  if (memory.outdatedPipeline) return "Память собрана прежним разбором";
  return "Память актуальна";
}

/**
 * Forward-lag warning: earlier chapters are committed but their derived memory
 * hasn't landed yet. Writing this chapter now still works — its prompt would
 * just be assembled without those chapters' facts, notes and chunks.
 */
export function MemoryLagWarning({ chapters }: { chapters: number[] }) {
  if (chapters.length === 0) return null;
  const list = chapters.map((n) => `#${n}`).join(", ");
  const subject =
    chapters.length === 1 ? `Память главы ${list}` : `Память глав ${list}`;
  return (
    <div
      role="status"
      className="card"
      style={{
        borderLeft: "3px solid var(--color-ink-amber)",
        fontSize: 13,
        padding: "10px 14px",
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {subject} ещё обновляется. Если начать писать сейчас, эти главы не
        попадут в контекст генерации.
      </span>
    </div>
  );
}

/**
 * Книга разобрана прежней версией конвейера. Повышение версии само по себе не
 * ставит ни одного задания — они создаются только на свежую версию главы, —
 * поэтому у книги, написанной раньше, новых слоёв памяти (событий героев) не
 * появится никогда, а экран при этом честно показывает «память актуальна».
 * Единственное лекарство — разбор заново, и он платный: подтверждение здесь
 * не формальность, а цена в вызовах модели, умноженная на число глав.
 */
export function MemoryPipelineBanner({
  outdatedChapters,
  onRebuild,
  rebuilding,
}: {
  outdatedChapters: number;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (outdatedChapters === 0) return null;
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
        {outdatedChapters === 1
          ? "Одна глава разобрана прежней версией: "
          : `Глав, разобранных прежней версией: ${outdatedChapters}. `}
        события героев — кто что знает, видел или обещал — по ним не собраны и
        сами не соберутся.
      </span>
      {confirming ? (
        <span className="inline-flex items-center gap-2">
          <span>Разобрать заново {outdatedChapters} глав? Это платные вызовы модели.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(false);
              onRebuild();
            }}
            disabled={rebuilding}
          >
            Да, разобрать
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Отмена
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={rebuilding}
          aria-busy={rebuilding || undefined}
        >
          {rebuilding ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Разбор…
            </>
          ) : (
            "Разобрать заново"
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * Book-level staleness banner: an earlier chapter was re-committed while
 * later chapters' derived memory was already built on the old state.
 */
export function MemoryStaleBanner({
  staleFromPosition,
  onRebuild,
  rebuilding,
}: {
  staleFromPosition: number | null;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  if (staleFromPosition === null) return null;
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
        Память книги устарела начиная с главы #{staleFromPosition}: производные
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
          `Перестроить с главы #${staleFromPosition}`
        )}
      </Button>
    </div>
  );
}
