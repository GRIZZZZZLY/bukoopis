import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
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
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/pill";
import { OutlinePanel } from "@/components/OutlinePanel";
import { ImportExportPanel } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { StageStepper } from "@/components/studio/StageStepper";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import type { Book, BookConcept, Chapter, StudioState } from "@book-forge/shared";

export function ChaptersStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");

  async function load() {
    setError(null);
    try {
      const [b, chs, c, s] = await Promise.all([
        api.getBook(id),
        api.listChapters(id),
        api.getConcept(id),
        api.getStudioState(id),
      ]);
      setBook(b);
      setChapters(chs);
      setConcept(c);
      setStudio(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  if (!Number.isFinite(id)) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <p
          role="alert"
          className="text-sm rounded-md px-3 py-2 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
        >
          Книга не найдена
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <p
          role="alert"
          className="text-sm rounded-md px-3 py-2 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
        >
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!book || chapters === null || !concept || !studio) {
    return <PageSkeleton label="Главы загружаются" />;
  }

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-8">
      <StageStepper
        bookId={id}
        concept={concept}
        studioState={studio}
        activeStageId="chapters"
      />

      <header className="flex flex-col gap-1">
        <h1
          className="text-[28px] leading-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Главы
        </h1>
        <p className="lw-mono text-[11px] text-[var(--color-text-faint)]">
          {chapters.length === 0
            ? "пока ни одной"
            : chapters.length === 1
              ? "1 глава"
              : `${chapters.length} глав`}
        </p>
      </header>

      <OutlinePanel book={book} onUpdated={load} />

      <KnowledgePanel bookId={id} />

      <ImportExportPanel bookId={id} onImported={load} />

      <SearchPanel bookId={id} />

      <section className="flex flex-col gap-4">
        <h2
          className="text-[22px]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          Список глав
        </h2>

        <form onSubmit={onAddChapter} className="flex gap-2">
          <input
            className="lw-input flex-1"
            placeholder="Название главы"
            value={chapterTitle}
            onChange={(e) => setChapterTitle(e.target.value)}
          />
          <Button type="submit" disabled={!chapterTitle.trim()}>
            + Новая глава
          </Button>
        </form>

        {chapters.length === 0 ? (
          <p className="lw-card text-sm text-[var(--color-text-muted)] italic">
            Глав пока нет. Введите название выше — выкуем первую.
          </p>
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
    const renumbered = reordered.map((c, i) => ({
      ...c,
      orderIndex: (i + 1) * 10,
    }));
    onReordered(renumbered);

    try {
      const changed = renumbered.filter((c) => {
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
      className="lw-card flex items-center gap-3 p-3 group"
    >
      <button
        type="button"
        aria-label="Перетащить главу"
        className="cursor-grab active:cursor-grabbing text-[var(--color-text-faint)] hover:text-[var(--color-brass)] transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <Link
        to={`/books/${bookId}/chapters/${chapter.id}`}
        className="block flex-1 outline-none"
      >
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="lw-mono text-[11px] text-[var(--color-text-faint)] shrink-0">
              #{chapter.orderIndex}
            </span>
            <span
              className="text-[16px] truncate group-hover:text-[var(--color-brass)] transition-colors"
              style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
            >
              {chapter.title}
            </span>
          </div>
          <Pill>{chapter.status}</Pill>
        </div>
      </Link>
    </li>
  );
}
