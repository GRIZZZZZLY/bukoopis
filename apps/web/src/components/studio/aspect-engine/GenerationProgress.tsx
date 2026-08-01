import type { AspectGenerationProgress } from "@/api/client";

/** Подписи фаз генерации. Фазы приходят с сервера как реальные вехи вызова
 *  (см. server utils/generation-progress.ts). */
const PHASE_LABEL: Record<AspectGenerationProgress["phase"], string> = {
  context: "Собираем контекст",
  dispatch: "Отправляем запрос модели",
  model: "Модель приняла запрос",
  writing: "Модель пишет ответ",
  submitting: "Забираем структурированный ответ",
  validating: "Проверяем схему",
  done: "Готово",
};

/** Полоса прогресса LLM-вызова: фаза и номер попытки реальные, проценты
 *  внутри ожидания — оценка по времени (у structured-режима нет токен-дельт).
 *  Одна на все аспектные раннеры. */
export function GenerationProgress({
  progress,
  label,
}: {
  progress: AspectGenerationProgress;
  /** Что именно генерируется — попадает в aria-label. */
  label: string;
}) {
  const retry = progress.attempt > 1;
  return (
    <div className="flex flex-col gap-1" role="status" aria-label={label}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-[var(--color-text-strong)]">
          {PHASE_LABEL[progress.phase]}
          {retry ? ` · попытка ${progress.attempt}/${progress.maxAttempts}` : ""}
        </span>
        <span
          className="text-[var(--color-text-muted)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {progress.pct}% · {Math.round(progress.attemptElapsedMs / 1000)} c
          {retry ? ` (всего ${Math.round(progress.elapsedMs / 1000)} c)` : ""}
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full overflow-hidden bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-[var(--color-brass)] transition-[width] duration-500 ease-out"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <span className="text-[10px] text-[var(--color-text-muted)]">
        Фазы реальные, проценты внутри ожидания — оценка (обычно ~
        {Math.round(progress.estimateMs / 1000)} c)
        {progress.attemptTimeoutMs > 0
          ? `; таймаут попытки ${Math.round(progress.attemptTimeoutMs / 1000)} c`
          : ""}
      </span>
      {retry && (
        <span className="text-[10px] text-[var(--color-ink-amber)]">
          Предыдущая попытка не уложилась в таймаут — вызов перезапущен с нуля.
        </span>
      )}
    </div>
  );
}
