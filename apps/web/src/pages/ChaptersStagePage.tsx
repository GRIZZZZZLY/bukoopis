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
import { GripVertical, Plus } from "lucide-react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/pill";
import { OutlinePanel } from "@/components/OutlinePanel";
import { ImportExportPanel } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { StageStepper } from "@/components/studio/StageStepper";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import type {
  Book,
  BookConcept,
  Chapter,
  StudioState,
} from "@book-forge/shared";

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
      <div className="route">
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: 32 }}>
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Книга не найдена
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="route">
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: 32 }}>
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
  if (!book || chapters === null || !concept || !studio) {
    return <PageSkeleton label="Главы загружаются" />;
  }

  const countLabel =
    chapters.length === 0
      ? "пока ни одной"
      : chapters.length === 1
        ? "1 глава"
        : `${chapters.length} глав`;

  return (
    <div className="route" data-screen-label="Chapters">
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "32px 32px 96px",
        }}
      >
        {/* Hero */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>
              Этап · Главы
            </div>
            <h1
              className="font-display"
              style={{
                fontSize: 32,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
                letterSpacing: "-0.015em",
              }}
            >
              Главы
            </h1>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 6 }}
            >
              {countLabel}
              {chapters.length > 0 && (
                <>
                  {" · "}
                  <span className="font-mono" style={{ color: "var(--color-text)" }}>
                    {book.title}
                  </span>
                </>
              )}
            </div>
          </div>
          <Link
            to={`/books/${id}/studio`}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← к Studio
          </Link>
        </div>

        {/* Stepper */}
        <div style={{ marginBottom: 28, overflowX: "auto", paddingBottom: 4 }}>
          <StageStepper
            bookId={id}
            concept={concept}
            studioState={studio}
            activeStageId="chapters"
          />
        </div>

        {/* Panels */}
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <OutlinePanel book={book} onUpdated={load} />
        </div>
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <KnowledgePanel bookId={id} />
        </div>
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <ImportExportPanel bookId={id} onImported={load} />
        </div>
        <div className="panel" style={{ padding: 16, marginBottom: 24 }}>
          <SearchPanel bookId={id} />
        </div>

        {/* Chapter list */}
        <section
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2
              className="font-display"
              style={{
                fontSize: 22,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
              }}
            >
              Список глав
            </h2>
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--color-text-faint)" }}
            >
              {chapters.length} {chapters.length === 1 ? "глава" : "глав"}
            </span>
          </div>

          <form
            onSubmit={onAddChapter}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              className="input"
              placeholder="Название главы"
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              aria-label="Название главы"
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!chapterTitle.trim()}
            >
              <Plus size={14} aria-hidden="true" />
              Новая глава
            </button>
          </form>

          {chapters.length === 0 ? (
            <div
              className="card"
              style={{
                textAlign: "center",
                padding: 24,
                color: "var(--color-text-muted)",
                fontSize: 13,
                fontStyle: "italic",
                borderStyle: "dashed",
              }}
            >
              Глав пока нет. Введите название выше — выкуем первую.
            </div>
          ) : (
            <SortableChapterList
              chapters={chapters}
              bookId={id}
              onReordered={(next) => setChapters(next)}
              onPersistError={setError}
            />
          )}
        </section>
      </div>
    </div>
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
    const oldIndex = chapters.findIndex(
      (c) => String(c.id) === String(active.id),
    );
    const newIndex = chapters.findIndex(
      (c) => String(c.id) === String(over.id),
    );
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
        changed.map((c) =>
          api.updateChapter(c.id, { orderIndex: c.orderIndex }),
        ),
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
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
          aria-label="Главы (можно перетаскивать)"
        >
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
  const tone: "amber" | "blue" | "green" | "default" =
    chapter.status === "draft"
      ? "amber"
      : chapter.status === "in_review"
        ? "blue"
        : chapter.status === "final"
          ? "green"
          : "default";
  return (
    <li ref={setNodeRef} style={style}>
      <div
        className="card hoverable"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
        }}
      >
        <button
          type="button"
          aria-label="Перетащить главу"
          className="btn btn-ghost btn-sm"
          style={{
            width: 28,
            height: 28,
            padding: 0,
            cursor: "grab",
            color: "var(--color-text-faint)",
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <Link
          to={`/books/${bookId}/chapters/${chapter.id}`}
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            textDecoration: "none",
            color: "inherit",
            outline: "none",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 11,
                color: "var(--color-text-faint)",
                flexShrink: 0,
              }}
            >
              #{chapter.orderIndex}
            </span>
            <span
              className="font-display"
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: "var(--color-text-strong)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {chapter.title}
            </span>
          </div>
          <Pill tone={tone}>{chapter.status}</Pill>
        </Link>
      </div>
    </li>
  );
}
