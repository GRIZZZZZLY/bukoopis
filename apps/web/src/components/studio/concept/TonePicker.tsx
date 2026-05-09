import { TONES } from "@book-forge/shared";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TonePicker({ selected, onChange }: Props) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((t) => t !== id));
    else onChange([...selected, id]);
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-label="Тон/настроение">
      <legend className="text-sm font-medium">Тон/настроение</legend>
      <div className="flex flex-wrap gap-2">
        {TONES.map((t) => {
          const isOn = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(t.id)}
              className={
                "border rounded-md px-3 py-1.5 text-sm " +
                (isOn
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
