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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { PlanPanel } from "@/components/PlanPanel";
import { CritiquePanel } from "@/components/CritiquePanel";
import { InlineCommandPanel } from "@/components/InlineCommandPanel";
import { CanonPanel } from "@/components/CanonPanel";
import { VersionDiff } from "@/components/VersionDiff";
import { FocusToggle } from "@/components/atmosphere/FocusToggle";
import { InkwellStatus } from "@/components/atmosphere/InkwellStatus";
import { OutlineRail } from "@/components/chapter/OutlineRail";
import { SceneStatePanel } from "@/components/chapter/SceneStatePanel";
import { ChatPanel } from "@/components/chapter/ChatPanel";
import { AuthorNotesPanel } from "@/components/chapter/AuthorNotesPanel";
import { StyleFreshnessNote } from "@/components/chapter/StyleFreshnessNote";
import {
  ProposalPanel,
  type ProposalReread,
} from "@/components/chapter/ProposalPanel";
import { api, streamWriteChapter } from "@/api/client";
import { toast } from "@/lib/toast";
import { formatUsdApprox } from "@/lib/money";
import { useDebouncedSave } from "@/lib/useDebouncedSave";
import { PanelBoundary } from "@/components/PanelBoundary";
import { reportSave, resetSaveStatus } from "@/lib/saveStatus";
import { finishJob, startJob, updateJob } from "@/lib/jobs";
import { plural } from "@/lib/format";
import { ChapterStateDot, chapterState, chapterStateLabel } from "@/components/book/StageStatus";
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
  /** Выбор автора живёт между главами: режим — привычка, а не свойство главы. */
  const [writeMode, setWriteMode] = useState<"whole" | "beats">(() => {
    try {
      return localStorage.getItem("bf-write-mode") === "beats" ? "beats" : "whole";
    } catch {
      return "whole";
    }
  });
  const [beatProgress, setBeatProgress] = useState<{ index: number; total: number } | null>(null);
  const [holding, setHolding] = useState(false);
  /** С какого беата дописывать: частично написанная и уже принятая глава. */
  const [resumeFromBeat, setResumeFromBeat] = useState<number | null>(null);
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
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  /** Правая колонка — вкладки, видна одна за раз. Все панели остаются
   *  смонтированными: идущий разбор критиков не должен обрываться от
   *  переключения вкладки. */
  const [railTab, setRailTab] = useState<RailTab>("critique");
  const [writeMenuOpen, setWriteMenuOpen] = useState(false);
  /** null — автор ещё не трогал: план открыт, пока не выбран. */
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  const planShown = planOpen ?? selectedPlan === null;
  const [outlinePosition, setOutlinePosition] = useState<number | null>(null);
  const [canonRunningSignal, setCanonRunningSignal] = useState(0);
  const [compareVersionId, setCompareVersionId] = useState<number | null>(null);
  const [memory, setMemory] = useState<ChapterMemoryInfo | null>(null);
  const [memoryRetrying, setMemoryRetrying] = useState(false);
  const [memoryRebuilding, setMemoryRebuilding] = useState(false);
  /** Имена героев книги — панель кандидата ищет по ним пропавшие упоминания
   *  (Task 6). Тот же список, что уже грузится ниже для подсветки канона. */
  const [characterNames, setCharacterNames] = useState<string[]>([]);

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
          // Название сравнивается с сохранённым, а не само с собой (С13):
          // прежнее выражение было тождественно false, и правка одного лишь
          // названия молча теряла признак несохранённого.
          const titleStillChanged = title.trim() !== titleBaselineRef.current.trim();
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
        // Частично написанная и принятая глава: с какого беата продолжать,
        // видно по последнему принятому кандидату — без новых колонок у версии.
        try {
          const list = await api.listProposals(id);
          const partial = list.find(
            (p) =>
              p.acceptedVersionId !== null &&
              p.acceptedVersionId === ch.currentVersionId &&
              p.beatsDone !== null &&
              p.beatsTotal !== null &&
              p.beatsDone < p.beatsTotal,
          );
          setResumeFromBeat(partial ? partial.beatsDone : null);
        } catch {
          setResumeFromBeat(null);
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
        setCharacterNames(chars.map((c) => c.canonicalName));
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
      // В редактор возвращается то же, что и при открытии главы: черновик,
      // если он новее принятой версии (С13 ревью 2026-09-19). Прежде сюда
      // всегда ложился текст версии, и первый же автосейв записывал его
      // поверх черновика — незакоммиченная работа исчезала от одного
      // захода в предпросмотр и обратно.
      // «Новее» считается по содержимому, а не по отметке времени: тот же
      // выбор, что делает выгрузка (К2). Автосейв и принятие версии
      // ложатся в одну секунду, и сравнение времени там врало.
      const draftJson = chapter.draft?.contentJson ?? null;
      const versionJson = chapter.currentVersion?.contentJson ?? null;
      const json =
        draftJson !== null && draftJson !== versionJson ? draftJson : versionJson;
      const doc = parseDoc(json);
      editor?.commands.setContent(doc as never, false);
      baselineJsonRef.current = JSON.stringify(doc);
      // База сравнения обновлена — признак несохранённого снимается
      // вместе с ней, иначе он держался бы на пустом месте.
      setDirty(title.trim() !== titleBaselineRef.current.trim());
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

  /** Остановиться после текущего беата, сохранив написанное. Не отмена: беат
   *  дописывается, кандидат остаётся и его можно принять. */
  async function onHoldWriter() {
    if (runningProposalId === null) return;
    setHolding(true);
    try {
      await api.holdProposal(runningProposalId);
    } catch (e) {
      setHolding(false);
      toast.error("Не удалось остановить", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onRunWriter(fromBeat?: number) {
    if (!selectedPlan) return;
    if (writing) return;
    const ctrl = new AbortController();
    writerAbortRef.current = ctrl;
    setWriting(true);
    setWriterBuffer("");
    // Хвост прошлого запуска: иначе после остановленной генерации по беатам
    // целая глава писалась бы под «Беат 2 из 3» и с живой кнопкой удержания,
    // которую этот путь всё равно не слушает.
    setBeatProgress(null);
    setHolding(false);
    try {
      await streamWriteChapter(
        id,
        undefined,
        {
          onChunk: (text) => {
            setWriterBuffer((b) => b + text);
          },
          onProposal: (proposalId) => setRunningProposalId(proposalId),
          onBeat: (e) => setBeatProgress(e),
          // Деградация названа вслух: глава без замысла сцены пишется теми же
          // карточками, но герои действуют без намерений — и молча это
          // выглядело бы как обычная генерация.
          onSceneIntent: (status) => {
            if (status.degraded) {
              toast.info("Замысел сцены не собрался", {
                description: "Глава пишется без намерений героев.",
              });
            }
          },
          onDone: async (payload) => {
            setWriting(false);
            writerAbortRef.current = null;
            setRunningProposalId(null);
            setBeatProgress(null);
            setHolding(false);
            if (payload.cancelled) {
              toast.info("Генерация остановлена");
              return;
            }
            if (payload.held) {
              toast.info("Остановлено после беата", {
                description: "Написанное лежит в кандидате — примите его или отклоните.",
              });
            }
            setProposal(payload.proposal);
            const { changes } = await api.getProposalChanges(payload.proposal.id);
            setProposalChanges(changes);
            // Глава намеренно не перезагружается: текущая версия не менялась,
            // а load() затёр бы несохранённые правки автора.
          },
          onError: (msg) => {
            toast.error("Не удалось написать главу", {
              description: msg,
              action: {
                label: "Повторить",
                onClick: () => void onRunWriter(),
              },
            });
            setWriting(false);
            writerAbortRef.current = null;
            setBeatProgress(null);
            setHolding(false);
          },
          onAbort: () => {
            setWriting(false);
            writerAbortRef.current = null;
            setBeatProgress(null);
            setHolding(false);
            toast.success("Стрим остановлен", {
              description: "Уже сгенерированный текст оставлен в буфере.",
            });
          },
        },
        ctrl.signal,
        // Дописывание по определению идёт по беатам: иначе снятая галочка
        // превращала бы кнопку «Дописать с беата» в отказ сервера.
        fromBeat !== undefined ? { mode: "beats", fromBeat } : { mode: writeMode },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Не удалось написать главу", { description: msg });
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

  // Идущее письмо видно в верхней панели на любой странице: что, сколько
  // идёт, «Стоп». Снимается вместе с потоком.
  const cancelRef = useRef<() => void>(() => {});
  cancelRef.current = onCancelWriter;
  const writerJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (!writing) return;
    writerJobRef.current = startJob({
      label: "Пишет главу",
      onStop: () => cancelRef.current(),
    });
    return () => {
      if (writerJobRef.current !== null) finishJob(writerJobRef.current);
      writerJobRef.current = null;
    };
  }, [writing]);
  useEffect(() => {
    if (writerJobRef.current === null) return;
    const where = outlinePosition != null ? ` ${outlinePosition}` : "";
    updateJob(writerJobRef.current, {
      label: holding
        ? `Дописывает беат и остановится · глава${where}`
        : beatProgress
          ? `Пишет главу${where} · беат ${beatProgress.index + 1} из ${beatProgress.total}`
          : `Пишет главу${where}`,
    });
  }, [beatProgress, holding, outlinePosition, writing]);

  // Меню «Написать» закрывается по Esc и по клику мимо.
  useEffect(() => {
    if (!writeMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest(".write-split")) return;
      setWriteMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [writeMenuOpen]);

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

  return (
    <div className="route page-chapter" data-screen-label="Chapter">
      <div className="chapter-bar">
        <div className="chapter-bar-title">
          <button
            type="button"
            className="chapter-bar-toc"
            onClick={() => setLeftCollapsed((v) => !v)}
            aria-pressed={!leftCollapsed}
            aria-label={leftCollapsed ? "Показать оглавление" : "Скрыть оглавление"}
            title="Оглавление"
          >
            {leftCollapsed ? "›" : "‹"}
          </button>
          {orderLabel && <span className="mono faint">Глава {orderLabel}</span>}
          <span className="chapter-bar-name">{title || chapter.title}</span>
          <span className={`ctable-state ctable-state-${chapterState(chapter)}`}>
            <ChapterStateDot state={chapterState(chapter)} />
            {chapterStateLabel(chapterState(chapter))}
          </span>
        </div>

        <div className="chapter-bar-actions">
          <FocusToggle />
          <span className="chapter-bar-sep" aria-hidden="true" />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void onSave()}
            disabled={saving}
            aria-busy={saving || undefined}
            title="Сохранить версию (Ctrl+S)"
          >
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>

          {writing ? (
            <div className="write-live" role="status">
              <span className="job-flame" aria-hidden="true" />
              <span>
                {holding
                  ? "Дописывает беат…"
                  : beatProgress
                    ? `Пишет беат ${beatProgress.index + 1} из ${beatProgress.total}`
                    : "Пишет главу…"}
              </span>
              {/* По беатам ли идёт ЭТОТ запуск, говорит пришедший беат, а не
                  галочка: «Дописать с беата» работает и при снятой. */}
              {beatProgress !== null && !holding && (
                <button type="button" className="write-live-btn" onClick={() => void onHoldWriter()}>
                  Остановить после беата
                </button>
              )}
              <button
                type="button"
                className="job-stop"
                onClick={onCancelWriter}
                aria-label="Остановить (Esc)"
                title="Остановить (Esc)"
              >
                <Square className="size-3" aria-hidden="true" /> Стоп
              </button>
            </div>
          ) : (
            <div className="write-split">
              <button
                type="button"
                className="btn btn-primary write-main"
                onClick={() => void onRunWriter()}
                disabled={!selectedPlan}
                title={selectedPlan ? "Написать главу (Ctrl+Enter)" : "Сначала выберите план главы"}
              >
                Написать главу
              </button>
              <button
                type="button"
                className="btn btn-primary write-more"
                aria-haspopup="menu"
                aria-expanded={writeMenuOpen}
                aria-label="Как писать"
                onClick={() => setWriteMenuOpen((v) => !v)}
              >
                ▾
              </button>
              {writeMenuOpen && (
                <div className="write-menu" role="menu">
                  <label className="write-menu-row">
                    <input
                      type="checkbox"
                      checked={writeMode === "beats"}
                      onChange={(e) => {
                        const next = e.target.checked ? "beats" : "whole";
                        setWriteMode(next);
                        try {
                          localStorage.setItem("bf-write-mode", next);
                        } catch {
                          /* приватное окно */
                        }
                      }}
                    />
                    <span>
                      <span className="write-menu-title">По беатам</span>
                      <span className="write-menu-sub">
                        беат за беатом; можно остановиться после любого
                      </span>
                    </span>
                  </label>
                  {resumeFromBeat !== null && (
                    <button
                      type="button"
                      role="menuitem"
                      className="write-menu-row write-menu-item"
                      disabled={!selectedPlan}
                      onClick={() => {
                        setWriteMenuOpen(false);
                        void onRunWriter(resumeFromBeat);
                      }}
                    >
                      <span className="write-menu-title">Дописать с беата {resumeFromBeat + 1}</span>
                    </button>
                  )}
                  <div className="write-menu-foot">
                    {selectedPlan ? (
                      <WriterCostBadge book={book} estimatedWords={selectedPlan.estimatedWords} />
                    ) : (
                      <span>Сначала выберите план главы.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`chapter-grid ${leftCollapsed ? "chapter-grid-noleft" : ""}`}>
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
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  Просмотр старой версии от{" "}
                  {previewVersion ? new Date(previewVersion.createdAt).toLocaleString("ru-RU") : "—"}.
                  Сохранение создаст новую версию.
                </span>
                <span className="preview-acts">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onRestore}
                    disabled={restoring}
                    aria-busy={restoring || undefined}
                  >
                    {restoring ? "Восстанавливаю…" : "Вернуть эту версию"}
                  </button>
                  {currentVersion && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onSelectVersion(currentVersion)}
                    >
                      К текущей
                    </button>
                  )}
                </span>
              </div>
            )}

            {/* Над рукописью — не больше одного баннера памяти: самый
                весомый из трёх. Следующий покажется, когда уйдёт этот. */}
            {(memory?.outdatedPipelineChapters ?? 0) > 0 ? (
              <MemoryPipelineBanner
                outdatedChapters={memory?.outdatedPipelineChapters ?? 0}
                // С первой главы, а не с отметки устаревания: прежним разбором
                // собрана вся книга, и частичное перестроение оставило бы её
                // наполовину без событий героев.
                onRebuild={() => void onRebuildMemory(1)}
                rebuilding={memoryRebuilding}
              />
            ) : (memory?.bookStaleFromPosition ?? null) !== null ? (
              <MemoryStaleBanner
                staleFromPosition={memory?.bookStaleFromPosition ?? null}
                onRebuild={() => void onRebuildMemory()}
                rebuilding={memoryRebuilding}
              />
            ) : (
              <MemoryLagWarning chapters={memory?.pendingEarlierChapters ?? []} />
            )}

            {/* План главы свёрнут, когда выбран: рукопись главнее. Панель
                смонтирована всегда — выбранный план она сообщает при загрузке. */}
            <section className={`plan-fold ${planShown ? "plan-fold-open" : ""}`}>
              <button
                type="button"
                className="plan-fold-head"
                aria-expanded={planShown}
                onClick={() => setPlanOpen(!planShown)}
              >
                <span>
                  <span aria-hidden="true">{planShown ? "▾" : "▸"}</span>{" "}
                  <span className="strong">План главы</span>
                  {selectedPlan ? (
                    <span className="muted">
                      {" "}· {selectedPlan.label} · {selectedPlan.beats.length}{" "}
                      {plural(selectedPlan.beats.length, "беат", "беата", "беатов")}
                    </span>
                  ) : (
                    <span className="muted"> · не выбран — выберите, чтобы написать главу</span>
                  )}
                </span>
                <span className="faint">{planShown ? "свернуть" : "развернуть"}</span>
              </button>
              <div hidden={!planShown}>
                <PlanPanel chapter={chapter} onUpdated={load} onPlanReady={setSelectedPlan} />
              </div>
            </section>

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
                  Пишет модель · Esc — остановить
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
                baseWordCount={chapter?.currentVersion?.wordCount ?? null}
                characterNames={characterNames}
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
                      className="btn btn-secondary btn-xs"
                      style={{ borderColor: "var(--color-ink-red-fg)" }}
                    >
                      Повторить
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="btn btn-secondary btn-xs"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      Скрыть
                    </button>
                  </div>
                )}
                <EditorToolbar editor={editor} editorTick={editorTick} />
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

          {!isPreview && (
            <PanelBoundary title="Правка фрагмента">
              <InlineCommandPanel editor={editor} chapterId={id} />
            </PanelBoundary>
          )}

        </main>

        <aside className="chapter-rail" aria-label="Панели главы">
          <div role="tablist" aria-label="Панели главы" className="rail-tabs">
            {RAIL_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`rail-tab-${t.id}`}
                aria-selected={railTab === t.id}
                aria-controls={`rail-panel-${t.id}`}
                className={`rail-tab ${railTab === t.id ? "rail-tab-on" : ""}`}
                onClick={() => setRailTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="rail-body">
            <RailPanel id="critique" active={railTab}>
              <PanelBoundary title="Отзыв критиков">
                <CritiquePanel
                  versionId={chapter.currentVersionId}
                  expectedVersionId={chapter.currentVersionId}
                  expectedDraftRevision={chapter.draft?.revision ?? null}
                  baseWordCount={chapter.currentVersion?.wordCount ?? null}
                  characterNames={characterNames}
                  onRereadProposal={rereadForProposal}
                  onRepairDone={load}
                />
              </PanelBoundary>
            </RailPanel>
            <RailPanel id="scene" active={railTab}>
              <PanelBoundary title="Состояние сцены">
                <SceneStatePanel chapterId={id} />
              </PanelBoundary>
            </RailPanel>
            <RailPanel id="canon" active={railTab}>
              <PanelBoundary title="Канон главы">
                <CanonPanel bookId={Number(bookId)} chapterId={id} runningSignal={canonRunningSignal} />
              </PanelBoundary>
              <p className="rail-note">
                Персонажей и предметы правят в{" "}
                <Link to={`/books/${bookId}/canon`} className="link-quiet">
                  Каноне →
                </Link>
              </p>
            </RailPanel>
            <RailPanel id="versions" active={railTab}>
              <VersionsList
                versions={versions}
                currentVersionId={chapter.currentVersionId}
                previewVersionId={previewVersionId}
                onSelectVersion={onSelectVersion}
                onCompareVersion={(v) => setCompareVersionId(v.id)}
              />
            </RailPanel>
            <RailPanel id="chat" active={railTab}>
              <PanelBoundary title="Чат по книге">
                <ChatPanel chapterId={id} />
              </PanelBoundary>
            </RailPanel>
            <RailPanel id="notes" active={railTab}>
              <PanelBoundary title="Заметки автора">
                <AuthorNotesPanel bookId={Number(bookId)} initialNotes={book?.authorNotes ?? null} />
              </PanelBoundary>
            </RailPanel>
            <RailPanel id="style" active={railTab}>
              <PanelBoundary title="Стиль">
                <StyleFreshnessNote bookId={Number(bookId)} />
              </PanelBoundary>
            </RailPanel>
          </div>
        </aside>
      </div>

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
        className="btn btn-destructive btn-xs"
      >
        Отбросить изменения и уйти
      </button>
    </div>
  );
}

const RAIL_TABS = [
  { id: "critique", label: "Критики" },
  { id: "scene", label: "Сцена" },
  { id: "canon", label: "Канон" },
  { id: "versions", label: "Версии" },
  { id: "chat", label: "Чат" },
  { id: "notes", label: "Заметки" },
  { id: "style", label: "Стиль" },
] as const;

type RailTab = (typeof RAIL_TABS)[number]["id"];

function RailPanel({ id, active, children }: { id: RailTab; active: RailTab; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`rail-panel-${id}`}
      aria-labelledby={`rail-tab-${id}`}
      hidden={id !== active}
      className="rail-panel"
    >
      {children}
    </div>
  );
}

interface VersionsListProps {
  versions: ChapterVersion[];
  currentVersionId: number | null;
  previewVersionId: number | null;
  onSelectVersion: (v: ChapterVersion) => void;
  onCompareVersion: (v: ChapterVersion) => void;
}

/** Версии главы: хранятся все. Клик открывает версию для просмотра, у
 *  нетекущей есть «Сравнить» с текущей. */
function VersionsList({
  versions,
  currentVersionId,
  previewVersionId,
  onSelectVersion,
  onCompareVersion,
}: VersionsListProps) {
  return (
    <div className="versions">
      <div className="rail-head">
        <h3>Версии</h3>
        <span className="faint">хранятся все</span>
      </div>
      {versions.length === 0 ? (
        <p className="muted">Версий пока нет. Сохраните главу, чтобы создать первую.</p>
      ) : (
        <ul className="versions-list">
          {versions.map((v) => {
            const isCurrent = v.id === currentVersionId;
            const isSelected = v.id === previewVersionId;
            const when = new Date(v.createdAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <li key={v.id} className={`version ${isSelected ? "version-on" : ""}`}>
                <button
                  type="button"
                  className="version-main"
                  onClick={() => onSelectVersion(v)}
                  aria-current={isSelected ? "true" : undefined}
                >
                  <span className="version-title">
                    {when}
                    {isCurrent && <span className="version-tag">текущая</span>}
                  </span>
                  <span className="mono faint">{v.wordCount.toLocaleString("ru-RU")} слов</span>
                </button>
                {!isCurrent && (
                  <button
                    type="button"
                    className="version-compare"
                    onClick={() => onCompareVersion(v)}
                    aria-label={`Сравнить версию от ${when} с текущей`}
                  >
                    Сравнить
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface EditorToolbarProps {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  editorTick: number;
}

function EditorToolbar({ editor, editorTick }: EditorToolbarProps) {
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
        сохранить версию ·{" "}
        <kbd className="px-1 py-0.5 rounded border border-[var(--color-border)] text-[10px]">
          Ctrl+Enter
        </kbd>{" "}
        написать
      </span>
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
  } else if (dirty) {
    // Набранное после последнего автосейва важнее времени этого автосейва
    // (С13 ревью 2026-09-19): «Сохранено 14:05» поверх несохранённых правок
    // читается как «всё на месте», и автор закрывает вкладку.
    icon = (
      <AlertCircle
        className="size-3.5 text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      />
    );
    label = lastSavedAt
      ? "Есть несохранённые правки · сохранится через несколько секунд"
      : "Изменено · ещё не сохранено";
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
      {isPreview && <span>· Просмотр версии: автосохранение выключено</span>}
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
          · локально · {book.writerLocalModel ?? "ollama"}
        </>
      ) : (
        <>
          <span className="font-medium text-[var(--color-foreground)]">
            {formatUsdApprox(cost)}
          </span>{" "}
          · {book.writerModel === "opus" ? "Opus" : "Sonnet"} · ~{targetWords} слов
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
          Пустой лист. Выберите{" "}
          <span className="font-medium">план главы над рукописью</span> →{" "}
          {hasPlan
            ? "напишите главу одной кнопкой."
            : "затем нажмите «Написать главу»."}
        </p>
        <p className="text-xs opacity-75">
          Или начните печатать сами — автосейв включён.
        </p>
        {hasPlan && (
          <Button type="button" variant="default" size="sm" onClick={onRunWriter}>
            Написать главу
          </Button>
        )}
      </div>
    </div>
  );
}
