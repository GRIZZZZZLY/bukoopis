import { useSaveStatus } from "@/lib/saveStatus";

/** Чернильница в подвале рукописи: капля падает при автосейве. Чистый декор. */
export function InkwellStatus() {
  const save = useSaveStatus();
  return (
    <span
      className={`inkwell ${save.kind === "saving" ? "inkwell-drip" : ""}`}
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path className="inkwell-body" d="M2 6 h10 v5 a2 2 0 0 1 -2 2 h-6 a2 2 0 0 1 -2 -2 Z" />
        <rect className="inkwell-neck" x="5" y="3" width="4" height="3" rx="1" />
        <circle className="inkwell-drop" cx="7" cy="9" r="1.4" />
      </svg>
    </span>
  );
}
