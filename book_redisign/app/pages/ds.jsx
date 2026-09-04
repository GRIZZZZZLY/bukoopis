(function(){
// app/pages/ds.jsx — Design System showcase (Phase 0 deliverable)

const { Button: BDS, Pill: PDS, Kbd: KDS, Dot: DDS, Card: CardDS, ProgressBar: PrDS, Tabs: TabsDS, Tooltip: TtDS, Skeleton: SkDS, I: IDS, StageCard: SCDS, StageStepper: SSDS } = window.LW;
const { STAGES: DSS, BOOKS: DSB } = window.LW_DATA;

function Swatch({ name, val, fg = "var(--color-text)" }) {
  return (
    <div className="swatch">
      <div className="swatch-chip" style={{ background: `var(--color-${name})`, color: fg }}>
        <span className="mono">--color-{name}</span>
      </div>
      <div className="swatch-meta mono faint">{val}</div>
    </div>
  );
}

function DSSection({ title, kicker, children }) {
  return (
    <section className="ds-section">
      <div className="ds-section-head">
        <div className="cap-upper">{kicker}</div>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DesignSystemPage() {
  const [tab, setTab] = React.useState("Все");
  return (
    <div className="page page-ds">
      <div className="ds-hero paper-grain">
        <div className="ds-hero-mark mono">Phase 0 · Library Warm</div>
        <h1 className="ds-hero-title">Дизайн-система <em>Bookopis</em></h1>
        <p className="ds-hero-sub muted">
          Тёмная, тёплая, ламповая. Espresso-поверхности, латунные акценты, красные чернила правок. Один уровень яркости, никаких переключателей.
        </p>
        <div className="ds-hero-row">
          <PDS tone="brass" icon={<IDS.Sparkles />}>Dark-only</PDS>
          <PDS>Tailwind v4 · @theme</PDS>
          <PDS>CSS motion only</PDS>
          <PDS>Self-hosted fonts</PDS>
        </div>
      </div>

      <DSSection kicker="Phase 0 · 3.1" title="Цветовые токены">
        <div className="ds-swatch-grid">
          <Swatch name="bg" val="#1A1410 · espresso" />
          <Swatch name="surface-1" val="#221A14 · карточки" />
          <Swatch name="surface-2" val="#2B2118 · бумага" />
          <Swatch name="surface-3" val="#342719 · hover" />
          <Swatch name="brass" val="#D49A4E · акцент" fg="#1A1410" />
          <Swatch name="brass-soft" val="#B07F33 · border" fg="#1A1410" />
          <Swatch name="ink-red" val="#C44536 · удаления" />
          <Swatch name="ink-green" val="#6A8E4E · добавления" />
          <Swatch name="ink-amber" val="#C9A24A · ожидание" />
          <Swatch name="ink-blue" val="#5B7A99 · цитаты" />
          <Swatch name="text-strong" val="#FBF5E6 · заголовки" fg="#1A1410" />
          <Swatch name="text-muted" val="#9C8B73 · метки" />
        </div>
      </DSSection>

      <DSSection kicker="3.2" title="Типографика">
        <div className="ds-type">
          <div className="ds-type-row">
            <div className="ds-type-spec mono">
              <div>Fraunces · 32 / 1.2</div>
              <div className="faint">display, optical-size 36</div>
            </div>
            <div className="ds-type-sample" style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.1, color: "var(--color-text-strong)" }}>
              Канделябр у северной стены
            </div>
          </div>
          <div className="ds-type-row">
            <div className="ds-type-spec mono">
              <div>Lora · 18 / 1.75</div>
              <div className="faint">manuscript prose</div>
            </div>
            <p className="ds-type-sample" style={{ fontFamily: "var(--font-prose)", fontSize: 18, lineHeight: 1.75 }}>
              В ту ночь дом дышал ровнее, чем обычно. Лина слышала, как половицы поскрипывают под собственным весом, и не понимала — то ли это ветер.
            </p>
          </div>
          <div className="ds-type-row">
            <div className="ds-type-spec mono">
              <div>Inter · 14 / 1.5</div>
              <div className="faint">UI body · ss01, cv05</div>
            </div>
            <div className="ds-type-sample" style={{ fontFamily: "var(--font-ui)", fontSize: 14 }}>
              «Готово 5/7 · далее: Сюжет» — обычный текст панелей, списков, форм.
            </div>
          </div>
          <div className="ds-type-row">
            <div className="ds-type-spec mono">
              <div>JetBrains Mono · 12</div>
              <div className="faint">токены, идентификаторы, цены</div>
            </div>
            <div className="ds-type-sample mono" style={{ fontSize: 12 }}>
              writer · sonnet · in 4 210 / out 1 820 · $0.27 · ok
            </div>
          </div>
        </div>
      </DSSection>

      <DSSection kicker="3.3" title="Радиусы, тени, фокус">
        <div className="ds-radii">
          {[{ r: 6, l: "control" }, { r: 10, l: "card" }, { r: 14, l: "panel" }, { r: 20, l: "shell" }].map((x) => (
            <div key={x.l} className="ds-radius">
              <div style={{ borderRadius: x.r }} />
              <span className="cap mono">{x.r}px · {x.l}</span>
            </div>
          ))}
        </div>
        <div className="ds-shadows">
          <div className="ds-shadow" style={{ boxShadow: "var(--shadow-sm)" }}><span className="cap mono">shadow-sm</span></div>
          <div className="ds-shadow" style={{ boxShadow: "var(--shadow-md)" }}><span className="cap mono">shadow-md</span></div>
          <div className="ds-shadow" style={{ boxShadow: "var(--shadow-lg)" }}><span className="cap mono">shadow-lg</span></div>
          <div className="ds-shadow ds-shadow-focus"><span className="cap mono">focus ring</span></div>
        </div>
      </DSSection>

      <DSSection kicker="3.4" title="Движение">
        <div className="ds-motion">
          {[
            { t: "--motion-1", v: "80ms",  d: "hover / caret" },
            { t: "--motion-2", v: "160ms", d: "tooltips, tabs" },
            { t: "--motion-3", v: "200ms", d: "panels, progress" },
            { t: "--motion-4", v: "320ms", d: "chapter open, drop-cap" },
          ].map((x) => (
            <div key={x.t} className="ds-motion-row">
              <span className="mono">{x.t}</span>
              <span className="mono faint">{x.v}</span>
              <span className="muted">{x.d}</span>
              <span className="ds-motion-demo"><span className="ds-motion-pulse" /></span>
            </div>
          ))}
        </div>
      </DSSection>

      <DSSection kicker="4.1" title="Buttons">
        <div className="ds-btn-row">
          <BDS variant="primary" iconLeft={<IDS.Sparkles />}>Сгенерировать</BDS>
          <BDS variant="primary" loading>Streaming…</BDS>
          <BDS variant="secondary">Действие</BDS>
          <BDS variant="ghost">Тихая кнопка</BDS>
          <BDS variant="destructive" iconLeft={<IDS.Trash />}>Удалить</BDS>
          <BDS variant="link">Подробнее →</BDS>
        </div>
        <div className="ds-btn-row">
          <BDS size="sm" variant="primary">sm</BDS>
          <BDS size="md" variant="primary">md</BDS>
          <BDS size="lg" variant="primary">lg</BDS>
        </div>
      </DSSection>

      <DSSection kicker="4.2" title="Pills, Kbd, Dots">
        <div className="ds-pill-row">
          <PDS tone="brass" icon={<IDS.Quill />}>акцент</PDS>
          <PDS tone="green" icon={<IDS.Check />}>принято</PDS>
          <PDS tone="amber">черновик</PDS>
          <PDS tone="red">удалено</PDS>
          <PDS tone="blue">цитата</PDS>
          <PDS>нейтрально</PDS>
          <PDS className="pill-mono">writer · sonnet</PDS>
          <span style={{ display: "inline-flex", gap: 4 }}>
            <KDS>⌘</KDS><KDS>K</KDS>
          </span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <DDS tone="red" /> ошибка <DDS tone="amber" /> внимание <DDS tone="blue" /> заметка
          </span>
        </div>
      </DSSection>

      <DSSection kicker="4.3" title="Tabs, ProgressBar, Tooltip, Skeleton">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TabsDS value={tab} onChange={setTab} options={[
            { id: "Все",   label: "Все",   count: 5 },
            { id: "Сюжет", label: "Сюжет", count: 2 },
            { id: "Стиль", label: "Стиль", count: 1 },
            { id: "Канон", label: "Канон", count: 1 },
            { id: "Факты", label: "Факты", count: 1 },
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 280 }}>
              <PrDS value={5} max={7} label="Прогресс книги" valueLabel="5/7" />
            </div>
            <TtDS label="Команды" kbd="⌘K" side="top">
              <BDS variant="secondary" size="sm" iconLeft={<IDS.Search />}>Hover me</BDS>
            </TtDS>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <SkDS w={160} h={14} /> <SkDS w={80} h={14} /> <SkDS w={220} h={14} />
          </div>
        </div>
      </DSSection>

      <DSSection kicker="4.4" title="Cards">
        <div className="ds-card-row">
          <CardDS>
            <h3>Обычная карточка</h3>
            <p className="muted">Surface-1 на фоне bg. Hover поднимает на surface-2 и даёт shadow-md.</p>
          </CardDS>
          <CardDS paper>
            <h3>Бумажная карточка</h3>
            <p className="muted">Surface-2 + paper-grain. Для манускрипта и для карточек с цитатами.</p>
          </CardDS>
          <CardDS accent>
            <h3>Рекомендованная</h3>
            <p className="muted">Латунный бордюр + glow. Используется для текущего этапа и «Продолжить».</p>
          </CardDS>
        </div>
      </DSSection>

      <DSSection kicker="StageStepper · StageCard" title="Этапы пайплайна">
        <SSDS bookId={1} stages={DSB[0].stages} activeStageId="plot" />
        <div className="stagecard-grid" style={{ marginTop: 14 }}>
          {DSS.slice(0, 4).map((s, i) => (
            <SCDS key={s.id} stageId={s.id} label={s.label} icon={s.icon}
                  status={["complete","in_progress","todo","skipped"][i]}
                  recommended={i === 1}
                  href="#/ds"
                  count={[6,5,3,0][i]} />
          ))}
        </div>
      </DSSection>

      <DSSection kicker="Inline" title="Чернила правок">
        <CardDS paper>
          <div style={{ fontFamily: "var(--font-prose)", fontSize: 18, lineHeight: 1.75 }}>
            За дверью пахло солью и сухими розами, и этот запах не оставлял дом никогда — даже летом, даже когда море пряталось за{" "}
            <span className="diff-del"><s>двадцатью</s></span>
            <span className="diff-add"> семью </span>
            километрами полей.
          </div>
        </CardDS>
      </DSSection>
    </div>
  );
}

window.LW = Object.assign(window.LW, { DesignSystemPage });

})();
