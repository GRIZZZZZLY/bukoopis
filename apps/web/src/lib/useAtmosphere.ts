import { useSyncExternalStore } from "react";

/** Атмосфера «кабинета»: full — свечение, пыль, зерно; calm — то же без
 *  анимаций; off — чистый UI. Переключателя больше нет (решение автора
 *  2026-09-23): атмосфера всегда полная, и только системное «уменьшить
 *  движение» гасит анимации до calm. */
export type AtmosphereMode = "full" | "calm" | "off";

const mode: AtmosphereMode = "full";

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

export function useAtmosphere(): AtmosphereMode {
  return useSyncExternalStore(
    () => () => {},
    getAtmosphere,
    () => "off" as const,
  );
}
