import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { OutlinePanel } from "@/components/OutlinePanel";
import { ImportExportPanel } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import type {
  Book,
  BookStatus,
  Chapter,
  ModelChoice,
  StyleProfile,
  WriterProvider,
} from "@book-forge/shared";
import { calculateCost } from "@book-forge/shared";

const STATUSES: BookStatus[] = ["draft", "active", "archived"];
const MODELS: ModelChoice[] = ["sonnet", "opus"];
const PROVIDERS: WriterProvider[] = ["anthropic", "ollama"];
const MODEL_API_ID: Record<ModelChoice, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

// Empirical per-chapter token averages (4k-word RU chapter).
// Writer = ~4500 in / 11000 out; Plot = ~2500 in / 1500 out;
// Critic batch (4 critics) = ~12000 in / 3000 out total.
const PER_CHAPTER_TOKENS = {
  writer: { input: 4500, output: 11000 },
  plot: { input: 2500, output: 1500 },
  critic: { input: 12000, output: 3000 },
};

function estimatePerChapterUsd(
  writer: ModelChoice,
  plot: ModelChoice,
  critic: ModelChoice,
): number {
  const w = calculateCost({
    model: MODEL_API_ID[writer],
    inputTokens: PER_CHAPTER_TOKENS.writer.input,
    outputTokens: PER_CHAPTER_TOKENS.writer.output,
  }).totalUsd;
  const p = calculateCost({
    model: MODEL_API_ID[plot],
    inputTokens: PER_CHAPTER_TOKENS.plot.input,
    outputTokens: PER_CHAPTER_TOKENS.plot.output,
  }).totalUsd;
  const cr = calculateCost({
    model: MODEL_API_ID[critic],
    inputTokens: PER_CHAPTER_TOKENS.critic.input,
    outputTokens: PER_CHAPTER_TOKENS.critic.output,
  }).totalUsd;
  return w + p + cr;
}

export function BookPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [status, setStatus] = useState<BookStatus>("draft");
  const [styleProfileId, setStyleProfileId] = useState<number | null>(null);
  const [writerModel, setWriterModel] = useState<ModelChoice>("opus");
  const [plotModel, setPlotModel] = useState<ModelChoice>("sonnet");
  const [criticModel, setCriticModel] = useState<ModelChoice>("sonnet");
  const [writerProvider, setWriterProvider] = useState<WriterProvider>("anthropic");
  const [writerLocalModel, setWriterLocalModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setError(null);
    try {
      const [b, chs, sp] = await Promise.all([
        api.getBook(id),
        api.listChapters(id),
        api.listStyleProfiles(),
      ]);
      setBook(b);
      setChapters(chs);
      setStyleProfiles(sp);
      setTitle(b.title);
      setPremise(b.premise ?? "");
      setStatus(b.status);
      setStyleProfileId(b.styleProfileId);
      setWriterModel(b.writerModel);
      setPlotModel(b.plotModel);
      setCriticModel(b.criticModel);
      setWriterProvider(b.writerProvider);
      setWriterLocalModel(b.writerLocalModel ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateBook(id, {
        title: title.trim() || book!.title,
        premise: premise.trim() === "" ? null : premise,
        status,
        styleProfileId,
        writerModel,
        plotModel,
        criticModel,
        writerProvider,
        writerLocalModel:
          writerProvider === "ollama" && writerLocalModel.trim()
            ? writerLocalModel.trim()
            : null,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onAddChapter(e: FormEvent) {
    e.preventDefault();
    if (!chapterTitle.trim()) return;
    setError(null);
    try {
      await api.createChapter(id, { title: chapterTitle.trim() });
      setChapterTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onConfirmDelete() {
    setDeleting(true);
    try {
      await api.deleteBook(id);
      toast.success("Книга удалена");
      navigate("/books");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Не удалось удалить", { description: msg });
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!book || chapters === null) {
    return <PageSkeleton label="Книга загружается" />;
  }

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link to="/books" className="text-sm underline">
          ← К списку книг
        </Link>
        <Link
          to={`/books/${bookId}/studio`}
          className="text-sm border border-blue-600 text-blue-600 rounded-md px-3 py-1 hover:bg-blue-600 hover:text-white"
        >
          ✨ Открыть Studio
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <input
          className="text-2xl font-bold border-b border-[var(--color-border)] py-1 outline-none focus:border-[var(--color-ring)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="text-sm font-medium">Замысел</label>
        <textarea
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-h-[120px]"
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="Краткое описание книги"
        />

        <label className="text-sm font-medium">Статус</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
          value={status}
          onChange={(e) => setStatus(e.target.value as BookStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="text-sm font-medium">Стилевой профиль</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
          value={styleProfileId ?? ""}
          onChange={(e) =>
            setStyleProfileId(
              e.target.value === "" ? null : Number(e.target.value),
            )
          }
        >
          <option value="">— без стиля —</option>
          {styleProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.fingerprint ? " (нет fingerprint)" : ""}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Writer model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={writerModel}
              onChange={(e) => setWriterModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Plot model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={plotModel}
              onChange={(e) => setPlotModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Critic model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={criticModel}
              onChange={(e) => setCriticModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Прогноз ~$
          {writerProvider === "ollama"
            ? estimatePerChapterUsd("sonnet", plotModel, criticModel).toFixed(2)
            : estimatePerChapterUsd(writerModel, plotModel, criticModel).toFixed(
                2,
              )}
          {" "}/ глава при текущих настройках (4k слов; без учёта prompt-кэша
          {writerProvider === "ollama" ? "; Writer бесплатный — локальная модель" : ""}
          ).
        </p>

        <fieldset
          className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-2"
          aria-label="Провайдер для Writer"
        >
          <legend className="px-1 text-xs font-medium text-[var(--color-muted-foreground)]">
            Provider для Writer
          </legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {PROVIDERS.map((p) => (
              <label key={p} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="writer-provider"
                  value={p}
                  checked={writerProvider === p}
                  onChange={() => setWriterProvider(p)}
                />
                <span>
                  {p === "anthropic" ? "Cloud (Anthropic)" : "Local (Ollama)"}
                </span>
              </label>
            ))}
          </div>
          {writerProvider === "ollama" && (
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-[var(--color-muted-foreground)]"
                htmlFor="writer-local-model"
              >
                Тег локальной модели
              </label>
              <input
                id="writer-local-model"
                className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
                value={writerLocalModel}
                onChange={(e) => setWriterLocalModel(e.target.value)}
                placeholder="например, qwen2.5:14b-instruct"
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Сервер должен достигать Ollama по{" "}
                <code>OLLAMA_BASE_URL</code> (по умолчанию{" "}
                <code>http://127.0.0.1:11434</code>). Plot и Critic остаются на
                cloud-моделях.
              </p>
            </div>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            aria-label={`Удалить книгу «${book.title}»`}
          >
            Удалить книгу
          </Button>
        </div>
      </section>

      {/* dialog below */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Удалить «${book.title}»?`}
        description={
          <>
            Будут безвозвратно удалены: книга и{" "}
            <strong>{chapters.length}</strong>{" "}
            {chapters.length === 1
              ? "глава"
              : chapters.length >= 2 && chapters.length <= 4
                ? "главы"
                : "глав"}
            , а также её план, канон и история стиля. Действие необратимо.
          </>
        }
        confirmText="Удалить навсегда"
        cancelText="Не удалять"
        variant="destructive"
        busy={deleting}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      <OutlinePanel book={book} onUpdated={load} />

      <KnowledgePanel bookId={id} />

      <ImportExportPanel bookId={id} onImported={load} />

      <SearchPanel bookId={id} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Главы</h2>

        <form onSubmit={onAddChapter} className="flex gap-2">
          <input
            className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
            placeholder="Название главы"
            value={chapterTitle}
            onChange={(e) => setChapterTitle(e.target.value)}
          />
          <Button type="submit" disabled={!chapterTitle.trim()}>
            + Новая глава
          </Button>
        </form>

        {chapters.length === 0 ? (
          <p className="text-[var(--color-muted-foreground)]">Глав пока нет.</p>
        ) : (
          <SortableChapterList
            chapters={chapters}
            bookId={id}
            onReordered={(next) => setChapters(next)}
            onPersistError={setError}
          />
        )}
      </section>
    </main>
  );
}

interface SortableChapterListProps {
  chapters: Chapter[];
  bookId: number;
  onReordered: (next: Chapter[]) => void;
  onPersistError: (msg: string) => void;
}

function SortableChapterList({
  chapters,
  bookId,
  onReordered,
  onPersistError,
}: SortableChapterListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chapters.findIndex((c) => String(c.id) === String(active.id));
    const newIndex = chapters.findIndex((c) => String(c.id) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(chapters, oldIndex, newIndex);
    // Renumber by 10 (10, 20, 30...) so future inserts have room.
    const renumbered = reordered.map((c, i) => ({
      ...c,
      orderIndex: (i + 1) * 10,
    }));
    // Optimistic UI.
    onReordered(renumbered);

    try {
      // Persist only changed rows (compare to original).
      const changed = renumbered.filter((c, i) => {
        const prev = chapters.find((p) => p.id === c.id);
        return !prev || prev.orderIndex !== c.orderIndex;
      });
      await Promise.all(
        changed.map((c) => api.updateChapter(c.id, { orderIndex: c.orderIndex })),
      );
      toast.success("Порядок глав обновлён");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onPersistError(msg);
      toast.error("Не удалось переупорядочить", { description: msg });
      // Revert.
      onReordered(chapters);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={chapters.map((c) => String(c.id))}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2" aria-label="Главы (можно перетаскивать)">
          {chapters.map((c) => (
            <SortableChapterItem key={c.id} chapter={c} bookId={bookId} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableChapterItem({
  chapter,
  bookId,
}: {
  chapter: Chapter;
  bookId: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(chapter.id) });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border border-[var(--color-border)] rounded-md p-3 hover:bg-[var(--color-accent)] flex items-center gap-2"
    >
      <button
        type="button"
        aria-label="Перетащить главу"
        className="cursor-grab active:cursor-grabbing text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <Link
        to={`/books/${bookId}/chapters/${chapter.id}`}
        className="block flex-1"
      >
        <div className="flex justify-between items-center">
          <div>
            <span className="text-xs text-[var(--color-muted-foreground)] mr-2">
              #{chapter.orderIndex}
            </span>
            <span className="font-medium">{chapter.title}</span>
          </div>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {chapter.status}
          </span>
        </div>
      </Link>
    </li>
  );
}
