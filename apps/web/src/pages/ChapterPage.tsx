import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  CanonHighlight,
  setCanonEntities,
  type CanonHighlightEntity,
} from "@/lib/canonHighlight";
import {
  Check,
  Loader2,
  AlertCircle,
  Undo2,
  Redo2,
  Square,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { PlanPanel } from "@/components/PlanPanel";
import { CritiquePanel } from "@/components/CritiquePanel";
import { InlineCommandPanel } from "@/components/InlineCommandPanel";
import { CanonPanel } from "@/components/CanonPanel";
import { VersionDiff } from "@/components/VersionDiff";
import { FocusToggle } from "@/components/atmosphere/FocusToggle";
import { InkwellStatus } from "@/components/atmosphere/InkwellStatus";
import { OutlineRail } from "@/components/chapter/OutlineRail";
import {
  ProposalPanel,
  type ProposalReread,
} from "@/components/chapter/ProposalPanel";
import { api, streamWriteChapter } from "@/api/client";
import { toast } from "@/lib/toast";
import { formatUsdApprox } from "@/lib/money";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { reportSave, resetSaveStatus } from "@/lib/saveStatus";
import {
  MemoryStatusBadge,
  MemoryStaleBanner,
  MemoryLagWarning,
  MemoryPipelineBanner,
} from "@/components/memory/MemoryStatus";
import type { ChapterMemoryInfo, ChapterWithMemory } from "@/api/client";
import { useHotkeys } from "@/lib/useHotkeys";
import { useRestoredProposal } from "@/lib/useRestoredProposal";
import type {
  Book,
  ChapterBeatSheetVariant,
  ChapterVersion,
  ProseChange,
  ProseProposal,
} from "@book-forge/shared";
import { EMPTY_DOC, calculateCost, MODEL_IDS } from "@book-forge/shared";

function emptyDoc(): unknown {
  return JSON.parse(JSON.stringify(EMPTY_DOC));
}

function parseDoc(json: string | null | undefined): unknown {
  if (!json) return emptyDoc();
  try {
    return JSON.parse(json);
  } catch {
    return emptyDoc();
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function ChapterPage() {
  const { bookId, chapterId } = useParams<{
    bookId: string;
    chapterId: string;
  }>();
  const id = Number(chapterId);

  const [chapter, setChapter] = useState<ChapterWithMemory | null>(
    null,
  );
  const [book, setBook] = useState<Book | null>(null);
  const [versions, setVersions] = useState<ChapterVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<ChapterBeatSheetVariant | null>(
    null,
  );
  const [writing, setWriting] = useState(false);
  const [writerBuffer, setWriterBuffer] = useState("");
  const [proposal, setProposal] = useState<ProseProposal | null>(null);
  const [proposalChanges, setProposalChanges] = useState<ProseChange[]>([]);
  const [runningProposalId, setRunningProposalId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Ошибка ОПЕРАЦИИ (сохранение, восстановление): полоса над рукописью.
   *  `error` ниже остаётся за сбоем ЗАГРУЗКИ — только он вправе заменить
   *  собой страницу, потому что показывать тогда нечего (В10). */
  const [actionError, setActionError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [mobilePanelsOpen, setMobilePanelsOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [outlinePosition, setOutlinePosition] = useState<number | null>(null);
  const [canonRunningSignal, setCanonRunningSignal] = useState(0);
  const [compareVersionId, setCompareVersionId] = useState<number | null>(null);
  const [memory, setMemory] = useState<ChapterMemoryInfo | null>(null);
  const [memoryRetrying, setMemoryRetrying] = useState(false);
  const [memoryRebuilding, setMemoryRebuilding] = useState(false);

  const isPreviewRef = useRef(false);
  const baselineJsonRef = useRef<string>(JSON.stringify(EMPTY_DOC));
  const titleBaselineRef = useRef<string>("");
  const writerAbortRef = useRef<AbortController | null>(null);

  const recomputeDirty = useCallback(
    (json: unknown, currentTitle: string) => {
      const jsonStr = JSON.stringify(json);
      const titleChanged = currentTitle.trim() !== titleBaselineRef.current.trim();
      const contentChanged = jsonStr !== baselineJsonRef.current;
      setDirty(titleChanged || contentChanged);
    },
    [],
  );

  const autoSaveContent = useCallback(
    async (json: unknown) => {
      try {
        // ADR 0002 (Step 6): autosave UPSERTs the working draft — no
        // immutable version, no memory jobs. Commit happens on Ctrl+S.
        const saved = await api.saveDraft(id, json);
        // Ревизия черновика — CAS-токен принятия кандидата. Выбрасывать её
        // и ждать следующего load() значило, что после первого же автосейва
        // любое принятие отвечало 409: страница называла серверу ревизию,
        // которой уже нет. Именно этот случай — автор печатает, пока модель
        // пишет — вся ветка и обслуживает.
        setChapter((prev) =>
          prev
            ? {
                ...prev,
                draft: {
                  chapterId: id,
                  contentJson: JSON.stringify(json),
                  contentText: prev.draft?.contentText ?? "",
                  wordCount: saved.wordCount,
                  baseVersionId: prev.currentVersionId ?? null,
                  revision: saved.revision,
                  updatedAt: saved.updatedAt,
                },
              }
            : prev,
        );
        setMemory((m) =>
          m && m.state === "fresh" ? { ...m, state: "none" } : m,
        );
        baselineJsonRef.current = JSON.stringify(json);
        setSaveError(null);
        setDirty((d) => {
          // recompute via title — content now baseline
          const titleStillChanged =
            titleBaselineRef.current.trim() !== titleBaselineRef.current.trim();
          return titleStillChanged ? d : false;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSaveError(msg);
        toast.error("Автосохранение не удалось", { description: msg });
        throw err;
      }
    },
    [id],
  );

  const debouncedSave = useDebouncedSave<unknown>(autoSaveContent, {
    // Drafts only (PUT /draft — no versions, no memory jobs); the deliberate
    // commit with indexing + extractors happens on manual Save / Ctrl+S.
    delayMs: 10000,
  });

  // Publish live save status to the shell StatusBar; reset on unmount so it
  // falls back to idle once we navigate away from this chapter.
  useEffect(() => {
    if (saveError) reportSave({ kind: "error", at: Date.now() });
    else if (debouncedSave.saving) reportSave({ kind: "saving", at: Date.now() });
    else if (debouncedSave.lastSavedAt)
      reportSave({ kind: "saved", at: debouncedSave.lastSavedAt.getTime() });
  }, [debouncedSave.saving, debouncedSave.lastSavedAt, saveError]);

  useEffect(() => () => resetSaveStatus(), []);

  const refreshMemory = useCallback(async () => {
    try {
      const ch = await api.getChapter(id);
      setMemory(ch.memory ?? null);
    } catch {
      /* transient — next poll or load() will catch up */
    }
  }, [id]);

  // Poll while the pipeline works so the badge flips to "fresh" on its own.
  useEffect(() => {
    if (memory?.state !== "updating") return;
    const t = setInterval(() => void refreshMemory(), 3000);
    return () => clearInterval(t);
  }, [memory?.state, refreshMemory]);

  const onRetryMemory = useCallback(async () => {
    setMemoryRetrying(true);
    try {
      await api.retryChapterMemory(id);
      toast.info("Задания памяти перезапущены");
      setMemory((m) => (m ? { ...m, state: "updating" } : m));
    } catch (err) {
      toast.error("Не удалось перезапустить память", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMemoryRetrying(false);
    }
  }, [id]);

  const onRebuildMemory = useCallback(async (fromOrder?: number) => {
    if (!bookId) return;
    setMemoryRebuilding(true);
    try {
      const r = await api.rebuildBookMemory(Number(bookId), fromOrder);
      toast.info(
        `Перестроение памяти: ${r.enqueuedChapters} глав, начиная с #${r.fromOrder}`,
      );
      setMemory((m) => (m ? { ...m, state: "updating" } : m));
    } catch (err) {
      toast.error("Не удалось запустить перестроение", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMemoryRebuilding(false);
    }
  }, [bookId]);

  const editor = useEditor({
    extensions: [StarterKit, CanonHighlight],
    content: emptyDoc() as never,
    onUpdate: ({ editor }) => {
      setWordCount(countWords(editor.getText()));
      setEditorTick((t) => t + 1);
      const json = editor.getJSON();
      recomputeDirty(json, title);
      // В9: автосохранение больше не выключается на время генерации. Писатель
      // пишет в кандидата, а не в редактор, и текст, набранный автором за эти
      // минуты, нигде не сохранялся — а если поток обрывался молча, не
      // сохранялся и после. В предпросмотре по-прежнему молчим: там в
      // редакторе чужой текст.
      if (isPreviewRef.current) return;
      const text = editor.getText().trim();
      if (text === "") return;
      debouncedSave.mark(json);
    },
  });

  const load = useCallback(
    async () => {
      setError(null);
      try {
        const [ch, vs] = await Promise.all([
          api.getChapter(id),
          api.listVersions(id),
        ]);
        setChapter(ch);
        setVersions(vs);
        setMemory(ch.memory ?? null);
        setTitle(ch.title);
        titleBaselineRef.current = ch.title;
        // Book is needed for cost forecast + provider info; load lazily.
        if (!book && bookId) {
          api.getBook(Number(bookId))
            .then(setBook)
            .catch(() => undefined);
        }
        setPreviewVersionId(null);
        // ADR 0002 (Step 6): a working draft newer than the committed version
        // wins — that's the text the author last typed.
        const draftIsNewer =
          ch.draft != null &&
          (!ch.currentVersion ||
            ch.draft.updatedAt > ch.currentVersion.createdAt);
        const initialJson = draftIsNewer
          ? ch.draft!.contentJson
          : ch.currentVersion?.contentJson;
        const doc = parseDoc(initialJson ?? null);
        if (editor) {
          editor.commands.setContent(doc as never, false);
          setWordCount(countWords(editor.getText()));
          editor.setEditable(true);
          baselineJsonRef.current = JSON.stringify(editor.getJSON());
          debouncedSave.setBaseline(editor.getJSON());
          setDirty(false);
          setEditorTick((t) => t + 1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [id, editor, debouncedSave, book, bookId],
  );

  useEffect(() => {
    if (!editor) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editor]);

  /** Перечитать главу после 409 и вернуть панели свежие ожидания. Редактор
   *  намеренно не трогаем: `load()` затёр бы то, что автор успел напечатать,
   *  а кандидат должен пережить перечитывание — иначе выхода из конфликта
   *  просто нет. */
  const rereadForProposal = useCallback(
    async (proposalId: number): Promise<ProposalReread> => {
      const [ch, res] = await Promise.all([
        api.getChapter(id),
        api.getProposalChanges(proposalId),
      ]);
      setChapter(ch);
      return {
        expectedVersionId: ch.currentVersionId ?? null,
        expectedDraftRevision: ch.draft?.revision ?? null,
        changes: res.changes,
      };
    },
    [id],
  );

  // Кандидат, оставшийся в базе с прошлой загрузки страницы: предлагаем его
  // снова, но только если из потока не пришёл более свежий.
  const restoredProposal = useRestoredProposal(id);
  useEffect(() => {
    if (!restoredProposal) return;
    setProposal((prev) => prev ?? restoredProposal.proposal);
    setProposalChanges((prev) =>
      prev.length > 0 ? prev : restoredProposal.changes,
    );
  }, [restoredProposal]);

  const isPreview = previewVersionId !== null;
  const previewVersion = useMemo(
    () => versions?.find((v) => v.id === previewVersionId) ?? null,
    [previewVersionId, versions],
  );

  useEffect(() => {
    isPreviewRef.current = isPreview;
  }, [isPreview]);

  // Recompute dirty when title changes.
  useEffect(() => {
    if (!editor) return;
    recomputeDirty(editor.getJSON(), title);
  }, [title, editor, recomputeDirty]);

  // Inline canon highlights — refresh on chapter mount and after Writer finishes.
  useEffect(() => {
    if (!editor || !bookId) return;
    let cancelled = false;
    const bid = Number(bookId);
    Promise.all([
      api.listCharacters(bid),
      api.listLocations(bid),
      api.listItems(bid),
      api.listHooks(bid),
    ])
      .then(([chars, locs, items, hooks]) => {
        if (cancelled) return;
        const entities: CanonHighlightEntity[] = [
          ...chars.map((c) => ({
            type: "character" as const,
            name: c.canonicalName,
            id: c.id,
          })),
          ...locs.map((l) => ({
            type: "location" as const,
            name: l.name,
            id: l.id,
          })),
          ...items.map((i) => ({
            type: "item" as const,
            name: i.name,
            id: i.id,
          })),
          ...hooks
            .filter((h) => h.description.length >= 4 && h.description.length <= 80)
            .map((h) => ({
              type: "hook" as const,
              name: h.description,
              id: h.id,
            })),
        ];
        setCanonEntities(editor, entities);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editor, bookId, canonRunningSignal]);

  // beforeunload — block tab close / reload while dirty (A1)
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      // legacy spec compatibility
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // In-app navigation blocker (A1)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirty) return false;
    return currentLocation.pathname !== nextLocation.pathname;
  });

  function loadVersionIntoEditor(v: ChapterVersion) {
    if (!editor) return;
    const doc = parseDoc(v.contentJson);
    editor.commands.setContent(doc as never, false);
    setWordCount(countWords(editor.getText()));
    setEditorTick((t) => t + 1);
  }

  function onSelectVersion(v: ChapterVersion) {
    if (!chapter) return;
    if (v.id === chapter.currentVersionId) {
      setPreviewVersionId(null);
      const doc = parseDoc(chapter.currentVersion?.contentJson ?? null);
      editor?.commands.setContent(doc as never, false);
      editor?.setEditable(true);
      return;
    }
    setPreviewVersionId(v.id);
    loadVersionIntoEditor(v);
    editor?.setEditable(true);
  }

  /** `true` — состояние действительно записано. Вызывающие, которые после
   *  сохранения куда-то уходят, обязаны на это смотреть (В10). */
  async function onSave(): Promise<boolean> {
    if (!editor) return false;
    const json = editor.getJSON();
    const newJson = JSON.stringify(json);
    const baselineJson = isPreview
      ? (previewVersion?.contentJson ?? null)
      : (chapter?.currentVersion?.contentJson ?? null);
    const titleChanged = title.trim() !== chapter?.title;
    const emptyDocJson = JSON.stringify(EMPTY_DOC);
    const isEmpty = newJson === emptyDocJson || editor.getText().trim() === "";
    const contentChanged =
      baselineJson === null ? !isEmpty : baselineJson !== newJson;

    if (!contentChanged && !titleChanged) {
      toast.info(
        baselineJson === null && isEmpty
          ? "Текст пуст — сохранять нечего."
          : "Нечего сохранять — изменений нет.",
      );
      // Сохранять было нечего — значит, несохранённого не осталось, и уйти
      // можно.
      return true;
    }

    setSaving(true);
    setActionError(null);
    try {
      if (contentChanged) {
        // Отложенный автосейв досылается ДО коммита, иначе на сервере
        // остаётся черновик десятисекундной давности, и он честно становится
        // отдельной версией — две версии на один осознанный Ctrl+S (К2).
        // В предпросмотре не досылаем: там в редакторе текст старой версии, и
        // автосейв затёр бы настоящий черновик.
        if (!isPreview) {
          debouncedSave.mark(json);
          await debouncedSave.flushNow();
        }
        // Manual save is the deliberate commit: index + run memory extractors.
        await api.createVersion(id, json);
      }
      if (titleChanged) {
        await api.updateChapter(id, { title: title.trim() });
      }
      await load();
      toast.success("Сохранено");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // В10: ошибка ОПЕРАЦИИ рисуется полосой над рукописью, а не заменяет
      // собой страницу. Прежде она уходила в тот же `error`, что и сбой
      // загрузки, и редактор с несохранённым текстом размонтировался —
      // скопировать написанное было уже неоткуда.
      setActionError(msg);
      toast.error("Ошибка сохранения", { description: msg });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function onCancelWriter() {
    if (runningProposalId !== null) {
      void api.cancelProposal(runningProposalId).catch(() => undefined);
    }
    writerAbortRef.current?.abort();
    writerAbortRef.current = null;
  }

  async function onRunWriter() {
    if (!selectedPlan) return;
    if (writing) return;
    const ctrl = new AbortController();
    writerAbortRef.current = ctrl;
    setWriting(true);
    setWriterBuffer("");
    try {
      await streamWriteChapter(
        id,
        undefined,
        {
          onChunk: (text) => {
            setWriterBuffer((b) => b + text);
          },
          onProposal: (proposalId) => setRunningProposalId(proposalId),
          onDone: async (payload) => {
            setWriting(false);
            writerAbortRef.current = null;
            setRunningProposalId(null);
            if (payload.cancelled) {
              toast.info("Генерация остановлена");
              return;
            }
            setProposal(payload.proposal);
            const { changes } = await api.getProposalChanges(payload.proposal.id);
            setProposalChanges(changes);
            // Глава намеренно не перезагружается: текущая версия не менялась,
            // а load() затёр бы несохранённые правки автора.
          },
          onError: (msg) => {
            toast.error("Ошибка Writer", {
              description: msg,
              action: {
                label: "Повторить",
                onClick: () => void onRunWriter(),
              },
            });
            setWriting(false);
            writerAbortRef.current = null;
          },
          onAbort: () => {
            setWriting(false);
            writerAbortRef.current = null;
            toast.success("Стрим остановлен", {
              description: "Уже сгенерированный текст оставлен в буфере.",
            });
          },
        },
        ctrl.signal,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Ошибка Writer", { description: msg });
      setWriting(false);
      writerAbortRef.current = null;
    }
  }

  async function onRestore() {
    if (previewVersionId === null) return;
    setRestoring(true);
    setActionError(null);
    try {
      await api.restoreVersion(id, previewVersionId);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  }

  async function handleBlockedSave() {
    // Уходим, только если сохранение удалось. Прежде переход происходил в
    // любом случае, и упавшее сохранение уносило правки вместе с экраном
    // (В10) — оставалось одно всплывающее сообщение.
    if (await onSave()) blocker.proceed?.();
  }

  function handleBlockedDiscard() {
    blocker.proceed?.();
  }

  function handleBlockedCancel() {
    blocker.reset?.();
  }

  // Hotkeys: Ctrl+S save, Ctrl+Enter Writer, Esc → stop Writer or close preview (D).
  useHotkeys(
    {
      "mod+s": (e) => {
        e.preventDefault();
        void onSave();
      },
      "mod+enter": (e) => {
        if (writing || !selectedPlan) return;
        e.preventDefault();
        void onRunWriter();
      },
      esc: () => {
        if (writing) {
          onCancelWriter();
          return;
        }
        if (previewVersionId !== null) setPreviewVersionId(null);
      },
    },
    [previewVersionId, writing, selectedPlan, title, chapter],
  );

  if (error) {
    return (
      <div className="route">
        <div style={{ maxWidth: 880, margin: "0 auto", padding: 32 }}>
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  }
  if (!chapter || versions === null || !editor) {
    return <PageSkeleton label="Глава загружается" />;
  }

  const currentVersion =
    versions.find((v) => v.id === chapter.currentVersionId) ?? null;
  // Номер в шапке рукописи — позиция главы в оглавлении, а не order_index
  // (тот идёт с шагом 10 и в номер главы не превращается).
  const orderLabel = outlinePosition != null ? String(outlinePosition) : null;

  const sidebar = (
    <SidebarPanels
      bookId={Number(bookId)}
      chapterId={id}
      versions={versions}
      currentVersionId={chapter.currentVersionId}
      previewVersionId={previewVersionId}
      onSelectVersion={onSelectVersion}
      onCompareVersion={(v) => setCompareVersionId(v.id)}
      canonRunningSignal={canonRunningSignal}
    />
  );

  return (
    <div className="route page-chapter" data-screen-label="Chapter">
      <div className="chapter-toolbar">
        <Link
          to={`/books/${bookId}/studio/chapters`}
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none" }}
        >
          ← К главам
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="lg:hidden"
          onClick={() => setMobilePanelsOpen(true)}
          aria-label="Открыть панели и версии"
        >
          <PanelRightOpen className="size-4" aria-hidden="true" />
          Панели
        </Button>

        <span className="ch-toolbar-spacer" />

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={onRunWriter}
            disabled={writing || !selectedPlan}
            variant="default"
            aria-busy={writing || undefined}
          >
            {writing ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Writer пишет…
              </>
            ) : (
              "Запустить Writer"
            )}
          </Button>
          {writing && (
            <Button
              onClick={onCancelWriter}
              variant="destructive"
              aria-label="Остановить Writer (Esc)"
              title="Остановить Writer (Esc)"
            >
              <Square className="size-4" aria-hidden="true" />
              Стоп
            </Button>
          )}
          {!selectedPlan && !writing && (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Выбери вариант плана выше, чтобы запустить Writer.
            </span>
          )}
          {selectedPlan && !writing && (
            <WriterCostBadge book={book} estimatedWords={selectedPlan.estimatedWords} />
          )}
        </div>

        <FocusToggle />

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setLeftCollapsed((v) => !v)}
          aria-pressed={leftCollapsed}
          title="Оглавление"
        >
          ⌸
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRightCollapsed((v) => !v)}
          aria-pressed={rightCollapsed}
          title="Панели разбора"
        >
          ⌹
        </button>
      </div>

      <div
        className={`chapter-grid ${leftCollapsed ? "chapter-grid-noleft" : ""} ${
          rightCollapsed ? "chapter-grid-noright" : ""
        }`}
      >
        <OutlineRail
          bookId={Number(bookId)}
          activeChapterId={id}
          collapsed={leftCollapsed}
          onActivePosition={setOutlinePosition}
        />

        <main className="chapter-main">
          <div className="flex flex-col gap-4 px-6 pt-6">
            {isPreview && (
              <div
                role="status"
                className="card"
                style={{
                  borderLeft: "3px solid var(--color-ink-amber)",
                  fontSize: 13,
                  padding: "10px 14px",
                }}
              >
                Просмотр старой версии (#{previewVersion?.id}). Сохранение
                создаст новую версию-ветку.
              </div>
            )}

            <MemoryLagWarning
              chapters={memory?.pendingEarlierChapters ?? []}
            />

            <MemoryStaleBanner
              staleFromPosition={memory?.bookStaleFromPosition ?? null}
              onRebuild={() => void onRebuildMemory()}
              rebuilding={memoryRebuilding}
            />

            <MemoryPipelineBanner
              outdatedChapters={memory?.outdatedPipelineChapters ?? 0}
              // С первой главы, а не с отметки устаревания: прежним разбором
              // собрана вся книга, и частичное перестроение оставило бы её
              // наполовину без событий героев.
              onRebuild={() => void onRebuildMemory(1)}
              rebuilding={memoryRebuilding}
            />

            <PlanPanel
              chapter={chapter}
              onUpdated={load}
              onPlanReady={setSelectedPlan}
            />

            {writing && writerBuffer && (
              <div
                className="panel streaming-edge"
                style={{
                  padding: 16,
                  maxHeight: 400,
                  overflow: "auto",
                }}
                aria-live="polite"
              >
                <div className="caption" style={{ marginBottom: 8 }}>
                  Live stream · агент пишет · Esc — отмена
                </div>
                <pre
                  className="whitespace-pre-wrap"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    color: "var(--color-text)",
                    margin: 0,
                  }}
                >
                  {writerBuffer}
                </pre>
              </div>
            )}

            {proposal && (
              <ProposalPanel
                proposal={proposal}
                changes={proposalChanges}
                expectedVersionId={chapter?.currentVersionId ?? null}
                expectedDraftRevision={chapter?.draft?.revision ?? null}
                onReread={async () => {
                  const fresh = await rereadForProposal(proposal.id);
                  setProposalChanges(fresh.changes);
                  return fresh;
                }}
                onAccepted={async () => {
                  setProposal(null);
                  setProposalChanges([]);
                  setWriterBuffer("");
                  setCanonRunningSignal((s) => s + 1);
                  await load();
                  toast.success("Глава принята");
                }}
                onRejected={() => {
                  setProposal(null);
                  setProposalChanges([]);
                  setWriterBuffer("");
                }}
              />
            )}
          </div>

          <div className="ms-wrap">
            <div className="ms-paper paper-grain">
              <span className="ms-margin" aria-hidden="true" />

              <div className="ms-head">
                <div className="ms-chapter-label cap-upper">
                  Глава{orderLabel ? ` ${orderLabel}` : ""}
                </div>
                <input
                  className="ms-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isPreview}
                  aria-label="Название главы"
                />
              </div>

              <div className="ms-body">
                {actionError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 text-sm"
                    style={{
                      border: "1px solid var(--color-ink-red-fg)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      marginBottom: 10,
                      color: "var(--color-ink-red-fg)",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      Не удалось сохранить: {actionError}. Текст на месте —
                      попробуйте ещё раз.
                    </span>
                    <button
                      type="button"
                      onClick={() => void onSave()}
                      disabled={saving}
                      className="text-xs border rounded px-2 py-0.5"
                      style={{ borderColor: "var(--color-ink-red-fg)" }}
                    >
                      Повторить
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-xs border rounded px-2 py-0.5"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      Скрыть
                    </button>
                  </div>
                )}
                <EditorToolbar
                  editor={editor}
                  editorTick={editorTick}
                  onSave={onSave}
                  saving={saving}
                />
                <div
                  style={{ position: "relative", cursor: "text" }}
                  onClick={() => editor.chain().focus().run()}
                >
                  <EditorContent editor={editor} />
                  {editor.isEmpty && !writing && !isPreview && (
                    <EmptyEditorHint
                      hasPlan={selectedPlan !== null}
                      onRunWriter={() => void onRunWriter()}
                    />
                  )}
                </div>
              </div>

              <div className="ms-footer mono faint">
                <AutosaveStatus
                  saving={debouncedSave.saving}
                  lastSavedAt={debouncedSave.lastSavedAt}
                  error={saveError}
                  isPreview={isPreview}
                  wordCount={wordCount}
                  dirty={dirty}
                />
                <InkwellStatus />
                <MemoryStatusBadge
                  memory={memory}
                  onRetry={() => void onRetryMemory()}
                  retrying={memoryRetrying}
                />
              </div>
            </div>
          </div>

          {!isPreview && <InlineCommandPanel editor={editor} chapterId={id} />}

          <div className="flex gap-2 px-6 pb-6">
            <Button onClick={onSave} disabled={saving} aria-busy={saving || undefined}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Сохранение…
                </>
              ) : (
                "Сохранить"
              )}
            </Button>
            {isPreview && (
              <Button
                variant="secondary"
                onClick={onRestore}
                disabled={restoring}
                aria-busy={restoring || undefined}
              >
                {restoring ? "Восстановление…" : "Восстановить"}
              </Button>
            )}
          </div>
        </main>

        <aside
          className={`cri-rail ${rightCollapsed ? "cri-rail-collapsed" : ""}`}
          aria-label="Разбор и материалы"
        >
          <div className="flex flex-col gap-3 p-3 overflow-auto h-full">
            <CritiquePanel
              versionId={chapter.currentVersionId}
              expectedVersionId={chapter.currentVersionId}
              expectedDraftRevision={chapter.draft?.revision ?? null}
              onRereadProposal={rereadForProposal}
              onRepairDone={load}
            />
            {sidebar}
          </div>
        </aside>
      </div>

      {/* Mobile drawer — CritiquePanel lives only in .cri-rail on desktop
          (display:none below 1024px), so mirror it here for mobile access.
          Sheet renders its children into the DOM at all times (visibility is
          CSS transform/opacity only, not conditional mount), so this instance
          is gated on mobilePanelsOpen to avoid fetching critique data before
          the drawer is ever opened. */}
      <Sheet
        open={mobilePanelsOpen}
        onClose={() => setMobilePanelsOpen(false)}
        title="Панели и версии"
      >
        <div className="flex flex-col gap-3">
          {mobilePanelsOpen && (
            <CritiquePanel
              versionId={chapter.currentVersionId}
              expectedVersionId={chapter.currentVersionId}
              expectedDraftRevision={chapter.draft?.revision ?? null}
              onRereadProposal={rereadForProposal}
              onRepairDone={load}
            />
          )}
          {sidebar}
        </div>
      </Sheet>

      {/* Version diff modal */}
      <VersionDiff
        open={compareVersionId !== null}
        onClose={() => setCompareVersionId(null)}
        baseVersion={currentVersion}
        compareVersion={
          versions.find((v) => v.id === compareVersionId) ?? null
        }
      />

      {/* Navigation-blocker dialog (A1) */}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Сохранить изменения перед уходом?"
        description="В главе есть несохранённые правки. Если уйти — они исчезнут."
        confirmText="Сохранить и уйти"
        cancelText="Остаться"
        busy={saving}
        onConfirm={() => void handleBlockedSave()}
        onCancel={handleBlockedCancel}
      />
      {blocker.state === "blocked" && (
        <DiscardOption onDiscard={handleBlockedDiscard} />
      )}
    </div>
  );
}

// Floating "discard" link layered onto the blocker dialog. Kept separate so
// ConfirmDialog stays a 2-action contract (save / cancel) for reuse.
function DiscardOption({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center pointer-events-none p-4"
      aria-hidden="true"
    >
      <button
        type="button"
        onClick={onDiscard}
        className="pointer-events-auto translate-y-[-92px] rounded-md bg-[var(--color-background)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-ink-red-fg)] shadow-sm"
      >
        Отбросить изменения и уйти
      </button>
    </div>
  );
}

interface SidebarPanelsProps {
  bookId: number;
  chapterId: number;
  versions: ChapterVersion[];
  currentVersionId: number | null;
  previewVersionId: number | null;
  onSelectVersion: (v: ChapterVersion) => void;
  onCompareVersion: (v: ChapterVersion) => void;
  canonRunningSignal: number;
}

function SidebarPanels({
  bookId,
  chapterId,
  versions,
  currentVersionId,
  previewVersionId,
  onSelectVersion,
  onCompareVersion,
  canonRunningSignal,
}: SidebarPanelsProps) {
  return (
    <>
      <CanonPanel
        bookId={bookId}
        chapterId={chapterId}
        runningSignal={canonRunningSignal}
      />

      <h2
        className="font-display"
        style={{
          fontSize: 20,
          fontWeight: 500,
          margin: 0,
          color: "var(--color-text-strong)",
        }}
      >
        Версии
      </h2>
      {versions.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Версий пока нет. Сохраните, чтобы создать первую.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((v) => {
            const isCurrent = v.id === currentVersionId;
            const isSelected = v.id === previewVersionId;
            return (
              <li key={v.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onSelectVersion(v)}
                  aria-current={isSelected ? "true" : undefined}
                  className={
                    "w-full text-left rounded-md border min-h-[44px] py-3 px-3 text-sm transition-shadow " +
                    (isSelected
                      ? "border-[var(--color-ring)] bg-[var(--color-accent)] shadow-sm"
                      : "border-[var(--color-border)] hover:bg-[var(--color-accent)] hover:shadow-sm")
                  }
                >
                  <div className="flex justify-between">
                    <span className="font-medium">#{v.id}</span>
                    {isCurrent && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        (current)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {new Date(v.createdAt).toLocaleString("ru-RU")} ·{" "}
                    {v.wordCount} слов
                  </div>
                </button>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => onCompareVersion(v)}
                    className="self-start text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    aria-label={`Сравнить версию #${v.id} с текущей`}
                  >
                    сравнить с текущей →
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

interface EditorToolbarProps {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  editorTick: number;
  onSave: () => void;
  saving: boolean;
}

function EditorToolbar({
  editor,
  editorTick,
  onSave,
  saving,
}: EditorToolbarProps) {
  // Reading editorTick triggers re-evaluation of canUndo/canRedo on every change.
  void editorTick;
  const canUndo = editor.can().undo();
  const canRedo = editor.can().redo();
  return (
    <div
      className="flex items-center gap-1 -mb-2"
      role="toolbar"
      aria-label="Редактор главы"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!canUndo}
        aria-label="Отменить (Ctrl+Z)"
        title="Отменить (Ctrl+Z)"
      >
        <Undo2 className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!canRedo}
        aria-label="Вернуть (Ctrl+Shift+Z)"
        title="Вернуть (Ctrl+Shift+Z)"
      >
        <Redo2 className="size-4" aria-hidden="true" />
      </Button>
      <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
        <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] text-[10px]">
          Ctrl+S
        </kbd>{" "}
        сохранить ·{" "}
        <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] text-[10px]">
          Ctrl+Enter
        </kbd>{" "}
        Writer
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSave}
        disabled={saving}
        aria-label="Сохранить (Ctrl+S)"
        title="Сохранить (Ctrl+S)"
      >
        Сохранить
      </Button>
    </div>
  );
}

interface AutosaveStatusProps {
  saving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
  isPreview: boolean;
  wordCount: number;
  dirty: boolean;
}

function AutosaveStatus({
  saving,
  lastSavedAt,
  error,
  isPreview,
  wordCount,
  dirty,
}: AutosaveStatusProps) {
  let icon: ReactNode;
  let label: ReactNode;
  if (error) {
    icon = (
      <AlertCircle
        className="size-3.5 text-[var(--color-ink-red-fg)]"
        aria-hidden="true"
      />
    );
    label = (
      <span className="text-[var(--color-ink-red-fg)]">
        Не удалось сохранить
      </span>
    );
  } else if (saving) {
    icon = (
      <Loader2
        className="size-3.5 animate-spin text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      />
    );
    label = "Автосохранение…";
  } else if (lastSavedAt) {
    icon = (
      <Check
        className="size-3.5 text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      />
    );
    label =
      "Сохранено " +
      lastSavedAt.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
  } else {
    icon = null;
    label = dirty ? "Изменено · ещё не сохранено" : "Не изменено";
  }
  return (
    <div
      className="text-xs text-[var(--color-muted-foreground)] flex items-center gap-3"
      role="status"
      aria-live="polite"
    >
      <span>Слов: {wordCount}</span>
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      {isPreview && <span>· Предпросмотр (автосохранение off)</span>}
    </div>
  );
}

function WriterCostBadge({
  book,
  estimatedWords,
}: {
  book: Book | null;
  estimatedWords: number | undefined;
}) {
  if (!book) return null;
  const isOllama = book.writerProvider === "ollama";
  // Heuristic: 4k Russian words ≈ 4500 input + 11000 output tokens.
  const refWords = 4000;
  const targetWords = estimatedWords && estimatedWords > 0 ? estimatedWords : refWords;
  const scale = targetWords / refWords;
  const inputTokens = Math.round(4500 * scale);
  const outputTokens = Math.round(11000 * scale);
  const modelApi = MODEL_IDS[book.writerModel === "opus" ? "opus" : "sonnet"];
  const cost = isOllama
    ? 0
    : calculateCost({
        model: modelApi,
        inputTokens,
        outputTokens,
      }).totalUsd;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)]"
      title={`${inputTokens} in / ${outputTokens} out tokens`}
    >
      {isOllama ? (
        <>
          <span className="font-medium text-[var(--color-foreground)]">
            ~$0.00
          </span>{" "}
          · local · {book.writerLocalModel ?? "ollama"}
        </>
      ) : (
        <>
          <span className="font-medium text-[var(--color-foreground)]">
            {formatUsdApprox(cost)}
          </span>{" "}
          · {book.writerModel} · ~{targetWords} сл.
        </>
      )}
    </span>
  );
}

function EmptyEditorHint({
  hasPlan,
  onRunWriter,
}: {
  hasPlan: boolean;
  onRunWriter: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none"
      aria-hidden="true"
    >
      <div className="pointer-events-auto max-w-md text-center text-sm text-[var(--color-muted-foreground)] flex flex-col gap-3 items-center">
        <p>
          Пустой холст. Выберите{" "}
          <span className="font-medium">план в правой панели</span> →{" "}
          {hasPlan
            ? "запустите Writer одной кнопкой."
            : "затем нажмите «Запустить Writer»."}
        </p>
        <p className="text-xs opacity-75">
          Или начните печатать сами — автосейв включён.
        </p>
        {hasPlan && (
          <Button type="button" variant="default" size="sm" onClick={onRunWriter}>
            Запустить Writer
          </Button>
        )}
      </div>
    </div>
  );
}
