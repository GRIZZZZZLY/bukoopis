import { useEffect } from "react";

export type HotkeyHandler = (e: KeyboardEvent) => void;

export interface HotkeyMap {
  // Keys: "mod+s", "mod+enter", "esc", "mod+shift+z", etc.
  // "mod" maps to ⌘ on Mac, Ctrl elsewhere.
  [combo: string]: HotkeyHandler | undefined;
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || "");

function comboMatches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  let want = {
    mod: false,
    shift: false,
    alt: false,
    key: "",
  };
  for (const p of parts) {
    if (p === "mod") want.mod = true;
    else if (p === "shift") want.shift = true;
    else if (p === "alt") want.alt = true;
    else want.key = p;
  }
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (want.mod && !modPressed) return false;
  if (!want.mod && modPressed) return false;
  if (want.shift !== e.shiftKey) return false;
  if (want.alt !== e.altKey) return false;
  if (want.key === "esc") {
    return e.key === "Escape";
  }
  if (want.key === "enter") {
    return e.key === "Enter";
  }
  return e.key.toLowerCase() === want.key;
}

export function useHotkeys(map: HotkeyMap, deps: React.DependencyList = []) {
  // Re-bind whenever caller's deps change. Map must be stable per-render or
  // wrapped in useMemo; otherwise effect re-runs on every render which is fine
  // because we always cleanup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [combo, handler] of Object.entries(map)) {
        if (!handler) continue;
        if (comboMatches(e, combo)) {
          handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
