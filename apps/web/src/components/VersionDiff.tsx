import { useEffect, useMemo, useState } from "react";
import { diffWords, type Change } from "diff";
import { AlertDialog } from "@/components/ui/AlertDialog";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { ChapterVersion } from "@book-forge/shared";

interface VersionDiffProps {
  open: boolean;
  onClose: () => void;
  baseVersion: ChapterVersion | null;
  compareVersion: ChapterVersion | null;
}

export function VersionDiff({
  open,
  onClose,
  baseVersion,
  compareVersion,
}: VersionDiffProps) {
  const [baseText, setBaseText] = useState<string | null>(null);
  const [compareText, setCompareText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBaseText(baseVersion?.contentText ?? null);
    setCompareText(compareVersion?.contentText ?? null);
    // If either version came as a list-only entry (without contentText), fetch
    // the full version. listVersions returns the rows including contentText
    // already, so this is mostly defensive.
    if (baseVersion && !baseVersion.contentText) {
      void hydrate(baseVersion.id, setBaseText);
    }
    if (compareVersion && !compareVersion.contentText) {
      void hydrate(compareVersion.id, setCompareText);
    }
  }, [open, baseVersion, compareVersion]);

  const changes = useMemo<Change[]>(() => {
    if (baseText === null || compareText === null) return [];
    return diffWords(baseText, compareText);
  }, [baseText, compareText]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      const wc = c.value.split(/\s+/).filter(Boolean).length;
      if (c.added) added += wc;
      else if (c.removed) removed += wc;
    }
    return { added, removed };
  }, [changes]);

  if (!open) return null;
  return (
    <AlertDialog
      open={open}
      onClose={onClose}
      title={
        baseVersion && compareVersion
          ? `Сравнение #${baseVersion.id} → #${compareVersion.id}`
          : "Сравнение версий"
      }
      description={
        <span className="text-xs">
          <span className="text-[var(--color-primary)] font-medium">
            +{stats.added}
          </span>{" "}
          добавлено ·{" "}
          <span className="text-[var(--color-destructive)] font-medium">
            −{stats.removed}
          </span>{" "}
          удалено
        </span>
      }
      width="wide"
      actions={
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 font-serif text-sm leading-relaxed whitespace-pre-wrap">
        {changes.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Загрузка…
          </span>
        ) : (
          changes.map((c, i) => (
            <span
              key={i}
              className={
                c.added
                  ? "bg-[color:rgb(34_197_94_/_0.18)] underline decoration-[color:rgb(34_197_94_/_0.6)]"
                  : c.removed
                    ? "bg-[color:rgb(239_68_68_/_0.16)] line-through decoration-[color:rgb(239_68_68_/_0.6)]"
                    : ""
              }
            >
              {c.value}
            </span>
          ))
        )}
      </div>
    </AlertDialog>
  );
}

async function hydrate(
  versionId: number,
  setter: (s: string) => void,
): Promise<void> {
  // Fallback: re-fetch the version list from the chapter.
  // If we ever add GET /api/chapter-versions/:id, swap to that.
  try {
    // Best-effort: callers should already pass full ChapterVersion; this is
    // only to handle stale fixtures.
    const list = await api.listVersions(versionId);
    const v = list.find((x) => x.id === versionId);
    if (v) setter(v.contentText);
  } catch {
    // ignore
  }
}
