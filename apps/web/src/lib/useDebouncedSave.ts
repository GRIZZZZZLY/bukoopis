import { useCallback, useEffect, useRef, useState } from "react";

export interface DebouncedSaveOptions<T> {
  delayMs?: number;
  isEqual?: (a: T, b: T) => boolean;
}

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

  const lastSavedRef = useRef<T | undefined>(undefined);
  const pendingRef = useRef<T | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

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
      setLastSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }, [eq, onSave]);

  const mark = useCallback(
    (value: T) => {
      pendingRef.current = value;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, delayMs);
    },
    [delayMs, flush],
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
