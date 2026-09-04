(function(){
// app/pages/settings.jsx — SettingsStagePage

const { BOOKS: BSET, STYLE_PROFILES: SPSET } = window.LW_DATA;
const { StageStepper: SSet, Button: BSet, Pill: PSet, I: ISet, Card: CardSet } = window.LW;

function SettingsStagePage({ route }) {
  const book = BSET.find((b) => b.id === route.bookId) || BSET[0];
  return (
    <div className="page page-stage">
      <SSet bookId={book.id} stages={book.stages} />
      <div className="page-head">
        <a href={`#/books/${book.id}/studio`} className="back-link mono">← к Studio</a>
        <h1 style={{ marginTop: 4 }}>Настройки</h1>
      </div>

      <CardSet className="panel">
        <div className="panel-head"><h3>Идентичность</h3></div>
        <div className="settings-grid">
          <div className="field">
            <label className="field-label">Название</label>
            <input className="input input-lg input-display" defaultValue={book.title} />
          </div>
          <div className="field">
            <label className="field-label">Статус</label>
            <select className="select" defaultValue={book.status}>
              <option value="draft">черновик</option>
              <option value="active">активна</option>
              <option value="archive">архив</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Профиль стиля</label>
            <select className="select" defaultValue={1}>
              {SPSET.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </CardSet>

      <CardSet className="panel">
        <div className="panel-head">
          <h3>Модели</h3>
          <span className="cap mono faint">≈ $0,42 за главу</span>
        </div>
        <div className="settings-grid">
          {[
            { lbl: "Писатель",  def: "sonnet" },
            { lbl: "Сюжет",     def: "sonnet" },
            { lbl: "Критик",    def: "opus"   },
          ].map((m) => (
            <div key={m.lbl} className="field">
              <label className="field-label">{m.lbl}</label>
              <select className="select" defaultValue={m.def}>
                <option value="sonnet">sonnet</option>
                <option value="opus">opus</option>
              </select>
            </div>
          ))}
        </div>
      </CardSet>

      <CardSet className="panel">
        <div className="panel-head"><h3>Провайдер</h3></div>
        <div className="provider">
          <label className={`provider-card provider-card-active`}>
            <input type="radio" name="prov" defaultChecked />
            <div>
              <div className="strong">Anthropic</div>
              <div className="muted cap">Облачный writer/plot/critic. Подписка.</div>
            </div>
          </label>
          <label className="provider-card">
            <input type="radio" name="prov" />
            <div>
              <div className="strong">Ollama (локально)</div>
              <div className="muted cap">Локальный writer. Plot и Critic остаются на облаке.</div>
            </div>
          </label>
        </div>
      </CardSet>

      <CardSet className="panel panel-danger">
        <div className="panel-head"><h3 style={{ color: "var(--color-ink-red)" }}>Опасная зона</h3></div>
        <div className="danger-row">
          <div>
            <div className="strong">Удалить книгу</div>
            <div className="muted cap">Удаляются главы, профиль, разборы и канон. Восстановление невозможно.</div>
          </div>
          <BSet variant="destructive" iconLeft={<ISet.Trash />}>Удалить книгу</BSet>
        </div>
      </CardSet>
    </div>
  );
}

window.LW = Object.assign(window.LW, { SettingsStagePage });

})();
