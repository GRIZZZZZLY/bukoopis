import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  GitMerge,
  Sparkles,
  Quote,
  Users,
  MapPin,
  Package,
  HelpCircle,
  Heart,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import {
  canonApi,
  api,
  type CanonExtraction,
  type CanonEntityKind,
  type CanonCharacterCandidate,
  type CanonLocationCandidate,
  type CanonItemCandidate,
  type CanonHookCandidate,
  type CanonRelationshipCandidate,
  type ChapterCanonEntry,
} from "@/api/client";
import { toast } from "@/lib/toast";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  Character,
  Location as LocationEntity,
  Item,
  Hook,
} from "@book-forge/shared";

type AnyCandidate =
  | CanonCharacterCandidate
  | CanonLocationCandidate
  | CanonItemCandidate
  | CanonHookCandidate
  | CanonRelationshipCandidate;

type TabValue = "all" | CanonEntityKind;

interface CanonPanelProps {
  bookId: number;
  chapterId: number;
  /** Bumped by parent when Writer just finished, to start polling. */
  runningSignal: number;
}

export function CanonPanel({
  bookId,
  chapterId,
  runningSignal,
}: CanonPanelProps) {
  const [extraction, setExtraction] = useState<CanonExtraction | null>(null);
  const [confirmed, setConfirmed] = useState<ChapterCanonEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<TabValue>("all");
  const [bookCanon, setBookCanon] = useState<{
    characters: Character[];
    locations: LocationEntity[];
    items: Item[];
    hooks: Hook[];
  }>({ characters: [], locations: [], items: [], hooks: [] });
  const pollingRef = useRef<{ until: number; lastSignal: number }>({
    until: 0,
    lastSignal: 0,
  });

  const loadConfirmed = useCallback(async () => {
    try {
      const list = await canonApi.list(chapterId);
      setConfirmed(list);
    } catch {
      // ignore
    }
  }, [chapterId]);

  const loadBookCanon = useCallback(async () => {
    try {
      const [characters, locations, items, hooks] = await Promise.all([
        api.listCharacters(bookId),
        api.listLocations(bookId),
        api.listItems(bookId),
        api.listHooks(bookId),
      ]);
      setBookCanon({ characters, locations, items, hooks });
    } catch {
      // ignore
    }
  }, [bookId]);

  const refresh = useCallback(async () => {
    try {
      const [snap] = await Promise.all([
        canonApi.get(chapterId),
        loadConfirmed(),
      ]);
      setExtraction(snap);
      return snap;
    } catch (err) {
      if (err instanceof Error) {
        // 404 etc — silent
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [chapterId, loadConfirmed]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    void loadBookCanon();
  }, [chapterId, refresh, loadBookCanon]);

  // Polling on Writer-finished signal: poll for up to 90s every 3s until ready.
  useEffect(() => {
    if (runningSignal === 0) return;
    if (runningSignal === pollingRef.current.lastSignal) return;
    pollingRef.current = {
      until: Date.now() + 90_000,
      lastSignal: runningSignal,
    };
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const snap = await refresh();
      if (cancelled) return;
      const stillRunning =
        !snap ||
        snap.status === "pending" ||
        Date.now() < pollingRef.current.until;
      if (snap && snap.status === "ready") {
        const total =
          snap.characters.length +
          snap.locations.length +
          snap.items.length +
          snap.hooks.length +
          snap.relationships.length;
        toast.success("Канон обновлён", {
          description:
            total > 0
              ? `Найдено: ${formatFoundSummary(snap)}.`
              : "Новых сущностей не выявлено.",
        });
        return;
      }
      if (snap && snap.status === "error") {
        toast.error("Извлечение канона не удалось", {
          description: snap.errorMessage ?? undefined,
          action: { label: "Повторить", onClick: () => void runManual() },
        });
        return;
      }
      if (Date.now() < pollingRef.current.until && stillRunning) {
        setTimeout(() => void tick(), 3000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningSignal, refresh]);

  async function runManual() {
    setRunning(true);
    try {
      const snap = await canonApi.extract(chapterId);
      setExtraction(snap);
      toast.success("Канон извлечён", {
        description:
          (snap.characters.length || 0) +
            (snap.locations.length || 0) +
            (snap.items.length || 0) +
            (snap.hooks.length || 0) +
            (snap.relationships.length || 0) >
          0
            ? `Найдено: ${formatFoundSummary(snap)}.`
            : "Новых сущностей не выявлено.",
      });
      await loadConfirmed();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Извлечение канона не удалось", { description: msg });
    } finally {
      setRunning(false);
    }
  }

  async function applyAccept(c: AnyCandidate) {
    try {
      const snap = await canonApi.accept(chapterId, c.id, {
        kind: kindFromId(c.id),
      });
      setExtraction(snap);
      await Promise.all([loadConfirmed(), loadBookCanon()]);
      toast.success("Принято в канон");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось принять", { description: msg });
    }
  }

  async function applyReject(c: AnyCandidate) {
    try {
      const snap = await canonApi.reject(chapterId, c.id, {
        kind: kindFromId(c.id),
      });
      setExtraction(snap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось отклонить", { description: msg });
    }
  }

  async function applyMerge(c: AnyCandidate, targetId: number) {
    try {
      const snap = await canonApi.merge(chapterId, c.id, {
        kind: kindFromId(c.id),
        targetId,
      });
      setExtraction(snap);
      await Promise.all([loadConfirmed(), loadBookCanon()]);
      toast.success("Слито с существующим");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось слить", { description: msg });
    }
  }

  async function applyUndo(c: AnyCandidate) {
    try {
      const snap = await canonApi.undo(chapterId, c.id, {
        kind: kindFromId(c.id),
      });
      setExtraction(snap);
      await Promise.all([loadConfirmed(), loadBookCanon()]);
      toast.success("Решение отменено");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось отменить", { description: msg });
    }
  }

  async function acceptAll() {
    try {
      const snap = await canonApi.acceptAll(chapterId);
      setExtraction(snap);
      await Promise.all([loadConfirmed(), loadBookCanon()]);
      toast.success("Все ожидающие приняты");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось принять все", { description: msg });
    }
  }

  const pendingByKind = useMemo(() => {
    if (!extraction) return emptyByKind();
    return {
      character: extraction.characters.filter((c) => c.decision === "pending"),
      location: extraction.locations.filter((c) => c.decision === "pending"),
      item: extraction.items.filter((c) => c.decision === "pending"),
      hook: extraction.hooks.filter((c) => c.decision === "pending"),
      relationship: extraction.relationships.filter(
        (c) => c.decision === "pending",
      ),
    };
  }, [extraction]);

  const totalPending =
    pendingByKind.character.length +
    pendingByKind.location.length +
    pendingByKind.item.length +
    pendingByKind.hook.length +
    pendingByKind.relationship.length;

  const isPending = extraction?.status === "pending";

  const tabItems: TabItem<TabValue>[] = [
    {
      value: "all",
      label: "Все",
      badge: totalPending > 0 ? totalPending : undefined,
    },
    {
      value: "character",
      label: <KindLabel kind="character" />,
      badge:
        pendingByKind.character.length > 0
          ? pendingByKind.character.length
          : undefined,
    },
    {
      value: "location",
      label: <KindLabel kind="location" />,
      badge:
        pendingByKind.location.length > 0
          ? pendingByKind.location.length
          : undefined,
    },
    {
      value: "item",
      label: <KindLabel kind="item" />,
      badge:
        pendingByKind.item.length > 0 ? pendingByKind.item.length : undefined,
    },
    {
      value: "hook",
      label: <KindLabel kind="hook" />,
      badge:
        pendingByKind.hook.length > 0 ? pendingByKind.hook.length : undefined,
    },
    {
      value: "relationship",
      label: <KindLabel kind="relationship" />,
      badge:
        pendingByKind.relationship.length > 0
          ? pendingByKind.relationship.length
          : undefined,
    },
  ];

  return (
    <section className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-3 bg-[var(--color-card,transparent)]">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Канон
            {totalPending > 0 && (
              <span
                className="inline-flex items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[10px] font-semibold px-1.5 py-0.5"
                aria-label={`${totalPending} новых кандидатов`}
              >
                Новое · {totalPending}
              </span>
            )}
          </h2>
          <ExtractionStatusLine extraction={extraction} loading={loading} />
        </div>
        <div className="flex items-center gap-1">
          {totalPending > 0 && (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => void acceptAll()}
              aria-label="Принять всех кандидатов"
            >
              Принять все
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void runManual()}
            disabled={running || isPending}
            aria-label="Запустить извлечение канона"
            title="Запустить извлечение"
          >
            {running || isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </header>

      {extraction && (
        <Tabs
          value={tab}
          onChange={setTab}
          items={tabItems}
          size="sm"
          ariaLabel="Категории канона"
        />
      )}

      {!extraction && !loading && (
        <EmptyState onRun={() => void runManual()} running={running} />
      )}

      {extraction && (
        <CandidateList
          tab={tab}
          extraction={extraction}
          confirmed={confirmed}
          existing={bookCanon}
          onAccept={applyAccept}
          onReject={applyReject}
          onMerge={applyMerge}
          onUndo={applyUndo}
        />
      )}
    </section>
  );
}

function ExtractionStatusLine({
  extraction,
  loading,
}: {
  extraction: CanonExtraction | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="text-xs text-[var(--color-muted-foreground)] inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Загрузка…
      </span>
    );
  }
  if (!extraction) {
    return (
      <span className="text-xs text-[var(--color-muted-foreground)]">
        Глава ещё не анализировалась
      </span>
    );
  }
  if (extraction.status === "pending") {
    return (
      <span className="text-xs text-[var(--color-muted-foreground)] inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Канон обрабатывается…
      </span>
    );
  }
  if (extraction.status === "error") {
    return (
      <span className="text-xs text-[var(--color-ink-red-fg)] inline-flex items-center gap-1">
        <AlertCircle className="size-3" aria-hidden="true" />
        Ошибка: {extraction.errorMessage ?? "неизвестно"}
      </span>
    );
  }
  return (
    <span className="text-xs text-[var(--color-muted-foreground)] inline-flex items-center gap-1">
      <Check className="size-3" aria-hidden="true" />
      {`Готово · ${formatUsd(extraction.costUsd)}`}
    </span>
  );
}

function CandidateList({
  tab,
  extraction,
  confirmed,
  existing,
  onAccept,
  onReject,
  onMerge,
  onUndo,
}: {
  tab: TabValue;
  extraction: CanonExtraction;
  confirmed: ChapterCanonEntry[];
  existing: {
    characters: Character[];
    locations: LocationEntity[];
    items: Item[];
    hooks: Hook[];
  };
  onAccept: (c: AnyCandidate) => void;
  onReject: (c: AnyCandidate) => void;
  onMerge: (c: AnyCandidate, targetId: number) => void;
  onUndo: (c: AnyCandidate) => void;
}) {
  const sections: Array<{ kind: CanonEntityKind; items: AnyCandidate[] }> = [];
  if (tab === "all" || tab === "character")
    sections.push({ kind: "character", items: extraction.characters });
  if (tab === "all" || tab === "location")
    sections.push({ kind: "location", items: extraction.locations });
  if (tab === "all" || tab === "item")
    sections.push({ kind: "item", items: extraction.items });
  if (tab === "all" || tab === "hook")
    sections.push({ kind: "hook", items: extraction.hooks });
  if (tab === "all" || tab === "relationship")
    sections.push({ kind: "relationship", items: extraction.relationships });

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <KindSection
          key={s.kind}
          kind={s.kind}
          candidates={s.items}
          confirmed={confirmed.filter((c) => c.type === s.kind)}
          existing={pickExistingForKind(existing, s.kind)}
          onAccept={onAccept}
          onReject={onReject}
          onMerge={onMerge}
          onUndo={onUndo}
        />
      ))}
    </div>
  );
}

function KindSection({
  kind,
  candidates,
  confirmed,
  existing,
  onAccept,
  onReject,
  onMerge,
  onUndo,
}: {
  kind: CanonEntityKind;
  candidates: AnyCandidate[];
  confirmed: ChapterCanonEntry[];
  existing: ExistingForKind;
  onAccept: (c: AnyCandidate) => void;
  onReject: (c: AnyCandidate) => void;
  onMerge: (c: AnyCandidate, targetId: number) => void;
  onUndo: (c: AnyCandidate) => void;
}) {
  const pending = candidates.filter((c) => c.decision === "pending");
  const accepted = candidates.filter(
    (c) => c.decision === "accepted" || c.decision === "merged",
  );
  const acceptedIds = new Set(
    accepted.map((c) => `${kind}:${c.id}`),
  );
  const confirmedNotInSnapshot = confirmed.filter(
    // confirmed entries from API list don't carry candidate ids; we show those
    // that were accepted in *previous* snapshots only.
    () => acceptedIds.size === 0,
  );

  if (
    pending.length === 0 &&
    accepted.length === 0 &&
    confirmedNotInSnapshot.length === 0
  ) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] inline-flex items-center gap-1.5">
        <KindLabel kind={kind} />
        <span className="opacity-60">·</span>
        <span>{kindRuLabel(kind)}</span>
      </h3>

      {accepted.length > 0 && (
        <ul className="flex flex-col gap-1">
          {accepted.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-2.5 py-1.5 text-xs gap-2"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Check
                  className="size-3 text-[var(--color-primary)] shrink-0"
                  aria-hidden="true"
                />
                <span className="font-medium truncate">
                  {candidateLabel(kind, c)}
                </span>
                {c.decision === "merged" && (
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">
                    (слито)
                  </span>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onUndo(c)}
                aria-label="Отменить решение"
                title="Отменить"
              >
                ↶
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirmedNotInSnapshot.length > 0 && (
        <ul className="flex flex-col gap-1">
          {confirmedNotInSnapshot.map((c) => (
            <li
              key={`${c.type}-${c.entityId}`}
              className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-2.5 py-1.5 text-xs"
            >
              <span className="inline-flex items-center gap-1.5">
                <Check
                  className="size-3 text-[var(--color-primary)]"
                  aria-hidden="true"
                />
                <span className="font-medium">{c.name}</span>
              </span>
              <span className="text-[var(--color-muted-foreground)]">
                ×{c.mentionCount}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((c) => (
            <CandidateCard
              key={c.id}
              kind={kind}
              candidate={c}
              existing={existing}
              onAccept={onAccept}
              onReject={onReject}
              onMerge={onMerge}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ExistingForKind {
  list: Array<{ id: number; name: string }>;
}

function pickExistingForKind(
  existing: {
    characters: Character[];
    locations: LocationEntity[];
    items: Item[];
    hooks: Hook[];
  },
  kind: CanonEntityKind,
): ExistingForKind {
  if (kind === "character") {
    return {
      list: existing.characters.map((c) => ({
        id: c.id,
        name: c.canonicalName,
      })),
    };
  }
  if (kind === "location") {
    return {
      list: existing.locations.map((l) => ({ id: l.id, name: l.name })),
    };
  }
  if (kind === "item") {
    return { list: existing.items.map((i) => ({ id: i.id, name: i.name })) };
  }
  if (kind === "hook") {
    return {
      list: existing.hooks.map((h) => ({
        id: h.id,
        name: h.description.slice(0, 60),
      })),
    };
  }
  return { list: [] };
}

function CandidateCard({
  kind,
  candidate,
  existing,
  onAccept,
  onReject,
  onMerge,
}: {
  kind: CanonEntityKind;
  candidate: AnyCandidate;
  existing: ExistingForKind;
  onAccept: (c: AnyCandidate) => void;
  onReject: (c: AnyCandidate) => void;
  onMerge: (c: AnyCandidate, targetId: number) => void;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const name = candidateLabel(kind, candidate);
  const profile = candidateProfile(candidate);

  const ambiguous = candidate.status === "ambiguous";
  const isNew = candidate.status === "new";
  return (
    <li className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium text-sm">{name}</span>
          {profile && (
            <span className="text-xs text-[var(--color-muted-foreground)] line-clamp-2">
              {profile}
            </span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            isNew
              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
              : ambiguous
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
          )}
        >
          {isNew ? (
            <>
              <Sparkles className="size-3" aria-hidden="true" /> ново
            </>
          ) : ambiguous ? (
            <>
              <HelpCircle className="size-3" aria-hidden="true" /> совпадение?
            </>
          ) : (
            <>уже в&nbsp;каноне</>
          )}
        </span>
      </div>

      {candidate.quote && (
        <blockquote className="text-xs italic text-[var(--color-muted-foreground)] border-l-2 border-[var(--color-border)] pl-2 inline-flex gap-1">
          <Quote
            className="size-3 mt-0.5 shrink-0 opacity-60"
            aria-hidden="true"
          />
          <span>«{candidate.quote.trim()}»</span>
        </blockquote>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => onAccept(candidate)}
          aria-label="Принять кандидата в канон"
        >
          <Check className="size-3.5" aria-hidden="true" /> Принять
        </Button>
        {existing.list.length > 0 && (
          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMergeOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={mergeOpen}
            >
              <GitMerge className="size-3.5" aria-hidden="true" /> Слить с…
            </Button>
            {mergeOpen && (
              <MergePopover
                list={existing.list}
                suggested={
                  ambiguous && candidate.existingId !== null
                    ? candidate.existingId
                    : null
                }
                onClose={() => setMergeOpen(false)}
                onPick={(id) => {
                  setMergeOpen(false);
                  onMerge(candidate, id);
                }}
              />
            )}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onReject(candidate)}
          aria-label="Отклонить кандидата"
        >
          <X className="size-3.5" aria-hidden="true" /> Отклонить
        </Button>
        <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">
          ×{candidate.mentionCount} в&nbsp;главе
        </span>
      </div>
    </li>
  );
}

function MergePopover({
  list,
  suggested,
  onClose,
  onPick,
}: {
  list: Array<{ id: number; name: string }>;
  suggested: number | null;
  onClose: () => void;
  onPick: (id: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...list];
    if (suggested !== null) {
      sorted.sort((a, b) =>
        a.id === suggested ? -1 : b.id === suggested ? 1 : 0,
      );
    }
    if (!q) return sorted;
    return sorted.filter((e) => e.name.toLowerCase().includes(q));
  }, [list, filter, suggested]);

  return (
    <div
      ref={ref}
      role="listbox"
      className="absolute z-30 mt-1 left-0 w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-md"
    >
      <input
        type="text"
        autoFocus
        placeholder="Найти существующее…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border-b border-[var(--color-border)] outline-none"
        aria-label="Поиск по существующему канону"
      />
      <ul className="max-h-60 overflow-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">
            Ничего не найдено
          </li>
        ) : (
          filtered.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={e.id === suggested}
                onClick={() => onPick(e.id)}
                className={cn(
                  "w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--color-accent)]",
                  e.id === suggested
                    ? "bg-[var(--color-accent)]/50"
                    : undefined,
                )}
              >
                {e.name}
                {e.id === suggested && (
                  <span className="ml-2 text-[10px] text-[var(--color-primary)]">
                    предлагается
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function EmptyState({
  onRun,
  running,
}: {
  onRun: () => void;
  running: boolean;
}) {
  return (
    <div className="text-xs text-[var(--color-muted-foreground)] flex flex-col items-start gap-2">
      <p>
        Канон ещё не извлекался для этой главы. После написания главы извлечение
        запускается автоматически.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRun}
        disabled={running}
        aria-busy={running || undefined}
      >
        {running ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Извлекаем…
          </>
        ) : (
          <>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Извлечь сейчас
          </>
        )}
      </Button>
    </div>
  );
}

function KindLabel({ kind }: { kind: CanonEntityKind }) {
  const Icon = kindIcon(kind);
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

function kindIcon(kind: CanonEntityKind) {
  switch (kind) {
    case "character":
      return Users;
    case "location":
      return MapPin;
    case "item":
      return Package;
    case "hook":
      return HelpCircle;
    case "relationship":
      return Heart;
  }
}

function kindRuLabel(kind: CanonEntityKind): string {
  switch (kind) {
    case "character":
      return "Персонажи";
    case "location":
      return "Локации";
    case "item":
      return "Артефакты";
    case "hook":
      return "Крючки";
    case "relationship":
      return "Отношения";
  }
}

function emptyByKind() {
  return {
    character: [] as CanonCharacterCandidate[],
    location: [] as CanonLocationCandidate[],
    item: [] as CanonItemCandidate[],
    hook: [] as CanonHookCandidate[],
    relationship: [] as CanonRelationshipCandidate[],
  };
}

function kindFromId(id: string): CanonEntityKind {
  const [k] = id.split(":");
  return (k ?? "character") as CanonEntityKind;
}

function candidateLabel(kind: CanonEntityKind, c: AnyCandidate): string {
  if (kind === "relationship") {
    const r = c as CanonRelationshipCandidate;
    return `${r.fromName} — ${r.toName} (${r.type})`;
  }
  if (kind === "hook") {
    const h = c as CanonHookCandidate;
    const tag =
      h.type === "opened"
        ? "открыт"
        : h.type === "closed"
          ? "закрыт"
          : "развит";
    return `[${tag}] ${h.description}`;
  }
  return (c as CanonCharacterCandidate).name;
}

function candidateProfile(c: AnyCandidate): string | null {
  if ("profile" in c) return c.profile;
  return null;
}

function formatFoundSummary(snap: CanonExtraction): string {
  const parts: string[] = [];
  if (snap.characters.length) parts.push(`${snap.characters.length} перс.`);
  if (snap.locations.length) parts.push(`${snap.locations.length} лок.`);
  if (snap.items.length) parts.push(`${snap.items.length} артеф.`);
  if (snap.hooks.length) parts.push(`${snap.hooks.length} крючк.`);
  if (snap.relationships.length)
    parts.push(`${snap.relationships.length} связ.`);
  return parts.join(" · ");
}
