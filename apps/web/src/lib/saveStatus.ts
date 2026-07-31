import { useSyncExternalStore } from "react";

/** Глобальный статус сохранения рукописи: ChapterPage публикует,
    StatusBar в shell показывает. Вне React — как focusMode. */

export type SaveState = {
  kind: "idle" | "saving" | "saved" | "error";
  at: number | null;
};

const IDLE: SaveState = { kind: "idle", at: null };
let state: SaveState = IDLE;
const listeners = new Set<() => void>();

export function getSaveStatus(): SaveState {
  return state;
}

export function reportSave(next: SaveState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function resetSaveStatus(): void {
  reportSave(IDLE);
}

export function subscribeSaveStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSaveStatus(): SaveState {
  return useSyncExternalStore(subscribeSaveStatus, getSaveStatus, () => IDLE);
}
