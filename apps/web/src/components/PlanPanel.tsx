import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import {
  renderChapterClosing,
  type Chapter,
  type ChapterBeatSheetVariant,
  type ChapterPlan,
} from "@book-forge/shared";

interface Props {
  chapter: Chapter;
  onUpdated: () => void | Promise<void>;
  onPlanReady: (plan: ChapterBeatSheetVariant | null) => void;
}

function parsePlan(json: string | null): ChapterPlan | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ChapterPlan;
  } catch {
    return null;
  }
}

export function PlanPanel({ chapter, onUpdated, onPlanReady }: Props) {
  const initial = useMemo(() => parsePlan(chapter.planJson), [chapter]);
  const [plan, setPlan] = useState<ChapterPlan | null>(initial);
  const [intent, setIntent] = useState(chapter.intent ?? "");
  const [variants, setVariants] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (plan && plan.selectedIndex !== null) {
      const v = plan.variants[plan.selectedIndex];
      onPlanReady(v ?? null);
    } else {
      onPlanReady(null);
    }
  }, [plan, onPlanReady]);

  async function onGenerate() {
    setError(null);
    if (intent.trim().length === 0) {
      setError("Опиши намерение главы.");
      return;
    }
    setGenerating(true);
    try {
      const result = await api.generateChapterPlan(chapter.id, intent.trim(), {
        variants,
      });
      setPlan(result);
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function onSelect(idx: number) {
    setSelecting(idx);
    setError(null);
    try {
      await api.selectChapterPlan(chapter.id, idx);
      setPlan((p) => (p ? { ...p, selectedIndex: idx } : p));
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
      <h2 className="text-xl font-semibold">План главы (Plot Agent)</h2>

      <label className="text-sm font-medium">Намерение главы</label>
      <textarea
        className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-h-[100px]"
        placeholder="Например: главный герой обнаруживает предательство друга, конфронтация в пещере"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
      />

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
          {generating ? "Генерация…" : "Сгенерировать план"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">Ошибка: {error}</p>}

      {plan && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {plan.variants.map((v, i) => (
            <BeatSheetCard
              key={i}
              variant={v}
              isSelected={plan.selectedIndex === i}
              busy={selecting === i}
              onSelect={() => onSelect(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BeatSheetCard({
  variant,
  isSelected,
  busy,
  onSelect,
}: {
  variant: ChapterBeatSheetVariant;
  isSelected: boolean;
  busy: boolean;
  onSelect: () => void;
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
      <p className="text-sm">
        <strong>POV:</strong> {variant.pov}
      </p>
      <p className="text-sm">
        <strong>Эмоциональная цель:</strong> {variant.emotionalGoal}
      </p>
      {variant.closing && (
        <p className="text-sm">
          <strong>Финал главы:</strong> {renderChapterClosing(variant.closing)}
        </p>
      )}
      <p className="text-sm text-[var(--color-muted-foreground)]">
        ~{variant.estimatedWords} слов · {variant.beats.length} beats
      </p>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="text-xs underline w-fit"
      >
        {expanded ? "Свернуть beats" : "Показать beats"}
      </button>
      {expanded && (
        <ol className="list-decimal pl-5 text-sm flex flex-col gap-1">
          {variant.beats.map((b) => (
            <li key={b.index}>
              <strong>[{b.type}]</strong> {b.summary}
              <div className="text-xs text-[var(--color-muted-foreground)]">
                Цель: {b.goal} · Конфликт: {b.conflict} · Исход: {b.outcome}
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button
        onClick={onSelect}
        disabled={busy || isSelected}
        variant={isSelected ? "secondary" : "default"}
        className="self-start"
      >
        {isSelected ? "Выбран" : busy ? "…" : "Выбрать"}
      </Button>
    </div>
  );
}
