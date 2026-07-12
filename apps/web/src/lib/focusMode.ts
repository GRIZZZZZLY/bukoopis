import { useSyncExternalStore } from "react";

/** Фокус-режим: shell гаснет, остаётся рукопись. Живёт вне React —
    AppShell и ChapterPage подключаются к одному состоянию. */

let focused = false;
const listeners = new Set<() => void>();

export function isFocused(): boolean {
  return focused;
}

export function setFocus(v: boolean): void {
  if (focused === v) return;
  focused = v;
  listeners.forEach((l) => l());
}

export function toggleFocus(): void {
  setFocus(!focused);
}

export function subscribeFocus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(subscribeFocus, isFocused, () => false);
}
