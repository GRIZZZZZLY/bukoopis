import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
import type { Chapter } from "@book-forge/shared";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import { formatWhen, plural } from "@/lib/format";
import { useBookRoom } from "@/components/book/BookLayout";
import {
  ChapterStateDot,
  chapterState,
  chapterStateLabel,
  type ChapterState,
} from "@/components/book/StageStatus";
import { ExportLinks } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { PageSkeleton } from "@/components/ui/Skeleton";

const SUMMARY_ORDER: ChapterState[] = ["final", "in_review", "draft", "none"];

export function BookChaptersPage() {
  const { bookId, reloadBook, openMaterials } = useBookRoom();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  async function load() {
    try {
      setChapters(await api.listChapters(bookId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      await api.createChapter(bookId, { title: title.trim() });
      setTitle("");
      setAdding(false);
      await load();
      reloadBook();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (chapters === null && !error) return <PageSkeleton label="Главы загружаются" />;

  const list = chapters ?? [];
  const counts = new Map<ChapterState, number>();
  for (const c of list) {
    const s = chapterState(c);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const summary = SUMMARY_ORDER.filter((s) => counts.get(s))
    .map((s) => `${counts.get(s)} ${chapterStateLabel(s)}`)
    .join(" · ");

  return (
    <div className="route chapters-sec">
      <div className="section-bar">
        <div className="section-bar-title">
          <h2>Главы</h2>
          <span className="muted">
            {list.length === 0
              ? "пока ни одной"
              : `${list.length} ${plural(list.length, "глава", "главы", "глав")} · ${summary}`}
          </span>
        </div>
        <div className="section-bar-actions">
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            Поиск по тексту
          </button>
          {list.length > 0 && <ExportLinks bookId={bookId} />}
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Новая глава
          </button>
        </div>
      </div>

      {error && <p role="alert" className="alert-error">Ошибка: {error}</p>}

      {searchOpen && (
        <div className="card">
          <SearchPanel bookId={bookId} />
        </div>
      )}

      {adding && (
        <form onSubmit={(e) => void onAdd(e)} className="new-chapter">
          <input
            className="input"
            placeholder="Название главы"
            aria-label="Название главы"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
            Создать
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setAdding(false);
              setTitle("");
            }}
          >
            Отмена
          </button>
        </form>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <h3>Глав пока нет</h3>
          <p className="muted">
            Создайте первую главу, добавьте готовый текст или утвердите план в Мастерской — главы
            появятся из него.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Новая глава
            </button>
            <button type="button" className="btn btn-secondary" onClick={openMaterials}>
              Добавить материалы
            </button>
          </div>
        </div>
      ) : (
        <SortableChapterTable
          chapters={list}
          bookId={bookId}
          onReordered={setChapters}
          onPersistError={setError}
        />
      )}
    </div>
  );
}

interface TableProps {
  chapters: Chapter[];
  bookId: number;
  onReordered: (next: Chapter[]) => void;
  onPersistError: (msg: string) => void;
}

function SortableChapterTable({ chapters, bookId, onReordered, onPersistError }: TableProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chapters.findIndex((c) => String(c.id) === String(active.id));
    const newIndex = chapters.findIndex((c) => String(c.id) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(chapters, oldIndex, newIndex);
    onReordered(reordered);
    try {
      // Один запрос на всю книгу: сервер переносит вместе с порядком и
      // производную память (К1).
      const res = await api.reorderChapters(
        bookId,
        reordered.map((c) => c.id),
      );
      onReordered(res.chapters);
      toast.success(
        res.staleFrom === null
          ? "Порядок глав обновлён"
          : "Порядок глав обновлён. Память книги придётся перестроить: порядок событий изменился.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onPersistError(msg);
      toast.error("Не удалось переупорядочить", { description: msg });
      onReordered(chapters);
    }
  }

  return (
    <div className="ctable" role="table" aria-label="Главы (можно перетаскивать)">
      <div className="ctable-head" role="row">
        <span role="columnheader" />
        <span role="columnheader">№</span>
        <span role="columnheader">Название</span>
        <span role="columnheader">Статус</span>
        <span role="columnheader" className="ctable-right">
          Последняя правка
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <SortableContext items={chapters.map((c) => String(c.id))} strategy={verticalListSortingStrategy}>
          {chapters.map((c, i) => (
            <ChapterRow key={c.id} chapter={c} bookId={bookId} number={i + 1} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function ChapterRow({ chapter, bookId, number }: { chapter: Chapter; bookId: number; number: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(chapter.id),
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const state = chapterState(chapter);
  return (
    <div ref={setNodeRef} style={style} className="ctable-row" role="row">
      <button type="button" aria-label="Перетащить главу" className="ctable-grip" {...attributes} {...listeners}>
        <GripVertical size={14} aria-hidden="true" />
      </button>
      {/* Номер — позиция в книге, а не разрежённый order_index. */}
      <span className="mono faint" role="cell">
        {String(number).padStart(2, "0")}
      </span>
      <span role="cell" className="ctable-title-cell">
        <Link to={`/books/${bookId}/chapters/${chapter.id}`} className="ctable-title">
          {chapter.title}
        </Link>
      </span>
      <span className={`ctable-state ctable-state-${state}`} role="cell">
        <ChapterStateDot state={state} />
        {chapterStateLabel(state)}
      </span>
      <span className="mono faint ctable-right" role="cell">
        {formatWhen(chapter.updatedAt)}
      </span>
    </div>
  );
}
