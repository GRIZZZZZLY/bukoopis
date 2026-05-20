import type { StudioWarning } from "@book-forge/shared";

interface Props {
  warnings: StudioWarning[];
}

const SEVERITY_COLOR: Record<StudioWarning["severity"], string> = {
  info: "text-[var(--color-ink-blue)] bg-[var(--color-ink-blue-tint)] border border-[var(--color-ink-blue)]/40",
  warning: "text-[var(--color-ink-amber)] bg-[var(--color-ink-amber-tint)] border border-[var(--color-ink-amber)]/40",
  danger: "text-[var(--color-ink-red)] bg-[var(--color-ink-red-tint)] border border-[var(--color-ink-red)]/40",
};

export function WarningsFeed({ warnings }: Props) {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Предупреждений нет.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="studio-warnings">
      {warnings.map((w) => (
        <li
          key={w.id}
          className={`text-sm rounded px-3 py-2 ${SEVERITY_COLOR[w.severity]}`}
        >
          {w.message}
        </li>
      ))}
    </ul>
  );
}
