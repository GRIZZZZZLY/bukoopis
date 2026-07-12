import { useEffect, useRef, useState } from "react";
import { effectiveMode, useAtmosphere } from "@/lib/useAtmosphere";

/** Кот на «подоконнике» LeftRail. Живёт только в полной атмосфере
    (и не под prefers-reduced-motion — там full деградирует до calm). */
export function CatCompanion() {
  const mode = useAtmosphere();
  const [stretch, setStretch] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (effectiveMode(mode) !== "full") return null;

  const poke = () => {
    setStretch(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStretch(false), 1600);
  };

  return (
    <button
      type="button"
      className={`cat ${stretch ? "cat-stretch" : ""}`}
      onClick={poke}
      aria-label="Погладить кота"
      title="Мур"
    >
      <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
        <path
          className="cat-body"
          d="M4 16 Q3 9 9 8 Q10 3 14 4 L15 2 L17 4 L20 4 L22 2 L23 4 Q26 5 26 8 Q33 9 32 13 Q31 16 27 16 Z"
        />
        <path
          className="cat-tail"
          d="M4 16 Q-1 15 1 11"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
