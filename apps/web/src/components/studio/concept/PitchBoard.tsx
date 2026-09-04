import { useState } from "react";
import type { Pitch, PitchMixField } from "@book-forge/shared";
import { PitchCard } from "./PitchCard";

type Picks = Partial<Record<PitchMixField, string>>;

interface Props {
  pitches: Pitch[];
  newPitchIds: string[];
  questions: string[];
  busy: boolean;
  error: string | null;
  onMore: (direction: string) => Promise<void>;
  onBlend: (picks: Picks) => Promise<void>;
  onChoose: (pitchId: string) => Promise<void>;
  onRemove: (pitchId: string) => Promise<void>;
  onAnswer: (question: string, answer: string) => Promise<void>;
  onBackToIdea: () => void;
}

function distinctSources(picks: Picks): number {
  return new Set(Object.values(picks).filter((v): v is string => typeof v === "string")).size;
}

export function PitchBoard({
  pitches,
  newPitchIds,
  questions,
  busy,
  error,
  onMore,
  onBlend,
  onChoose,
  onRemove,
  onAnswer,
  onBackToIdea,
}: Props) {
  const [direction, setDirection] = useState("");
  const [mixMode, setMixMode] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const canBlend = mixMode && distinctSources(picks) >= 2;

  async function blend() {
    await onBlend(picks);
    setPicks({});
    setMixMode(false);
  }

  return (
    <section aria-label="Питчи">
      {questions.length > 0 && (
        <div className="pitch-questions" role="group" aria-label="Уточняющие вопросы">
          <p className="muted" style={{ fontSize: 13 }}>
            Задумка тонкая. Можно ответить на пару вопросов, ответ допишется к задумке и
            питчи пересоберутся. Можно и не отвечать.
          </p>
          {questions.map((q) => (
            <div key={q} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                aria-label={q}
                placeholder={q}
                value={answers[q] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                style={{ flex: 1 }}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || (answers[q] ?? "").trim().length === 0}
                onClick={() => void onAnswer(q, (answers[q] ?? "").trim())}
              >
                Добавить к задумке
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, margin: "8px 0" }}>
          {error}
        </p>
      )}

      <div className="pitch-grid">
        {pitches.map((p) => (
          <PitchCard
            key={p.id}
            pitch={p}
            isNew={newPitchIds.includes(p.id)}
            mixMode={mixMode}
            picks={picks}
            onPick={(field, id) => setPicks({ ...picks, [field]: id })}
            onChoose={(id) => void onChoose(id)}
            onRemove={(id) => void onRemove(id)}
            busy={busy}
          />
        ))}
      </div>

      <div className="pitch-toolbar">
        <input
          className="input"
          aria-label="Куда сместить"
          placeholder="Куда сместить: мрачнее, камернее, ближе к первому…"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void onMore(direction.trim())}
        >
          {busy ? "Думаем…" : "Ещё варианты"}
        </button>
        {mixMode ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy || !canBlend} onClick={() => void blend()}>
              Собрать из выбранного
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setMixMode(false);
                setPicks({});
              }}
            >
              Отмена
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" disabled={busy || pitches.length < 2} onClick={() => setMixMode(true)}>
            Смешать
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBackToIdea}>
          Изменить задумку
        </button>
      </div>
      {mixMode && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Отметь на карточках, какую строку взять откуда. Нужно хотя бы две карточки.
        </p>
      )}
    </section>
  );
}
