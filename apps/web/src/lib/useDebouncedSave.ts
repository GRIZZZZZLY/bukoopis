import { useCallback, useEffect, useRef, useState } from "react";

export interface DebouncedSaveOptions<T> {
  delayMs?: number;
  isEqual?: (a: T, b: T) => boolean;
  /** Паузы перед повторами упавшего сохранения, по порядку; дальше берётся
   *  последняя. В10 ревью 2026-09-19: сбой автосейва не перезапускал таймер,
   *  и набранный текст висел несохранённым до следующей клавиши — а если
   *  автор отвлёкся, то до закрытия вкладки. */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000] as const;

// Generic debounced-save hook. The caller registers content via `mark(value)`.
// After `delayMs` of inactivity AND a real change vs last saved value,
// `onSave(value)` is called. Returns `{ mark, lastSavedAt, saving }`.
//
// Designed so the caller stays in control of WHAT to save (e.g. TipTap JSON,
// arbitrary form state). No DOM/editor coupling here.
export function useDebouncedSave<T>(
  onSave: (value: T) => Promise<void> | void,
  options: DebouncedSaveOptions<T> = {},
) {
  const delayMs = options.delayMs ?? 1000;
  const eq =
    options.isEqual ??
    ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));

  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;

  const lastSavedRef = useRef<T | undefined>(undefined);
  const pendingRef = useRef<T | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const scheduleRef = useRef<(delay: number) => void>(() => {});

  const flush = useCallback(async () => {
    const value = pendingRef.current;
    if (value === undefined) return;
    if (lastSavedRef.current !== undefined && eq(value, lastSavedRef.current)) {
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      lastSavedRef.current = value;
      attemptRef.current = 0;
      setLastSavedAt(new Date());
    } catch (e) {
      // Сохранение упало — пробуем снова сами. Иначе о нём узнают только по
      // следующей клавише, а текст всё это время нигде не лежит.
      const delay =
        retryDelays[Math.min(attemptRef.current, retryDelays.length - 1)] ??
        30_000;
      attemptRef.current += 1;
      scheduleRef.current(delay);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [eq, onSave, retryDelays]);

  const schedule = useCallback(
    (delay: number) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush().catch(() => {
          /* повтор уже запланирован внутри flush */
        });
      }, delay);
    },
    [flush],
  );
  scheduleRef.current = schedule;

  const mark = useCallback(
    (value: T) => {
      pendingRef.current = value;
      // Новая правка вытесняет и отложенный повтор: сохранять теперь надо её.
      attemptRef.current = 0;
      schedule(delayMs);
    },
    [delayMs, schedule],
  );

  // Force-save bypassing the debounce — useful for Ctrl+S.
  const flushNow = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flush();
  }, [flush]);

  // Allow caller to declare an externally-saved baseline (e.g. after a
  // non-debounced save or a load). Prevents next debounce from re-saving.
  const setBaseline = useCallback((value: T) => {
    lastSavedRef.current = value;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { mark, flushNow, setBaseline, lastSavedAt, saving };
}
