import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";
import type { PlaybookGenerator } from "./llmGenerators";
import { GenerationProgress } from "./GenerationProgress.js";

interface ProposedAspect {
  name: string;
  description: string;
  required: boolean;
  payloadKind: "markdown" | "entity_set";
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
  const [progress, setProgress] = useState<AspectGenerationProgress | null>(
    null,
  );

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const r = await generator.generate(
        { existingAspectNames: stage.aspects.map((a) => a.name) },
        setProgress,
      );
      setProposed(r.aspects.map((a) => ({ ...a, include: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
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
        // Сервер решает вид payload по стадии (characters/items → entity_set);
        // хардкод "markdown" ломал инвариант variant_payload_kind_mismatch.
        payloadKind: p.payloadKind,
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
      <div className="lw-card flex flex-col gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          В стадии пока нет аспектов. Запустите генерацию плейбука: LLM
          предложит 5–9 ключевых полей, которые потом раскроем по одному.
        </p>
        {progress && (
          <GenerationProgress progress={progress} label="progress-playbook" />
        )}
        <div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="lw-btn"
            data-variant="primary"
            data-size="sm"
          >
            {busy ? "Генерируем…" : "Сгенерировать список аспектов"}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="text-xs rounded-md px-2 py-1 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="lw-card flex flex-col gap-3">
      <p
        className="text-base"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
      >
        Предложенные аспекты
      </p>
      <ul className="flex flex-col gap-2">
        {proposed.map((p, i) => (
          <li
            key={`${p.name}-${i}`}
            className="flex items-start gap-3 rounded p-2 hover:bg-[var(--color-surface-2)] transition-colors"
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
      {progress && (
        <GenerationProgress progress={progress} label="progress-playbook" />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAcceptAll}
          disabled={busy || proposed.every((p) => !p.include)}
          className="lw-btn"
          data-variant="primary"
          data-size="sm"
        >
          {busy ? "Сохраняем…" : "Принять список"}
        </button>
        <button
          type="button"
          onClick={() => setProposed(null)}
          disabled={busy}
          className="lw-btn"
          data-variant="ghost"
          data-size="sm"
        >
          Отменить
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="lw-btn"
          data-variant="ghost"
          data-size="sm"
        >
          Перегенерировать
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="text-xs rounded-md px-2 py-1 text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40"
        >
          {error}
        </p>
      )}
    </div>
  );
}
