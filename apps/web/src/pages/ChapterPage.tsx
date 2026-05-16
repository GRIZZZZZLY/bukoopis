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
import { api, streamWriteChapter } from "@/api/client";
import { toast } from "@/lib/toast";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { useHotkeys } from "@/lib/useHotkeys";
import type {
  Book,
  ChapterBeatSheetVariant,
  ChapterVersion,
  ChapterWithCurrentVersion,
} from "@book-forge/shared";
import { EMPTY_DOC, calculateCost } from "@book-forge/shared";

interface WriterDonePayload {
  version: ChapterVersion;
  tokens: {
    input: number;
    output: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
}

function formatCostToast(p: WriterDonePayload): string {
  const cacheBits =
    (p.tokens.cacheRead ?? 0) > 0 || (p.tokens.cacheCreation ?? 0) > 0
      ? ` · cache R${p.tokens.cacheRead ?? 0}/W${p.tokens.cacheCreation ?? 0}`
      : "";
  return `${p.tokens.input} in / ${p.tokens.output} out${cacheBits}`;
}

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

  const [chapter, setChapter] = useState<ChapterWithCurrentVersion | null>(
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [mobilePanelsOpen, setMobilePanelsOpen] = useState(false);
  const [canonRunningSignal, setCanonRunningSignal] = useState(0);
  const [compareVersionId, setCompareVersionId] = useState<number | null>(null);

  const isPreviewRef = useRef(false);
  const writingRef = useRef(false);
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
        await api.createVersion(id, json);
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
    delayMs: 1000,
  });

  const editor = useEditor({
    extensions: [StarterKit, CanonHighlight],
    content: emptyDoc() as never,
    onUpdate: ({ editor }) => {
      setWordCount(countWords(editor.getText()));
      setEditorTick((t) => t + 1);
      const json = editor.getJSON();
      recomputeDirty(json, title);
      if (isPreviewRef.current || writingRef.current) return;
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
        setTitle(ch.title);
        titleBaselineRef.current = ch.title;
        // Book is needed for cost forecast + provider info; load lazily.
        if (!book && bookId) {
          api.getBook(Number(bookId))
            .then(setBook)
            .catch(() => undefined);
        }
        setPreviewVersionId(null);
        const initialJson = ch.currentVersion?.contentJson;
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

  const isPreview = previewVersionId !== null;
  const previewVersion = useMemo(
    () => versions?.find((v) => v.id === previewVersionId) ?? null,
    [previewVersionId, versions],
  );

  useEffect(() => {
    isPreviewRef.current = isPreview;
  }, [isPreview]);
  useEffect(() => {
    writingRef.current = writing;
  }, [writing]);

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

  async function onSave() {
    if (!editor) return;
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
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (contentChanged) {
        await api.createVersion(id, json);
      }
      if (titleChanged) {
        await api.updateChapter(id, { title: title.trim() });
      }
      await load();
      toast.success("Сохранено");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Ошибка сохранения", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  function onCancelWriter() {
    const ctrl = writerAbortRef.current;
    if (!ctrl) return;
    ctrl.abort();
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
          onDone: async (payload) => {
            setWriting(false);
            writerAbortRef.current = null;
            toast.success("Глава сохранена", {
              description: formatCostToast(payload as WriterDonePayload),
            });
            // Trigger Canon panel to refresh / start polling.
            setCanonRunningSignal((s) => s + 1);
            await load();
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
    setError(null);
    try {
      await api.restoreVersion(id, previewVersionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  }

  async function handleBlockedSave() {
    await onSave();
    blocker.proceed?.();
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
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!chapter || versions === null || !editor) {
    return <PageSkeleton label="Глава загружается" />;
  }

  const currentVersion =
    versions.find((v) => v.id === chapter.currentVersionId) ?? null;

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
    <main className="max-w-6xl mx-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 md:gap-8">
      <section className="flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Link to={`/books/${bookId}/studio/chapters`} className="text-sm underline">
            ← К книге
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setMobilePanelsOpen(true)}
            aria-label="Открыть панели и версии"
          >
            <PanelRightOpen className="size-4" aria-hidden="true" />
            Панели
          </Button>
        </div>

        <input
          className="text-2xl font-bold border-b border-[var(--color-border)] py-1 outline-none focus:border-[var(--color-ring)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPreview}
          aria-label="Название главы"
        />

        {isPreview && (
          <div
            role="status"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm"
          >
            Просмотр старой версии (#{previewVersion?.id}). Сохранение создаст
            новую версию-ветку.
          </div>
        )}

        <PlanPanel
          chapter={chapter}
          onUpdated={load}
          onPlanReady={setSelectedPlan}
        />

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

        {writing && writerBuffer && (
          <div
            className="border border-[var(--color-ring)] rounded-md p-4 bg-[var(--color-muted)] max-h-[400px] overflow-auto"
            aria-live="polite"
          >
            <div className="text-xs text-[var(--color-muted-foreground)] mb-2">
              Live stream (агент пишет, после завершения сохранится как
              версия). Нажмите «Стоп» или Esc для отмены.
            </div>
            <pre className="whitespace-pre-wrap text-sm font-sans">
              {writerBuffer}
            </pre>
          </div>
        )}

        <CritiquePanel
          versionId={chapter.currentVersionId}
          onRepairDone={load}
        />

        <EditorToolbar
          editor={editor}
          editorTick={editorTick}
          onSave={onSave}
          saving={saving}
        />

        <div
          className="relative border border-[var(--color-border)] rounded-md p-4 max-w-none min-h-[280px]"
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

        <AutosaveStatus
          saving={debouncedSave.saving}
          lastSavedAt={debouncedSave.lastSavedAt}
          error={saveError}
          isPreview={isPreview}
          wordCount={wordCount}
          dirty={dirty}
        />

        {!isPreview && <InlineCommandPanel editor={editor} chapterId={id} />}

        <div className="flex gap-2">
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
      </section>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col gap-3">{sidebar}</aside>

      {/* Mobile drawer */}
      <Sheet
        open={mobilePanelsOpen}
        onClose={() => setMobilePanelsOpen(false)}
        title="Панели и версии"
      >
        <div className="flex flex-col gap-3">{sidebar}</div>
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
    </main>
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
        className="pointer-events-auto translate-y-[-92px] rounded-md bg-[var(--color-background)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] shadow-sm"
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

      <h2 className="text-lg font-semibold">Версии</h2>
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
        className="size-3.5 text-[var(--color-destructive)]"
        aria-hidden="true"
      />
    );
    label = (
      <span className="text-[var(--color-destructive)]">
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
  const modelApi =
    book.writerModel === "opus" ? "claude-opus-4-7" : "claude-sonnet-4-6";
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
            ~${cost.toFixed(2)}
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
