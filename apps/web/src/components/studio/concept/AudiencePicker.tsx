import type { Audience } from "@book-forge/shared";

const OPTIONS: Array<{ value: Audience; label: string }> = [
  { value: "ya", label: "YA (12–18)" },
  { value: "adult", label: "Adult (18+)" },
  { value: "all_ages", label: "All ages" },
  { value: "mg", label: "Middle grade (8–12)" },
];

interface Props {
  value: Audience;
  onChange: (next: Audience) => void;
}

export function AudiencePicker({ value, onChange }: Props) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-label="Целевая аудитория"
    >
      <legend className="text-sm font-medium">Целевая аудитория</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={
                "border rounded-md px-3 py-1.5 text-sm cursor-pointer " +
                (checked
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
              }
            >
              <input
                type="radio"
                name="audience"
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
