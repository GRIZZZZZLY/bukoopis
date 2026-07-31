import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  side = "right",
  title,
  children,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panelRef.current?.focus?.();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Закрытую панель не рендерим вовсе. Полагаться на translate-утилиты для
  // увода за край нельзя: в этой сборке Tailwind не генерирует transform-класс
  // (translate/rotate/scale отсутствуют), и панель оставалась поверх контента.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 pointer-events-auto">
      <div
        className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "absolute top-0 bottom-0 w-[min(380px,90vw)] bg-[var(--color-background)] border-[var(--color-border)] shadow-xl flex flex-col",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-accent)] text-xl leading-none"
            >
              ×
            </button>
          </div>
        )}
        {/* Содержимое рисовалось для 400px-рейла: без min-w-0/переноса длинные
            строки и nowrap-панели вылезали за край экрана и обрезались. */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 [&_*]:min-w-0 break-words">
          {children}
        </div>
      </div>
    </div>
  );
}
