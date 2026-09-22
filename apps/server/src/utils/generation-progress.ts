/** Прогресс структурной LLM-генерации (аспекты studio).
 *
 *  Токен-дельт у structured-режима нет (mcp_submit_tool отдаёт один tool-call),
 *  поэтому проценты — это фазовые вехи + интерполяция по прошедшему времени
 *  внутри фазы ожидания. Фазы реальные (события диспетчера), интерполяция —
 *  оценка; UI обязан подписывать её как оценку, а 100% ставится только по
 *  фактическому `done`.
 */

export type GenerationPhase =
  | "context"
  | "dispatch"
  | "model"
  | "writing"
  | "submitting"
  | "validating"
  | "done";

/** Медиана наблюдаемой длительности вызова aspect_entity_variants (~76 c на
 *  subscription-бэкенде, замер 2026-08-01). Только для интерполяции. */
export const ESTIMATED_TOTAL_MS = 75_000;

/** Ожидаемая длительность по типу вызова (замеры на subscription-бэкенде,
 *  2026-08-01): entity-варианты 76–86 c, markdown-варианты 121 c (три абзаца
 *  по ~2000 символов). Refine и playbook — оценка от объёма ответа: у refine
 *  один вариант, у плейбука список коротких строк. Влияет только на скорость
 *  роста полосы. */
export const ESTIMATE_MS = {
  entityVariants: ESTIMATED_TOTAL_MS,
  markdownVariants: 120_000,
  refine: 60_000,
  playbook: 40_000,
  /** Весь документ одним вызовом: примерно столько же, сколько прежде
   *  занимали плейбук и пять–шесть вариантов по отдельности, но одним
   *  ожиданием. Влияет только на скорость роста полосы. */
  document: 240_000,
} as const;

/** [floor, ceil] коридор процента для каждой фазы. */
const PHASE_RANGE: Record<GenerationPhase, readonly [number, number]> = {
  context: [3, 3],
  dispatch: [8, 8],
  // Ожидание модели интерполируется по времени: иначе полоса стоит на месте
  // всю минуту вызова, пока не придёт первое сообщение ассистента.
  model: [15, 88],
  writing: [20, 88],
  submitting: [90, 90],
  validating: [95, 95],
  done: [100, 100],
};

/** Процент для фазы и прошедшего времени. Монотонность обеспечивает вызывающий
 *  (см. `ProgressTracker`): сама функция чистая и без состояния. */
export function progressPct(
  phase: GenerationPhase,
  elapsedMs: number,
  estimateMs: number = ESTIMATED_TOTAL_MS,
): number {
  const [floor, ceil] = PHASE_RANGE[phase];
  if (ceil === floor) return floor;
  const span = estimateMs > 0 ? Math.min(1, Math.max(0, elapsedMs / estimateMs)) : 1;
  return Math.min(ceil, Math.round(floor + (ceil - floor) * span));
}

/** Счётчик прогресса одной генерации: внутри попытки процент не убывает и до
 *  `done` не достигает 100; на новой попытке откатывается (вызов начинается
 *  заново). Проценты считаются от времени ТЕКУЩЕЙ попытки, а не от общего. */
export class ProgressTracker {
  private phaseValue: GenerationPhase = "context";
  private pctValue = PHASE_RANGE.context[0];
  private attemptValue = 1;
  /** Общее прошедшее время на момент старта текущей попытки. */
  private attemptStartMs = 0;
  private lastElapsedMs = 0;

  constructor(private readonly estimateMs: number = ESTIMATED_TOTAL_MS) {}

  get phase(): GenerationPhase {
    return this.phaseValue;
  }

  get pct(): number {
    return this.pctValue;
  }

  get attempt(): number {
    return this.attemptValue;
  }

  /** Новая попытка после retry. Вызов начинается с нуля, поэтому и фаза, и
   *  процент откатываются: замерший на 90% индикатор читался как зависание,
   *  хотя шёл перезапуск (наблюдение 2026-08-01, «попытка 4» на 398-й секунде).
   *  Монотонность держим только внутри попытки. */
  markAttempt(attempt: number, elapsedMs: number): void {
    this.attemptValue = attempt;
    this.lastElapsedMs = elapsedMs;
    if (attempt > 1) {
      this.phaseValue = "dispatch";
      this.pctValue = PHASE_RANGE.dispatch[0];
      this.attemptStartMs = elapsedMs;
    }
  }

  /** Время, прошедшее с начала текущей попытки. */
  attemptElapsedMs(elapsedMs: number): number {
    return Math.max(0, elapsedMs - this.attemptStartMs);
  }

  setPhase(phase: GenerationPhase, elapsedMs: number): void {
    this.phaseValue = phase;
    this.tick(elapsedMs);
  }

  /** Пересчёт процента по времени внутри текущей фазы текущей попытки. */
  tick(elapsedMs: number): number {
    this.lastElapsedMs = elapsedMs;
    const next = progressPct(
      this.phaseValue,
      elapsedMs - this.attemptStartMs,
      this.estimateMs,
    );
    if (next > this.pctValue) this.pctValue = next;
    return this.pctValue;
  }

  finish(): number {
    this.phaseValue = "done";
    this.pctValue = 100;
    return this.pctValue;
  }
}
