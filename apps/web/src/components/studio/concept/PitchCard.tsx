import {
  AUDIENCE_LABELS,
  PITCH_FIELD_LABELS,
  type Pitch,
  type PitchMixField,
} from "@book-forge/shared";

interface Props {
  pitch: Pitch;
  isNew: boolean;
  mixMode: boolean;
  picks: Partial<Record<PitchMixField, string>>;
  onPick: (field: PitchMixField, pitchId: string) => void;
  onChoose: (pitchId: string) => void;
  onRemove: (pitchId: string) => void;
  busy: boolean;
}

const ROWS: PitchMixField[] = ["logline", "protagonist", "conflict", "stakes", "hook"];

export function PitchCard({ pitch, isNew, mixMode, picks, onPick, onChoose, onRemove, busy }: Props) {
  function row(field: PitchMixField, value: string) {
    const label = PITCH_FIELD_LABELS[field];
    return (
      <div className="pitch-row" key={field}>
        <div className="pitch-label">
          {mixMode ? (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input
                type="radio"
                name={`mix-${field}`}
                checked={picks[field] === pitch.id}
                onChange={() => onPick(field, pitch.id)}
                aria-label={`${label}: взять из «${pitch.workingTitle}»`}
              />
              {label}
            </label>
          ) : (
            label
          )}
        </div>
        <div className="pitch-value">{value}</div>
      </div>
    );
  }

  return (
    <article className={"pitch-card" + (isNew ? " is-new" : "")} aria-label={pitch.workingTitle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h4 className="pitch-title">{pitch.workingTitle}</h4>
        {isNew && <span className="pill pill-brass">новый</span>}
      </header>
      <div className="pitch-tags">
        <span className="pill">{pitch.genre}</span>
        <span className="pill">{pitch.tone}</span>
        <span className="pill">{AUDIENCE_LABELS[pitch.audience]}</span>
      </div>
      {ROWS.map((f) => row(f, pitch[f]))}
      <div className="pitch-verdict">
        <div className="pitch-row">
          <div className="pitch-label">Чем сильна</div>
          <div className="pitch-value">{pitch.strength}</div>
        </div>
        <div className="pitch-row">
          <div className="pitch-label">Где риск</div>
          <div className="pitch-value">{pitch.risk}</div>
        </div>
      </div>
      <div className="pitch-actions">
        <button type="button" className="btn btn-primary" disabled={busy || mixMode} onClick={() => onChoose(pitch.id)}>
          Выбрать этот
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onRemove(pitch.id)}>
          Убрать
        </button>
      </div>
    </article>
  );
}
