import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { LLM_MAX_ATTEMPTS, llmTimeoutMs } from "@book-forge/llm";
import type { StructuredProgressEvent } from "@book-forge/llm";
import { ESTIMATED_TOTAL_MS, ProgressTracker } from "./generation-progress.js";

export interface StreamAgentProgressOptions<T> {
  /** Код ошибки в событии `error` — тот же, что у обычного JSON-маршрута. */
  errorCode: string;
  /** Ожидаемая длительность вызова, для интерполяции процентов. */
  estimateMs?: number;
  /** Сам вызов агента; `onProgress` прокидывается в диспетчер. */
  run: (
    onProgress: (e: StructuredProgressEvent) => void,
  ) => Promise<T>;
  /** Полезная нагрузка события `done` — совпадает с телом JSON-маршрута. */
  buildDone: (result: T) => Record<string, unknown>;
}

/** Обёртка «вызов структурного агента → SSE».
 *
 *  События: `progress` (реальные вехи диспетчера + heartbeat раз в секунду),
 *  затем ровно одно из `done` / `error`. Нужна потому, что вызовы через
 *  subscription-бэкенд идут десятки секунд, и молчащий POST выглядит как
 *  зависание. Проценты внутри фазы ожидания — оценка по времени; фазы и номер
 *  попытки — реальные.
 */
export function streamAgentProgress<T>(
  c: Context,
  opts: StreamAgentProgressOptions<T>,
): Response {
  const estimateMs = opts.estimateMs ?? ESTIMATED_TOTAL_MS;
  return streamSSE(c, async (stream) => {
    const start = Date.now();
    const tracker = new ProgressTracker(estimateMs);
    const frame = (): string => {
      const elapsedMs = Date.now() - start;
      return JSON.stringify({
        phase: tracker.phase,
        pct: tracker.pct,
        attempt: tracker.attempt,
        maxAttempts: LLM_MAX_ATTEMPTS,
        elapsedMs,
        attemptElapsedMs: tracker.attemptElapsedMs(elapsedMs),
        attemptTimeoutMs: llmTimeoutMs(),
        estimateMs,
      });
    };
    const sendProgress = async (): Promise<void> => {
      await stream.writeSSE({ event: "progress", data: frame() });
    };
    // onProgress диспетчера синхронный, запись в SSE — асинхронная. Кадр
    // снимается в момент события (несколько вех приходят в одном тике, и
    // отложенная сериализация показала бы только последнюю), а записи
    // выстраиваются в одну цепочку, чтобы не перемешивались.
    let pending: Promise<void> = Promise.resolve();
    const queueProgress = (): void => {
      const snapshot = frame();
      pending = pending
        .then(() => stream.writeSSE({ event: "progress", data: snapshot }))
        .catch(() => {});
    };

    await sendProgress();
    tracker.setPhase("dispatch", Date.now() - start);
    await sendProgress();

    const heartbeat = setInterval(() => {
      tracker.tick(Date.now() - start);
      queueProgress();
    }, 1000);

    try {
      const result = await opts.run((e) => {
        const elapsed = Date.now() - start;
        if (e.kind === "attempt") tracker.markAttempt(e.attempt, elapsed);
        else if (e.kind === "model_started") tracker.setPhase("model", elapsed);
        else if (e.kind === "model_output") tracker.setPhase("writing", elapsed);
        else if (e.kind === "tool_call") tracker.setPhase("submitting", elapsed);
        else if (e.kind === "validated")
          tracker.setPhase("validating", elapsed);
        queueProgress();
      });
      clearInterval(heartbeat);
      await pending;
      const done = opts.buildDone(result);
      tracker.finish();
      await sendProgress();
      await stream.writeSSE({ event: "done", data: JSON.stringify(done) });
    } catch (e) {
      clearInterval(heartbeat);
      await pending;
      const message = e instanceof Error ? e.message : String(e);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: opts.errorCode, message }),
      });
    }
  });
}
