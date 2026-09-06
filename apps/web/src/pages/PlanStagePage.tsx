import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { StageStepper } from "@/components/studio/StageStepper";
import { toast } from "@/lib/toast";
import { isPlanApproved } from "@book-forge/shared";
import type {
  Book,
  BookConcept,
  BookOutline,
  BookOutlineVariant,
  StudioState,
} from "@book-forge/shared";

function parseOutline(json: string | null): BookOutline | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BookOutline;
  } catch {
    return null;
  }
}

/** Заметки, приземлённые приёмом материала на этап сюжета до появления этого
 *  экрана. Аспектами они и остаются — просто показываются здесь, а не на
 *  markdown-странице, которой у этапа больше нет. */
function planNotes(studio: StudioState | null): Array<{ id: string; name: string; text: string }> {
  const stage = studio?.stages["plot"];
  if (!stage) return [];
  return stage.aspects.flatMap((a) => {
    const variant = a.variants[0];
    const text = typeof variant?.payload === "string" ? variant.payload : "";
    if (text.length === 0) return [];
    return [{ id: a.id, name: a.name, text }];
  });
}

export function PlanStagePage() {
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const bookId = Number(rawBookId);

  const [book, setBook] = useState<Book | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState<{ created: number; updated: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, c, s] = await Promise.all([
        api.getBook(bookId),
        api.getConcept(bookId),
        api.getStudioState(bookId),
      ]);
      setBook(b);
      setConcept(c);
      setStudio(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bookId]);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    void load();
  }, [bookId, load]);

  const outline = parseOutline(book?.outlineJson ?? null);
  const selected =
    outline && outline.selectedIndex !== null
      ? outline.variants[outline.selectedIndex]
      : undefined;
  const rows = selected?.chapters ?? [];
  const canApprove = rows.length > 0 && !approving;

  async function onGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateBookOutline(bookId, { variants: 2 });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes("premise required")
          ? "Сначала утвердите замысел книги в Мастерской."
          : message,
      );
    } finally {
      setGenerating(false);
    }
  }

  async function onSelect(idx: number) {
    setSelecting(idx);
    setError(null);
    try {
      await api.selectBookOutline(bookId, idx);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  }

  async function onApprove() {
    setApproving(true);
    setError(null);
    try {
      const result = await api.approvePlan(bookId);
      setApproved({ created: result.created, updated: result.updated });
      toast.success("План утверждён");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  if (error && !book) {
    return (
      <div className="route">
        <div className="page">
          <p role="alert" className="card" style={{ borderLeft: "3px solid var(--color-ink-red)" }}>
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  }
  if (!book || !concept || !studio) {
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );
  }

  const notes = planNotes(studio);

  return (
    <div className="route" data-screen-label="stage-plot">
      <div className="page page-stage">
        <StageStepper
          bookId={bookId}
          concept={concept}
          studioState={studio}
          activeStageId="plot"
          planApproved={isPlanApproved(book.outlineJson)}
        />

        <div className="page-head">
          <div>
            <h1>План</h1>
            <p className="muted page-sub">
              Поглавный костяк книги. «Утвердить план» создаёт главы с намерениями.
            </p>
          </div>
          <Link to={`/books/${bookId}/studio`} className="btn btn-ghost btn-sm">
            ← К Studio
          </Link>
        </div>

        {error && <p className="text-sm" style={{ color: "var(--color-ink-red)" }}>Ошибка: {error}</p>}

        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div className="panel-head">
            <h3>Варианты плана</h3>
            <Button onClick={() => void onGenerate()} disabled={generating}>
              {generating ? "Генерация…" : "Сгенерировать варианты"}
            </Button>
          </div>

          {!outline && (
            <p className="muted" style={{ fontSize: 13 }}>
              Плана ещё нет. Сгенерируйте варианты или перетащите своё оглавление в
              Мастерской — оно станет вариантом плана.
            </p>
          )}

          {outline?.variants.map((v, i) => (
            <VariantCard
              key={i}
              variant={v}
              isSelected={outline.selectedIndex === i}
              busy={selecting === i}
              onSelect={() => void onSelect(i)}
            />
          ))}
        </div>

        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div className="panel-head">
            <h3>Главы по плану</h3>
            <Button onClick={() => void onApprove()} disabled={!canApprove}>
              {approving ? "Утверждаю…" : "Утвердить план"}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              У выбранного варианта нет поглавных строк — утверждать нечего. Такой
              вариант описывает книгу целиком; поглавный список приходит из ваших
              материалов или дописывается руками.
            </p>
          ) : (
            <ol style={{ display: "grid", gap: 6, paddingLeft: 20 }}>
              {rows.map((ch, i) => (
                <li key={i}>
                  <strong>{ch.title}</strong>
                  {(ch.pov || ch.goal || ch.conflict || ch.stakes || ch.hook) && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {[
                        ch.pov && `POV: ${ch.pov}`,
                        ch.goal && `Цель: ${ch.goal}`,
                        ch.conflict && `Конфликт: ${ch.conflict}`,
                        ch.stakes && `Ставки: ${ch.stakes}`,
                        ch.hook && `Крючок: ${ch.hook}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {approved && (
            <p className="text-sm">
              Создано глав: {approved.created}. Обновлено намерений: {approved.updated}.
            </p>
          )}
        </div>

        {notes.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div className="panel-head">
              <h3>Заметки из ваших материалов</h3>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Текст о сюжете, в котором не было поглавного списка. Он не стал планом,
              но и не потерялся.
            </p>
            {notes.map((n) => (
              <details key={n.id}>
                <summary>{n.name}</summary>
                <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{n.text}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  isSelected,
  busy,
  onSelect,
}: {
  variant: BookOutlineVariant;
  isSelected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        borderColor: isSelected ? "var(--color-ring)" : undefined,
        display: "grid",
        gap: 6,
      }}
    >
      <div className="panel-head">
        <h4>{variant.label}</h4>
        {variant.source === "author_material" && (
          <span className="cap mono faint">из ваших материалов</span>
        )}
      </div>
      {variant.logline && (
        <p className="text-sm">
          <strong>Логлайн:</strong> {variant.logline}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Глав: {variant.estimatedChapters}
        {variant.chapters ? ` · поглавных строк: ${variant.chapters.length}` : " · поглавных строк нет"}
      </p>
      <Button
        onClick={onSelect}
        disabled={busy || isSelected}
        variant={isSelected ? "secondary" : "default"}
        className="self-start"
      >
        {isSelected ? "Выбран" : busy ? "…" : "Выбрать этот вариант"}
      </Button>
    </div>
  );
}
