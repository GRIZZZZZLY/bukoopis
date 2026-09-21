import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import {
  narrativeArchitectureLines,
  type Book,
  type BookOutline,
  type BookOutlineVariant,
} from "@book-forge/shared";

interface Props {
  book: Book;
  onUpdated: () => void | Promise<void>;
}

function parseOutline(json: string | null): BookOutline | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BookOutline;
  } catch {
    return null;
  }
}

export function OutlinePanel({ book, onUpdated }: Props) {
  const initial = useMemo(() => parseOutline(book.outlineJson), [book]);
  const [outline, setOutline] = useState<BookOutline | null>(initial);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState(2);

  async function onGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const result = await api.generateBookOutline(book.id, { variants });
      setOutline(result);
      await onUpdated();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The server derives the premise from the concept logline, so this can
      // only mean the concept is still empty.
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
      await api.selectBookOutline(book.id, idx);
      setOutline((o) => (o ? { ...o, selectedIndex: idx } : o));
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">План книги</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm">
            Вариантов:&nbsp;
            <input
              type="number"
              min={1}
              max={5}
              value={variants}
              onChange={(e) =>
                setVariants(Math.max(1, Math.min(5, Number(e.target.value))))
              }
              className="w-14 border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
            />
          </label>
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? "Генерация…" : "Сгенерировать варианты"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Ошибка: {error}</p>}

      {!outline && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Outline ещё не сгенерирован. Опиши премису выше и нажми «Сгенерировать
          варианты».
        </p>
      )}

      {outline && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {outline.variants.map((v, i) => (
            <VariantCard
              key={i}
              variant={v}
              isSelected={outline.selectedIndex === i}
              onSelect={() => onSelect(i)}
              busy={selecting === i}
            />
          ))}
        </div>
      )}

      {outline && outline.selectedIndex !== null && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Выбран вариант #{outline.selectedIndex + 1}. При генерации плана главы
          этот outline будет передан в Plot Agent.
        </p>
      )}
    </section>
  );
}

function VariantCard({
  variant,
  isSelected,
  onSelect,
  busy,
}: {
  variant: BookOutlineVariant;
  isSelected: boolean;
  onSelect: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={
        "rounded-md border p-3 flex flex-col gap-2 " +
        (isSelected
          ? "border-[var(--color-ring)] bg-[var(--color-accent)]"
          : "border-[var(--color-border)]")
      }
    >
      <div className="flex justify-between items-center">
        <h3 className="font-medium">{variant.label}</h3>
        {isSelected && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            (выбран)
          </span>
        )}
      </div>
      {variant.logline && (
        <p className="text-sm">
          <strong>Logline:</strong> {variant.logline}
        </p>
      )}
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {variant.setting && (
          <>
            <strong>Сеттинг:</strong> {variant.setting} ·{" "}
          </>
        )}
        <strong>Глав:</strong> {variant.estimatedChapters}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="text-xs underline w-fit"
      >
        {expanded ? "Свернуть" : "Подробнее"}
      </button>
      {expanded && (
        <div className="text-sm flex flex-col gap-2">
          <p>
            <strong>Synopsis:</strong>
            <br />
            {variant.synopsis}
          </p>
          {/* Вариант из авторского оглавления повествовательных полей не
              имеет вовсе — рисуем только то, что в нём есть. */}
          {variant.themes && variant.themes.length > 0 && (
            <p>
              <strong>Темы:</strong> {variant.themes.join(", ")}
            </p>
          )}
          {variant.protagonist && (
            <p>
              <strong>Протагонист:</strong> {variant.protagonist}
            </p>
          )}
          {variant.antagonist && (
            <p>
              <strong>Антагонист:</strong> {variant.antagonist}
            </p>
          )}
          {variant.arcs && variant.arcs.length > 0 && (
            <div>
              <strong>Арки:</strong>
              <ul className="list-disc pl-5">
                {variant.arcs.map((a, i) => (
                  <li key={i}>
                    <strong>{a.title}.</strong> {a.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {variant.architecture && (
            <div className="flex flex-col gap-0.5">
              <strong>Архитектура:</strong>
              {narrativeArchitectureLines(variant.architecture).map(({ label, value }) => (
                <p key={label} className="text-xs">
                  <strong>{label}:</strong> {value}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
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
