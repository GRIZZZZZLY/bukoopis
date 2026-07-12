import { useSyncExternalStore } from "react";

/** Атмосфера «кабинета»: full — всё, calm — свет/текстуры без анимаций, off — чистый UI. */
export type AtmosphereMode = "full" | "calm" | "off";

const STORAGE_KEY = "bf-atmosphere";
const CYCLE: AtmosphereMode[] = ["full", "calm", "off"];

function readInitial(): AtmosphereMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "full" || raw === "calm" || raw === "off") return raw;
  } catch {
    /* приватный режим/недоступный storage — дефолт */
  }
  return "full";
}

let mode: AtmosphereMode = readInitial();
const listeners = new Set<() => void>();

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Режим с учётом системного reduce: full деградирует до calm. */
export function effectiveMode(m: AtmosphereMode = mode): AtmosphereMode {
  return m === "full" && reducedMotion() ? "calm" : m;
}

export function applyAtmosphereClass(): void {
  const el = document.documentElement;
  el.classList.remove("atm-full", "atm-calm", "atm-off");
  el.classList.add(`atm-${effectiveMode()}`);
}

export function getAtmosphere(): AtmosphereMode {
  return mode;
}

export function setAtmosphere(next: AtmosphereMode): void {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyAtmosphereClass();
  listeners.forEach((l) => l());
}

export function cycleAtmosphere(): void {
  const i = CYCLE.indexOf(mode);
  setAtmosphere(CYCLE[(i + 1) % CYCLE.length] ?? "full");
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAtmosphere(): AtmosphereMode {
  return useSyncExternalStore(subscribe, getAtmosphere, () => "off" as const);
}
