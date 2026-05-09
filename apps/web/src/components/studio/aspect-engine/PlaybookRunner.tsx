import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { PlaybookGenerator } from "./llmGenerators";

interface ProposedAspect {
  name: string;
  description: string;
  required: boolean;
  payloadKind: "markdown";
}

interface ReviewItem extends ProposedAspect {
  include: boolean;
}

interface Props {
  stage: StageState;
  revision: number;
  generator: PlaybookGenerator;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

export function PlaybookRunner({
  stage,
  revision,
  generator,
  onPatch,
}: Props) {
  const [proposed, setProposed] = useState<ReviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const r = await generator.generate({
        existingAspectNames: stage.aspects.map((a) => a.name),
      });
      setProposed(r.aspects.map((a) => ({ ...a, include: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptAll(): Promise<void> {
    if (!proposed) return;
    setError(null);
    setBusy(true);
    try {
      const accepted = proposed.filter((p) => p.include);
      const baseOrder = stage.aspects.length;
      const newAspects: StageAspect[] = accepted.map((p, i) => ({
        id: crypto.randomUUID(),
        name: p.name,
        description: p.description,
        status: "pending",
        order: baseOrder + i,
        required: p.required,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
      }));
      const next: StageState = {
        ...stage,
        status: stage.status === "not_started" ? "in_progress" : stage.status,
        playbookGenerated: true,
        aspects: [...stage.aspects, ...newAspects],
        updatedAt: new Date().toISOString(),
      };
      await onPatch(revision, next);
      setProposed(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleInclude(index: number): void {
    setProposed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const item = copy[index];
      if (!item) return prev;
      copy[index] = { ...item, include: !item.include };
      return copy;
    });
  }

  function toggleRequired(index: number): void {
    setProposed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const item = copy[index];
      if (!item) return prev;
      copy[index] = { ...item, required: !item.required };
      return copy;
    });
  }

  if (proposed === null) {
    return (
      <div className="flex flex-col gap-2 border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          В стадии пока нет аспектов. Запустите генерацию плейбука: LLM
          предложит 5–9 ключевых полей, которые потом раскроем по одному.
        </p>
        <div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className={
              "text-sm border rounded-md px-3 py-1 " +
              (busy
                ? "bg-[var(--color-muted)] cursor-not-allowed"
                : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white")
            }
          >
            {busy ? "Генерируем…" : "Сгенерировать список аспектов"}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-[var(--color-border)] rounded-lg p-4">
      <p className="text-sm font-medium">Предложенные аспекты</p>
      <ul className="flex flex-col gap-2">
        {proposed.map((p, i) => (
          <li
            key={`${p.name}-${i}`}
            className="flex items-start gap-3 rounded p-2 hover:bg-[var(--color-muted)]"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={p.include}
                onChange={() => toggleInclude(i)}
                aria-label={`Включить ${p.name}`}
              />
            </label>
            <div className="flex flex-col gap-1 flex-1">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {p.description}
              </span>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={() => toggleRequired(i)}
                  aria-label={`Обязательный ${p.name}`}
                />
                обязательный
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAcceptAll}
          disabled={busy || proposed.every((p) => !p.include)}
          className={
            "text-sm border rounded-md px-3 py-1 " +
            (busy || proposed.every((p) => !p.include)
              ? "bg-[var(--color-muted)] cursor-not-allowed"
              : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white")
          }
        >
          {busy ? "Сохраняем…" : "Принять список"}
        </button>
        <button
          type="button"
          onClick={() => setProposed(null)}
          disabled={busy}
          className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
        >
          Отменить
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
        >
          Перегенерировать
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
