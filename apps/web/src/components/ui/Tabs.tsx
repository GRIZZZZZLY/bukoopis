import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
  size?: "default" | "sm";
  ariaLabel?: string;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  size = "default",
  ariaLabel,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            type="button"
            key={item.value}
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:opacity-50",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge !== null && (
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-full text-[10px] font-semibold leading-none px-1.5 py-0.5",
                  active
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                    : "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]",
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
