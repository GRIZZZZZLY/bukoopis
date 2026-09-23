import { useSyncExternalStore } from "react";

/** Идущая работа модели, видимая в верхней панели на любой странице.
 *  Публикует тот, кто запустил работу (письмо главы, разбор материалов),
 *  и он же снимает её по завершении. Вне React — как saveStatus. */
export interface RunningJob {
  /** Что делается, по-русски: «Пишет главу 4 · беат 3 из 6». */
  label: string;
  startedAt: number;
  /** Потрачено к этому моменту, если источник это знает. */
  costLabel?: string;
  onStop?: () => void;
}

let job: RunningJob | null = null;
let current = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Возвращает номер работы: по нему её обновляют и снимают. */
export function startJob(next: Omit<RunningJob, "startedAt">): number {
  job = { ...next, startedAt: Date.now() };
  current += 1;
  emit();
  return current;
}

/** Обновить подпись или стоимость, не сбрасывая часы. Чужой номер —
 *  поздний отклик прежней работы — ничего не меняет. */
export function updateJob(
  id: number,
  patch: Partial<Omit<RunningJob, "startedAt">>,
): void {
  if (!job || id !== current) return;
  job = { ...job, ...patch };
  emit();
}

export function finishJob(id: number): void {
  if (id !== current) return;
  job = null;
  emit();
}

export function getJob(): RunningJob | null {
  return job;
}

export function subscribeJob(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useJob(): RunningJob | null {
  return useSyncExternalStore(subscribeJob, getJob, () => null);
}
