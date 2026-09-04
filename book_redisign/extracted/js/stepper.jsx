(function(){
// app/stepper.jsx — StageStepper + StageCard

const { STAGES } = window.LW_DATA;
const { cn, Pill, Dot, I } = window.LW;

function statusGlyph(status) {
  if (status === "complete")    return <I.Check />;
  if (status === "in_progress") return <I.Play />;
  if (status === "skipped")     return <I.Skip />;
  return <I.Dot />;
}
function statusLabel(status) {
  return { complete: "Готово", in_progress: "В работе", todo: "Не начато", skipped: "Пропущено" }[status] || "—";
}
function statusTone(status) {
  return { complete: "green", in_progress: "brass", todo: "muted", skipped: "muted" }[status];
}

function StageStepper({ bookId, activeStageId, stages }) {
  const doneCount = STAGES.filter((s) => stages[s.id] === "complete").length;
  return (
    <nav className="stepper" aria-label="Этапы создания книги">
      <ol className="stepper-list">
        {STAGES.map((s, i) => {
          const st = stages[s.id] || "todo";
          const active = s.id === activeStageId;
          return (
            <li
              key={s.id}
              className={cn("step", `step-${st}`, active && "step-active")}
              aria-current={active ? "step" : undefined}
            >
              <a href={`#/books/${bookId}/studio/${s.id === "concept" ? "" : s.id}`} className="step-inner">
                <span className="step-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="step-glyph" aria-hidden="true">{statusGlyph(st)}</span>
                <span className="step-label">{s.label}</span>
              </a>
              {i < STAGES.length - 1 && <span className="step-rail" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      <div className="stepper-counter mono">
        <span className="strong">{doneCount}</span>
        <span className="faint">/7</span>
      </div>
    </nav>
  );
}

function StageCard({ stageId, label, status, recommended, href, icon, count }) {
  const Icon = window.LW.I[icon] || I.Dot;
  return (
    <a
      href={href}
      className={cn("stagecard", `stagecard-${status}`, recommended && "stagecard-reco")}
    >
      <div className="stagecard-top">
        <span className="stagecard-icon" aria-hidden="true"><Icon /></span>
        <span className={cn("stagecard-status pill", `pill-${statusTone(status)}`)}>
          <span aria-hidden="true">{statusGlyph(status)}</span>
          {statusLabel(status)}
        </span>
      </div>
      <h3 className="stagecard-title">{label}</h3>
      <div className="stagecard-meta cap mono">
        {count != null && <span>{count} аспект.</span>}
        {recommended && <span className="stagecard-reco-flag">↳ продолжить</span>}
      </div>
    </a>
  );
}

window.LW = Object.assign(window.LW, { StageStepper, StageCard, statusGlyph, statusLabel, statusTone });

})();
