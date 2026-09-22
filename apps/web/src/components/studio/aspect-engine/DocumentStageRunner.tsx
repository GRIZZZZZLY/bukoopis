import { useEffect, useRef, useState } from "react";
import type { ContextRef, StageAspect, StageState } from "@book-forge/shared";
import {
  streamStageDocument,
  type AspectGenerationProgress,
  type StageDocumentSection,
} from "@/api/client";
import { GenerationProgress } from "./GenerationProgress.js";
import { ManualAspectForm } from "./ManualAspectForm.js";
import { DocumentSection } from "./DocumentSection.js";
import { createLLMMarkdownVariantGenerator } from "./llmGenerators.js";
import {
  approveAllSections,
  mergeDocumentSections,
  sectionText,
} from "./documentSections.js";
import type { AccumulatedContext } from "./types.js";

export interface DocumentStageRunnerProps {
  bookId: number;
  stageId: "world" | "lore";
  /** «Мир» / «Лор» — подписи кнопок собираются из него. */
  stageLabel: string;
  stage: StageState;
  revision: number;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
  onReloadStage: () => Promise<{ stage: StageState; revision: number }>;
}

/** Винительный падеж для кнопок: «Собрать мир», «Утвердить лор». */
const ACCUSATIVE: Record<"world" | "lore", string> = {
  world: "мир",
  lore: "лор",
};

const CONFLICT_MESSAGE =
  "Этот раздел изменили в другом месте, пока вы правили. Ваш текст остался" +
  " на экране: скопируйте его, обновите страницу и вставьте заново — иначе" +
  " пропадёт чужая правка.";

export function DocumentStageRunner({
  bookId,
  stageId,
  stageLabel,
  stage,
  revision,
  onPatch,
  onReloadStage,
}: DocumentStageRunnerProps) {
  const [assembling, setAssembling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>({});
  const [stageError, setStageError] = useState<string | null>(null);
  /** Нормальный исход, о котором надо сказать: не ошибка и не красный. */
  const [stageNote, setStageNote] = useState<string | null>(null);
  const [progressByAspect, setProgressByAspect] = useState<
    Record<string, AspectGenerationProgress>
  >({});
  const [assembleProgress, setAssembleProgress] =
    useState<AspectGenerationProgress | null>(null);

  const [notes, setNotes] = useState(stage.authorNotes ?? "");
  const lastNotesProp = useRef(stage.authorNotes ?? "");

  // Состояние Мастерской догружается и перечитывается после каждой записи.
  // Безусловный резинк стирал бы то, что автор набирает прямо сейчас, — та же
  // защита, что стоит на замысле в ConceptStage и на заметках главы.
  useEffect(() => {
    const incoming = stage.authorNotes ?? "";
    if (incoming === lastNotesProp.current) return;
    const untouched = notes === lastNotesProp.current;
    lastNotesProp.current = incoming;
    if (untouched) setNotes(incoming);
  }, [stage.authorNotes, notes]);

  const generator = createLLMMarkdownVariantGenerator({ bookId, stageId });

  const accumulated: AccumulatedContext = {
    acceptedAspects: stage.aspects
      .filter((a) => a.status === "accepted" && a.finalPayload !== undefined)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ id: a.id, name: a.name, finalPayload: a.finalPayload })),
  };

  function setAspectError(aspectId: string, message: string): void {
    setErrorByAspect((p) => ({ ...p, [aspectId]: message }));
  }

  function setAspectProgress(
    aspectId: string,
    p: AspectGenerationProgress | null,
  ): void {
    setProgressByAspect((prev) => {
      if (p === null) {
        if (!(aspectId in prev)) return prev;
        const copy = { ...prev };
        delete copy[aspectId];
        return copy;
      }
      return { ...prev, [aspectId]: p };
    });
  }

  /** Патч одного раздела. На 409 состояние перечитывается, и меняется ТОЛЬКО
   *  свой раздел: конфликт вызывает и правка соседнего (её бережём), и правка
   *  этого же из второй вкладки (тогда писать поверх нельзя). */
  async function patchAspect(
    aspectId: string,
    nextAspect: StageAspect,
  ): Promise<boolean> {
    setAspectError(aspectId, "");
    setBusyAspectId(aspectId);
    try {
      await onPatch(revision, withAspect(stage, aspectId, nextAspect));
      return true;
    } catch (e) {
      if ((e as { status?: number } | null)?.status === 409) {
        try {
          const fresh = await onReloadStage();
          const before = stage.aspects.find((a) => a.id === aspectId);
          const theirs = fresh.stage.aspects.find((a) => a.id === aspectId);
          const sameBase =
            before !== undefined &&
            theirs !== undefined &&
            JSON.stringify(before) === JSON.stringify(theirs);
          if (sameBase) {
            await onPatch(
              fresh.revision,
              withAspect(fresh.stage, aspectId, nextAspect),
            );
            return true;
          }
          setAspectError(aspectId, CONFLICT_MESSAGE);
          return false;
        } catch (retryError) {
          setAspectError(
            aspectId,
            retryError instanceof Error ? retryError.message : String(retryError),
          );
          return false;
        }
      }
      setAspectError(aspectId, e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusyAspectId(null);
    }
  }

  /** Запись всего этапа (сборка, утверждение). На 409 состояние перечитывается
   *  и изменение строится ЗАНОВО от свежего этапа: обе операции — чистые
   *  функции состояния, и слияние по построению не трогает разделы с текстом,
   *  поэтому чужая работа, легшая за время сборки, сохраняется. Без этого
   *  конфликт выбрасывал оплаченный документ, а экран оставался на старой
   *  ревизии и получал 409 на каждое следующее нажатие до перезагрузки. */
  async function patchWholeStage(
    build: (s: StageState) => StageState | null,
  ): Promise<void> {
    const first = build(stage);
    if (first === null) return;
    try {
      await onPatch(revision, first);
    } catch (e) {
      if ((e as { status?: number } | null)?.status !== 409) throw e;
      const fresh = await onReloadStage();
      const again = build(fresh.stage);
      if (again === null) return;
      await onPatch(fresh.revision, again);
    }
  }

  async function handleAssemble(): Promise<void> {
    setStageError(null);
    setStageNote(null);
    setAssembling(true);
    const trimmedNotes = notes.trim();
    const live = stage.aspects.filter((a) => a.status !== "skipped");
    const existingSections: Array<{ name: string; text: string }> = [];
    const emptySectionNames: string[] = [];
    for (const a of live) {
      const text = sectionText(a);
      if (text === null) emptySectionNames.push(a.name);
      else existingSections.push({ name: a.name, text });
    }
    try {
      const done = await new Promise<{
        sections: StageDocumentSection[];
        contextRef: ContextRef;
        modelId: string;
      }>((resolve, reject) => {
        streamStageDocument(
          bookId,
          stageId,
          {
            existingSections,
            emptySectionNames,
            ...(trimmedNotes.length > 0 ? { authorNotes: trimmedNotes } : {}),
          },
          {
            onProgress: setAssembleProgress,
            onDone: resolve,
            onError: (message) => reject(new Error(message)),
          },
        ).catch(reject);
      });
      const meta = { contextRef: done.contextRef, modelId: done.modelId };
      let nothingNew = false;
      await patchWholeStage((s) => {
        const merged = mergeDocumentSections(s, done.sections, meta);
        nothingNew = merged === s;
        return withNotes(merged, trimmedNotes);
      });
      if (nothingNew) {
        // Слияние вернуло тот же объект: всё, что прислала модель, уже есть
        // или помечено «Не нужен». Записывать нечего, но молчать нельзя —
        // иначе нажатие выглядит как потерянное. И это не ошибка: красная
        // строка на нормальном исходе учит автора не читать красные строки.
        setStageNote(
          "Новых разделов не добавилось: всё, что предложила модель, уже есть в документе.",
        );
      }
    } catch (e) {
      setStageError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssembling(false);
      setAssembleProgress(null);
    }
  }

  async function handleApprove(): Promise<void> {
    if (approveAllSections(stage) === null) return;
    setStageError(null);
    setApproving(true);
    try {
      const trimmedNotes = notes.trim();
      await patchWholeStage((s) => {
        const approved = approveAllSections(s);
        return approved === null ? null : withNotes(approved, trimmedNotes);
      });
    } catch (e) {
      setStageError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  const accusative = ACCUSATIVE[stageId];
  const busy = assembling || approving || busyAspectId !== null;
  const hasSomethingToApprove = approveAllSections(stage) !== null;
  const emptyCount = stage.aspects.filter(
    (a) => a.status !== "skipped" && sectionText(a) === null,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="stage-author-notes" className="text-sm">
          Ваши заметки к этапу
        </label>
        <textarea
          id="stage-author-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={4000}
          aria-label={`Ваши заметки к этапу «${stageLabel}»`}
          placeholder="Что здесь обязательно должно быть. Модель это не отменит."
          className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAssemble}
            disabled={busy}
            className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {assembling
              ? "Собираем…"
              : stage.aspects.length === 0
                ? `Собрать ${accusative}`
                : emptyCount > 0
                  ? `Дописать недостающее (${emptyCount})`
                  : "Дополнить документ"}
          </button>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Разделы, где уже есть текст, остаются как есть.
          </span>
        </div>
        {assembleProgress && (
          <GenerationProgress progress={assembleProgress} label="progress-document" />
        )}
        {stageError && (
          <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
            {stageError}
          </p>
        )}
        {stageNote && (
          <p role="status" className="text-xs text-[var(--color-muted-foreground)]">
            {stageNote}
          </p>
        )}
      </div>

      {stage.aspects.length > 0 && (
        <div className="flex flex-col divide-y divide-[var(--color-border-soft)]">
          {[...stage.aspects]
            .sort((a, b) => a.order - b.order)
            .map((aspect) => (
              <DocumentSection
                key={aspect.id}
                aspect={aspect}
                busy={busy}
                {...(errorByAspect[aspect.id]
                  ? { error: errorByAspect[aspect.id] }
                  : {})}
                {...(progressByAspect[aspect.id]
                  ? { progress: progressByAspect[aspect.id] }
                  : {})}
                generator={generator}
                accumulated={accumulated}
                onPatchAspect={patchAspect}
                onBusy={setBusyAspectId}
                onError={setAspectError}
                onProgress={setAspectProgress}
              />
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy || !hasSomethingToApprove}
          className="text-sm border border-[var(--color-brass)] bg-[var(--color-brass)] text-[var(--color-bg)] rounded-md px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Утвердить {accusative}
        </button>
        {emptyCount > 0 && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Пустых разделов: {emptyCount}. Их можно оставить или пометить «Не нужен».
          </span>
        )}
      </div>

      <ManualAspectForm
        stage={stage}
        revision={revision}
        payloadKind="markdown"
        onPatch={onPatch}
      />
    </div>
  );
}

function withAspect(
  stage: StageState,
  aspectId: string,
  next: StageAspect,
): StageState {
  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: stage.aspects.map((a) => (a.id === aspectId ? next : a)),
    updatedAt: new Date().toISOString(),
  };
}

function withNotes(stage: StageState, notes: string): StageState {
  if (notes.length === 0) {
    const { authorNotes: _dropped, ...rest } = stage;
    return rest;
  }
  return { ...stage, authorNotes: notes };
}
