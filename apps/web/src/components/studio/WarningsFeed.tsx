import type { StudioWarning } from "@book-forge/shared";

interface Props {
  warnings: StudioWarning[];
}

const SEVERITY_COLOR: Record<StudioWarning["severity"], string> = {
  info: "text-blue-700 bg-blue-50",
  warning: "text-amber-800 bg-amber-50",
  danger: "text-red-700 bg-red-50",
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
