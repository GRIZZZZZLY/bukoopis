import { useState } from "react";
import type { AspectVariant, StageAspect } from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { GenerationProgress } from "./GenerationProgress.js";
import type { AccumulatedContext, VariantGenerator } from "./types.js";
import { currentVariant, sectionText } from "./documentSections.js";

export interface DocumentSectionProps {
  aspect: StageAspect;
  busy: boolean;
  error?: string;
  progress?: AspectGenerationProgress;
  generator: VariantGenerator<string>;
  accumulated: AccumulatedContext;
  /** Записать раздел. `true` — записано; только тогда закрываются окна.
   *  Контракт: НИКОГДА не отклоняется — отказ приходит значением `false`, а
   *  текст ошибки родитель кладёт сам через `onError`. Поэтому здесь вокруг
   *  вызова нет try/catch: он защищал бы от нарушения контракта, а не от
   *  достижимого состояния. */
  onPatchAspect: (aspectId: string, next: StageAspect) => Promise<boolean>;
  onBusy: (aspectId: string | null) => void;
  onError: (aspectId: string, message: string) => void;
  onProgress: (aspectId: string, p: AspectGenerationProgress | null) => void;
}

type OpenPanel = "none" | "edit" | "rewrite";

export function DocumentSection({
  aspect,
  busy,
  error,
  progress,
  generator,
  accumulated,
  onPatchAspect,
  onBusy,
  onError,
  onProgress,
}: DocumentSectionProps) {
  const [panel, setPanel] = useState<OpenPanel>("none");
  const [editText, setEditText] = useState("");
  const [instructions, setInstructions] = useState("");

  const text = sectionText(aspect);
  const shown = currentVariant(aspect);
  const alternatives = aspect.variants.filter(
    (v) => v.status !== "superseded" && v.status !== "rejected",
  );

  function openEdit(): void {
    setEditText(text ?? "");
    setPanel("edit");
  }

  async function handleSaveEdit(): Promise<void> {
    const payload = editText.trim();
    if (payload.length === 0) {
      onError(aspect.id, "Пустой раздел сохранить нельзя — используйте «Не нужен».");
      return;
    }
    // Родителем правки становится тот вариант, который автор ВИДЕЛ, а не тот,
    // что записан в `selectedVariantId`: у раздела, пришедшего из сборки,
    // выбора нет вовсе, и по прежнему правилу заменённый вариант оставался
    // живой альтернативой рядом с правкой, которая его и заменила.
    const parent = currentVariant(aspect);
    const variant: AspectVariant = {
      id: crypto.randomUUID(),
      label: "моя правка",
      payloadKind: "markdown",
      payload,
      status: "accepted",
      editSource: "manual",
      generatedAt: new Date().toISOString(),
      ...(parent ? { parentVariantId: parent.id } : {}),
    };
    const next: StageAspect = {
      ...aspect,
      status: "accepted",
      selectedVariantId: variant.id,
      finalPayload: payload,
      variants: [
        ...aspect.variants.map((v) =>
          v.id === parent?.id
            ? { ...v, status: "superseded" as const }
            : v.status === "accepted"
              ? { ...v, status: "rejected" as const }
              : v,
        ),
        variant,
      ],
    };
    // Окно закрывается только по факту записи: его содержимое — единственная
    // копия того, что автор набрал (В11 ревью 2026-09-19).
    if (await onPatchAspect(aspect.id, next)) {
      setPanel("none");
      setEditText("");
    }
  }

  async function runGenerator(
    refine: { variantId: string; payload: string; instructions: string } | null,
  ): Promise<void> {
    onError(aspect.id, "");
    onBusy(aspect.id);
    try {
      const variants = await generator.generate(
        {
          aspect,
          accumulated,
          ...(refine ? { refineFrom: refine } : {}),
        },
        (p) => onProgress(aspect.id, p),
      );
      // Раздел возвращается в черновик, и принятый текст с него снимается.
      // Оставить его нельзя: `sectionText` предпочитает `finalPayload`
      // вариантам, и на утверждённом разделе экран показывал бы старый текст
      // поверх только что сгенерированного (и оплаченного), а список рядом
      // называл бы показанным другой вариант.
      const { finalPayload: _dropped, ...base } = aspect;
      const next: StageAspect = refine
        ? {
            ...base,
            status: "reviewing",
            variants: [
              ...aspect.variants.map((v) =>
                v.id === refine.variantId
                  ? { ...v, status: "superseded" as const }
                  : v,
              ),
              ...variants,
            ],
            ...(aspect.selectedVariantId !== undefined
              ? { selectedVariantId: undefined }
              : {}),
          }
        : {
            ...base,
            status: "reviewing",
            variants: [...aspect.variants, ...variants],
            ...(aspect.selectedVariantId !== undefined
              ? { selectedVariantId: undefined }
              : {}),
          };
      if (await onPatchAspect(aspect.id, next)) {
        setPanel("none");
        setInstructions("");
      }
    } catch (e) {
      onError(aspect.id, e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(null);
      onProgress(aspect.id, null);
    }
  }

  async function handleRewrite(): Promise<void> {
    if (!shown || typeof shown.payload !== "string") {
      onError(aspect.id, "Переписывать нечего: раздел пуст.");
      return;
    }
    const note = instructions.trim();
    if (note.length === 0) return;
    await runGenerator({
      variantId: shown.id,
      payload: shown.payload,
      instructions: note,
    });
  }

  async function handlePick(variant: AspectVariant): Promise<void> {
    if (aspect.status === "accepted") {
      // На утверждённом разделе «Показать этот» — не смена витрины: то, что
      // видит автор, обязано совпасть с тем, что уходит в промпты
      // (`finalPayload`). Раньше кнопка меняла только `selectedVariantId`, и
      // экран показывал вариант Б, а Писатель по-прежнему получал текст А —
      // расхождение, которое `studio-invariants` не ловит, потому что оба
      // поля порознь валидны.
      if (typeof variant.payload !== "string") return;
      await onPatchAspect(aspect.id, {
        ...aspect,
        selectedVariantId: variant.id,
        finalPayload: variant.payload,
        variants: aspect.variants.map((v) =>
          v.id === variant.id
            ? { ...v, status: "accepted" as const }
            : v.status === "accepted"
              ? { ...v, status: "rejected" as const }
              : v,
        ),
      });
      return;
    }
    await onPatchAspect(aspect.id, { ...aspect, selectedVariantId: variant.id });
  }

  async function handleSkip(): Promise<void> {
    await onPatchAspect(aspect.id, { ...aspect, status: "skipped" });
  }

  async function handleRestore(): Promise<void> {
    await onPatchAspect(aspect.id, {
      ...aspect,
      status: text === null ? "pending" : "reviewing",
    });
  }

  if (aspect.status === "skipped") {
    return (
      <section data-aspect-id={aspect.id} className="flex items-baseline gap-3 py-2 opacity-60">
        <h3 className="text-[15px]" style={{ fontFamily: "var(--font-display)" }}>
          {aspect.name}
        </h3>
        <span className="text-xs text-[var(--color-muted-foreground)]">не нужен</span>
        <button
          type="button"
          onClick={handleRestore}
          disabled={busy}
          className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
        >
          Вернуть раздел
        </button>
      </section>
    );
  }

  return (
    <section data-aspect-id={aspect.id} className="flex flex-col gap-2 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          className="text-[17px] text-[var(--color-text-strong)]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          {aspect.name}
        </h3>
        <div className="flex items-center gap-2">
          {aspect.required && (
            <span className="lw-pill" data-tone="amber">обязательный</span>
          )}
          {aspect.source === "import" && (
            <span className="pill pill-brass">из ваших материалов</span>
          )}
          {aspect.status === "accepted" ? (
            <span className="lw-pill" data-tone="green">утверждён</span>
          ) : text !== null ? (
            <span className="lw-pill" data-tone="brass">черновик</span>
          ) : null}
        </div>
      </div>

      {aspect.description && (
        <p className="text-xs text-[var(--color-muted-foreground)]">{aspect.description}</p>
      )}

      {progress && <GenerationProgress progress={progress} label={`progress-${aspect.id}`} />}

      {panel === "edit" ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={12}
            aria-label={`Текст раздела «${aspect.name}»`}
            className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={busy}
              className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)]"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setPanel("none")}
              disabled={busy}
              className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : text === null ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Раздел пуст — соберите документ или напишите его сами.
        </p>
      ) : (
        <Markdown className="text-sm" text={text} />
      )}

      {alternatives.length > 1 && panel !== "edit" && (
        <ul className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
          {alternatives.map((v) => (
            <li key={v.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {v.label}
                </span>
                {v.id === shown?.id ? (
                  <span className="lw-pill" data-tone="green">показан</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePick(v)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Показать этот
                  </button>
                )}
              </div>
              {v.id !== shown?.id && typeof v.payload === "string" && (
                <Markdown className="text-xs opacity-80" text={v.payload} />
              )}
            </li>
          ))}
        </ul>
      )}

      {panel === "rewrite" && (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--color-brass)] pl-3">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            aria-label={`Что поменять в разделе «${aspect.name}»`}
            placeholder="Мрачнее. Убрать магию. Добавить порт."
            className="border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRewrite}
              disabled={busy || instructions.trim().length === 0}
              className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 disabled:opacity-50"
            >
              Применить
            </button>
            <button
              type="button"
              onClick={() => {
                setPanel("none");
                setInstructions("");
              }}
              className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {panel === "none" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPanel("rewrite")}
            disabled={busy || text === null}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Переписать
          </button>
          <button
            type="button"
            onClick={() => runGenerator(null)}
            disabled={busy}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Другие варианты
          </button>
          <button
            type="button"
            onClick={openEdit}
            disabled={busy}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Править
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            title="Раздел останется в списке — его можно вернуть"
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Не нужен
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
    </section>
  );
}
