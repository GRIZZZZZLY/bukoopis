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
import { ImportExportPanel } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { StageStepper } from "@/components/studio/StageStepper";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import { isPlanApproved } from "@book-forge/shared";
import type {
  Book,
  BookConcept,
  Chapter,
  StudioState,
} from "@book-forge/shared";

/** Русские подписи статусов главы: в UI утекали внутренние коды (draft,
 *  in_review, final) — латиница в русском интерфейсе. */
const CHAPTER_STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  in_review: "на разборе",
  final: "готова",
};

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
        <div className="page">
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
        <div className="page">
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
      <div className="page page-stage">
        <StageStepper
          bookId={id}
          concept={concept}
          studioState={studio}
          activeStageId="chapters"
          chapters={{
            total: chapters.length,
            finalized: chapters.filter((c) => c.status === "final").length,
          }}
          planApproved={isPlanApproved(book.outlineJson)}
        />

        <div className="page-head">
          <div>
            <h1>Главы</h1>
            <p className="muted page-sub">
              {countLabel}
              {chapters.length > 0 && (
                <>
                  {" · "}
                  <span className="mono strong">{book.title}</span>
                </>
              )}
            </p>
          </div>
          <Link to={`/books/${id}/studio`} className="btn btn-ghost btn-sm">
            ← К Studio
          </Link>
        </div>

        {/* Plan */}
        <div className="card">
          <div className="panel-head">
            <h3>План книги</h3>
            <Link to={`/books/${id}/studio/plot`} className="btn btn-ghost btn-sm">
              Открыть план →
            </Link>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Поглавный костяк и создание глав переехали на отдельный экран.
          </p>
        </div>

        {/* Canon + Import/Export */}
        <div className="panel-row">
          <div className="card">
            <KnowledgePanel bookId={id} />
          </div>
          <div className="card">
            <ImportExportPanel bookId={id} onImported={load} />
          </div>
        </div>

        {/* Search */}
        <div className="card">
          <SearchPanel bookId={id} />
        </div>

        {/* Chapter list */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 12 }}>
            <h3>Список глав</h3>
            <span className="cap mono faint">
              {chapters.length} {chapters.length === 1 ? "глава" : "глав"}
            </span>
          </div>

          <form
            onSubmit={onAddChapter}
            style={{ display: "flex", gap: 8, marginBottom: 12 }}
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
              className="card muted"
              style={{
                textAlign: "center",
                padding: 24,
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
        </div>
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
          {chapters.map((c, i) => (
            <SortableChapterItem
              key={c.id}
              chapter={c}
              bookId={bookId}
              number={i + 1}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableChapterItem({
  chapter,
  bookId,
  number,
}: {
  chapter: Chapter;
  bookId: number;
  /** Порядковый номер в списке. orderIndex — внутренний шаг сортировки
   *  (10, 20, 30…), в UI он читался как «глава №10». */
  number: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(chapter.id) });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const statusLabel = CHAPTER_STATUS_LABEL[chapter.status] ?? chapter.status;
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 14px",
          borderRadius: 8,
          borderTop: "1px solid var(--color-border-soft)",
        }}
      >
        <button
          type="button"
          aria-label="Перетащить главу"
          className="chrack-grip"
          style={{ background: "transparent", border: 0, cursor: "grab" }}
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
            gap: 14,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              minWidth: 0,
            }}
          >
            <span className="chrack-num mono" style={{ flexShrink: 0 }}>
              {String(number).padStart(2, "0")}
            </span>
            <span
              className="chrack-title"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {chapter.title}
            </span>
          </div>
          <Pill tone={tone}>{statusLabel}</Pill>
        </Link>
      </div>
    </li>
  );
}
