/**
 * Дописана ли глава до конца, когда бэкенд причину остановки не сообщает.
 *
 * С5 ревью 2026-09-19: `stop_reason` читается только на прямом API. Бэкенд
 * подписки — тот, на котором Писатель работает по умолчанию, — не сообщает
 * его вовсе, поэтому каждый кандидат получал статус `incomplete` и красное
 * «Завершение не подтверждено». Предупреждение, которое горит всегда,
 * перестаёт читаться: автор пролистывает его и на той главе, где обрыв
 * настоящий.
 *
 * Причину остановки мы не выдумываем. Но у текста, оборванного посреди
 * фразы, есть признак, который виден и без неё: он не кончается знаком
 * завершения. Это и проверяется.
 */

/** Чем кончается дописанная русская проза: точка, троеточие, знак вопроса
 *  или восклицания, закрывающая кавычка или скобка после них, тире реплики. */
const FINISHED_TAIL = /[.!?…»"'）)\]]\s*$/u;

export type ProseCompletionVerdict = {
  /** `true` — есть основания считать текст дописанным. */
  looksComplete: boolean;
  /** Почему так решено; идёт в интерфейс, а не только в лог. */
  reason: "stop_reason" | "truncated" | "cut_mid_sentence" | "tail_looks_done";
};

export function judgeProseCompletion(
  stopReason: string | null,
  text: string,
): ProseCompletionVerdict {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    return { looksComplete: true, reason: "stop_reason" };
  }
  if (stopReason !== null) {
    // `max_tokens` и всё прочее известное — обрыв, о котором сказал бэкенд.
    return { looksComplete: false, reason: "truncated" };
  }
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return { looksComplete: false, reason: "cut_mid_sentence" };
  return FINISHED_TAIL.test(trimmed)
    ? { looksComplete: true, reason: "tail_looks_done" }
    : { looksComplete: false, reason: "cut_mid_sentence" };
}
