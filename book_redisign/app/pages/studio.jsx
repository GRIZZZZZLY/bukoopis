(function(){
// app/pages/studio.jsx — Studio dashboard

const { STAGES: ST, BOOKS: BKS, WARNINGS } = window.LW_DATA;
const { StageStepper, StageCard, Button: BtnS, Pill: PillS, I: IS, Dot: DotS, ProgressBar, Card } = window.LW;

function WarningsFeed({ warnings }) {
  if (!warnings.length) return null;
  return (
    <div className="warn-feed">
      {warnings.map((w) => (
        <div key={w.id} className={`warn warn-${w.severity}`} role={w.severity === "red" ? "alert" : undefined}>
          <DotS tone={w.severity === "red" ? "red" : "amber"} size={8} />
          <div className="warn-body">
            <div className="warn-title">{w.title}</div>
            <div className="warn-desc">{w.body}</div>
          </div>
          {w.link && <a href={w.link.route} className="warn-link mono">{w.link.label} →</a>}
        </div>
      ))}
    </div>
  );
}

function ConceptField({ label, placeholder, value, multiline }) {
  return (
    <div className="concept-field">
      <div className="concept-field-head">
        <label className="field-label">{label}</label>
        <button className="refine-btn" aria-label={`Доработать ${label}`}>
          <IS.Wand /> <span>Доработать ИИ</span>
        </button>
      </div>
      {multiline
        ? <textarea className="textarea" rows={3} defaultValue={value} placeholder={placeholder} />
        : <input className="input input-lg" defaultValue={value} placeholder={placeholder} />}
      <div className="field-hint">{value ? `сохранено · ${value.length} зн.` : "не заполнено"}</div>
    </div>
  );
}

function ConceptForm({ book }) {
  return (
    <Card className="concept">
      <div className="concept-head">
        <h3>Концепт книги</h3>
        <span className="cap-upper">Этап 1 из 7</span>
      </div>
      <ConceptField
        label="Логлайн"
        value="Молодая наследница соляного дома учится отличать собственный голос от голосов, которые жили здесь до неё."
      />
      <ConceptField
        label="Главный герой"
        value="Лина, 24 года. Унаследовала дом после смерти бабушки. Слышит звуки за стеной, которых не слышат другие."
        multiline
      />
      <div className="concept-row">
        <ConceptField label="Конфликт" value="Внутренний — между поверить и не поверить." />
        <ConceptField label="Ставки" value="Если поверит — потеряет рассудок. Если не поверит — потеряет дом." />
      </div>
    </Card>
  );
}

function StudioPage({ route }) {
  const book = BKS.find((b) => b.id === route.bookId) || BKS[0];
  const doneCount = ST.filter((s) => book.stages[s.id] === "complete").length;
  const nextStage = ST.find((s) => book.stages[s.id] !== "complete");
  const reco = book.recommended || (nextStage && nextStage.id);
  const recoLabel = ST.find((s) => s.id === reco)?.label || "Главы";

  return (
    <div className="page page-studio">
      <div className="page-head">
        <h1>Studio</h1>
        <nav aria-label="Навигация по студии" className="studio-nav">
          <a href={`#/books/${book.id}/studio/settings`}><IS.Settings /> Настройки</a>
          <a href={`#/books/${book.id}/studio/chapters`}><IS.Book /> Главы</a>
        </nav>
      </div>

      <StageStepper bookId={book.id} stages={book.stages} activeStageId="concept" />

      <Card className="prog-block">
        <div className="prog-row">
          <ProgressBar
            value={doneCount} max={7}
            label="Прогресс книги"
            valueLabel={`${doneCount}/7`}
          />
        </div>
        <div className="prog-foot">
          <div className="prog-meta">
            {doneCount < 7 ? (
              <>
                <span className="muted">Готово</span>
                <span className="strong tabular">{doneCount}/7</span>
                <span className="muted">· Далее:</span>
                <span className="strong">{recoLabel}</span>
              </>
            ) : (
              <span className="strong">Книга проработана</span>
            )}
          </div>
          {reco && (
            <BtnS variant="primary" iconRight={<IS.ArrowR />} as="a" href={`#/books/${book.id}/studio/${reco === "concept" ? "" : reco === "chapters" ? "chapters" : reco}`}>
              Продолжить
            </BtnS>
          )}
        </div>
      </Card>

      <WarningsFeed warnings={WARNINGS} />

      <ConceptForm book={book} />

      <div className="stagecard-grid">
        {ST.map((s) => (
          <StageCard
            key={s.id}
            stageId={s.id}
            label={s.label}
            status={book.stages[s.id] || "todo"}
            recommended={s.id === reco}
            href={`#/books/${book.id}/studio/${s.id === "concept" ? "" : s.id}`}
            icon={s.icon}
            count={ s.id === "world" ? 6 : s.id === "lore" ? 8 : s.id === "characters" ? 4 : s.id === "items" ? 3 : s.id === "plot" ? 5 : null }
          />
        ))}
      </div>
    </div>
  );
}

window.LW = Object.assign(window.LW, { StudioPage, WarningsFeed, ConceptForm });

})();
