/* global React, Icon, I, Button, Pill, Card, Progress, StageStepper, SevDot, STAGES, useRoute, MOCK_BOOKS, STAGE_LABEL */
const { useState } = React;

const StudioPage = ({ bookId }) => {
  const { navigate } = useRoute();
  const book = MOCK_BOOKS.find(b => b.id === Number(bookId)) || MOCK_BOOKS[0];
  const statuses = {
    concept: "done", world: "done", lore: "done",
    characters: "current", items: "todo",
    plot: "todo", chapters: "todo",
  };
  const doneCount = STAGES.filter(s => statuses[s.id] === "done").length;
  const recommended = "characters";

  return (
    <div className="route" data-screen-label="Studio dashboard">
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 32px 96px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 24 }}>
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>Студия</div>
            <h1 className="font-display" style={{ fontSize: 32, fontWeight: 500, margin: 0, color: "var(--color-text-strong)", letterSpacing: "-0.015em" }}>
              {book.title}
            </h1>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
              {book.genre} · {book.audience} · последняя правка {book.updated}
            </div>
          </div>
          <nav aria-label="Навигация по студии" style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" icon={I.cog} onClick={() => navigate(`/books/${book.id}/studio/settings`)}>
              Настройки
            </Button>
            <Button variant="ghost" icon={I.list} onClick={() => navigate(`/books/${book.id}/studio/chapters`)}>
              Главы
            </Button>
          </nav>
        </div>

        <div style={{ marginBottom: 28, overflowX: "auto", paddingBottom: 4 }}>
          <StageStepper statuses={statuses} onNavigate={(id) => navigate(`/books/${book.id}/studio/${id}`)}/>
        </div>

        <div className="panel" style={{ padding: 24, marginBottom: 24, display: "flex", alignItems: "center", gap: 32 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div>
                <span className="font-display" style={{ fontSize: 18, fontWeight: 500 }}>Готово </span>
                <span className="font-mono" style={{ fontSize: 18, color: "var(--color-brass)" }}>{doneCount}/7</span>
              </div>
              <div className="text-muted" style={{ fontSize: 13 }}>
                Далее: <span style={{ color: "var(--color-text)" }}>{STAGE_LABEL[recommended]}</span>
              </div>
            </div>
            <Progress value={doneCount} max={7} label="Прогресс книги"/>
          </div>
          <Button variant="primary" iconRight={I.arrow}
                  onClick={() => navigate(`/books/${book.id}/studio/${recommended}`)}>
            Продолжить
          </Button>
        </div>

        <WarningsFeed onNavigate={(stage) => navigate(`/books/${book.id}/studio/${stage}`)}/>
        <ConceptForm/>

        <div style={{ marginTop: 28, marginBottom: 12 }}>
          <h2 className="font-display" style={{ fontSize: 22, fontWeight: 500, margin: "0 0 4px", color: "var(--color-text-strong)" }}>
            Этапы
          </h2>
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>Кликните, чтобы перейти к проработке.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {STAGES.map(s => (
            <StageCard key={s.id}
                       stage={s}
                       status={statuses[s.id]}
                       recommended={s.id === recommended}
                       onClick={() => navigate(`/books/${book.id}/studio/${s.id}`)}/>
          ))}
        </div>
      </div>
    </div>
  );
};

const WarningsFeed = ({ onNavigate }) => {
  const warnings = [
    { tone: "amber", title: "Антагонист без чёткого мотива", body: "В концепте упоминается «Барон», но его цель не сформулирована — критик-агент рекомендует уточнить.", stage: "concept" },
    { tone: "blue",  title: "12 фактов канона не закреплены", body: "Накоплены факты из глав 1–3, но не привязаны к сущностям. Перейдите в Знания, чтобы свести.", stage: "chapters" },
  ];
  return (
    <div className="panel" style={{ padding: 4, marginBottom: 24 }}>
      {warnings.map((w, i) => (
        <div key={i} style={{
          display: "flex", gap: 12, padding: "12px 16px",
          borderTop: i === 0 ? "none" : "1px solid var(--color-border-soft)",
        }}>
          <SevDot tone={w.tone} size={10}/>
          <div style={{ flex: 1 }}>
            <div style={{ color: "var(--color-text-strong)", fontWeight: 500, fontSize: 13 }}>{w.title}</div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{w.body}</div>
          </div>
          <a href="#" onClick={e => { e.preventDefault(); onNavigate(w.stage); }} style={{ fontSize: 12, alignSelf: "center" }}>
            {STAGE_LABEL[w.stage]} →
          </a>
        </div>
      ))}
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
      <label className="caption">{label}</label>
      <button className="btn-link" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon d={I.spark} size={11}/> уточнить
      </button>
    </div>
    {children}
    {hint && <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4, fontFamily: "var(--font-mono)" }}>{hint}</div>}
  </div>
);

const ConceptForm = () => (
  <div className="panel paper" style={{ padding: 28, marginTop: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, position: "relative", zIndex: 1 }}>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 500, margin: 0, color: "var(--color-text-strong)" }}>
        Концепт
      </h2>
      <Pill tone="green" dot>принят</Pill>
    </div>
    <div className="text-muted" style={{ fontSize: 13, marginBottom: 20, position: "relative", zIndex: 1 }}>
      Опорный документ книги. Все агенты сверяются с ним при работе.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative", zIndex: 1 }}>
      <Field label="Логлайн" hint="Одно предложение, цепляющее за интригу.">
        <textarea className="textarea" rows={2} defaultValue={
          "Когда последний картограф империи находит карту, которой не должно существовать, его собственная страна начинает исчезать с глобуса — улица за улицей."
        }/>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Протагонист">
          <textarea className="textarea" rows={3} defaultValue={"Эльдар Ваковски, 43, картограф Третьего бюро. Алкоголик в завязке, помнит каждый поворот, который когда-либо чертил."}/>
        </Field>
        <Field label="Конфликт">
          <textarea className="textarea" rows={3} defaultValue={"Государство стирает топонимы, чтобы переписать историю. Карта Эльдара — единственное доказательство, что они когда-либо существовали."}/>
        </Field>
      </div>
      <Field label="Ставки" hint="Что произойдёт, если протагонист проиграет.">
        <textarea className="textarea" rows={2} defaultValue={"Целые поколения исчезнут из коллективной памяти. Дочь Эльдара не будет помнить, в каком городе родилась."}/>
      </Field>
    </div>
  </div>
);

const StageCard = ({ stage, status, recommended, onClick }) => {
  const info = {
    done:    { label: "Завершено", glyph: "✓", color: "var(--color-ink-green)" },
    current: { label: "В работе",  glyph: "▶", color: "var(--color-brass)" },
    todo:    { label: "Не начато", glyph: "●", color: "var(--color-text-faint)" },
    skipped: { label: "Пропущено", glyph: "↷", color: "var(--color-text-faint)" },
  }[status || "todo"];
  const style = recommended ? { borderColor: "var(--color-brass-soft)", boxShadow: "var(--shadow-glow)" } : null;
  return (
    <div className="card hoverable" onClick={onClick} style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: recommended ? "var(--color-brass-glow)" : "var(--color-surface-2)",
          color: recommended ? "var(--color-brass)" : "var(--color-text-muted)",
          display: "grid", placeItems: "center",
        }}>
          <Icon d={stage.icon} size={18}/>
        </div>
        <span style={{ fontSize: 10, color: info.color }}>{info.glyph}</span>
      </div>
      <h3 className="font-display" style={{ fontSize: 18, fontWeight: 500, margin: 0, color: "var(--color-text-strong)" }}>
        {stage.label}
      </h3>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{info.label}</div>
      {recommended && (
        <div className="font-mono" style={{ marginTop: 12, fontSize: 11, color: "var(--color-brass)" }}>
          → рекомендовано
        </div>
      )}
    </div>
  );
};

window.StudioPage = StudioPage;
