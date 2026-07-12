import { useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { setFocus, toggleFocus, useFocusMode } from "@/lib/focusMode";

/** Кнопка фокус-режима + hotkey Ctrl/Cmd+Shift+F. Сбрасывает фокус при unmount. */
export function FocusToggle() {
  const focused = useFocusMode();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setFocus(false);
    };
  }, []);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm focus-toggle"
      onClick={toggleFocus}
      aria-pressed={focused}
      title={focused ? "Выйти из фокуса · Esc" : "Фокус-режим · Ctrl+Shift+F"}
    >
      {focused ? (
        <Minimize2 size={14} aria-hidden="true" />
      ) : (
        <Maximize2 size={14} aria-hidden="true" />
      )}
      <span>{focused ? "Вернуть кабинет" : "Фокус"}</span>
    </button>
  );
}
