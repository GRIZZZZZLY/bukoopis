import { useEffect, useState } from "react";
import { api } from "@/api/client";
import {
  candleLevel,
  readWordGoal,
  saveWordGoal,
} from "@/lib/candle";

/** Свеча в TopBar: воск тает по мере дневной цели слов. Клик — поповер с целью. */
export function CandleGauge() {
  const [words, setWords] = useState<number | null>(null);
  const [goal, setGoal] = useState(readWordGoal);
  const [open, setOpen] = useState(false);
  const [draftGoal, setDraftGoal] = useState(String(readWordGoal()));

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .getWritingProgress()
        .then((p) => {
          if (alive) setWords(p.wordsAdded);
        })
        .catch(() => {
          /* сервер молчит — свеча просто не двигается */
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const level = candleLevel(words ?? 0, goal);
  const wax = 4 + Math.round((1 - level) * 12); // 16px в начале дня → 4px огарок
  const flameY = 21 - wax - 3.2;

  const submitGoal = () => {
    const n = Number(draftGoal);
    if (Number.isFinite(n) && n > 0) {
      saveWordGoal(n);
      setGoal(Math.round(n));
    }
    setOpen(false);
  };

  return (
    <div className="candle-wrap">
      <button
        type="button"
        className="candle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Слов сегодня: ${words ?? 0} из ${goal}`}
        title={`Слов сегодня: ${words ?? "…"} / ${goal}`}
      >
        <svg width="12" height="24" viewBox="0 0 12 24" aria-hidden="true">
          <ellipse
            className="candle-flame"
            cx="6"
            cy={flameY}
            rx="2"
            ry="3.2"
          />
          <rect
            className="candle-wax"
            x="3.5"
            y={21 - wax}
            width="5"
            height={wax}
            rx="1.5"
          />
          <rect className="candle-base" x="2" y="21.5" width="8" height="1.5" rx="0.75" />
        </svg>
        <span className="candle-count mono">{words ?? "–"}</span>
      </button>
      {open && (
        <div className="candle-pop" role="dialog" aria-label="Дневная цель">
          <div className="candle-pop-row">
            <span className="strong">{words ?? 0}</span>
            <span className="faint"> / {goal} слов сегодня</span>
          </div>
          <label className="candle-pop-row candle-pop-label">
            Цель на день
            <input
              type="number"
              min={1}
              value={draftGoal}
              onChange={(e) => setDraftGoal(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-primary candle-pop-save" onClick={submitGoal}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}
