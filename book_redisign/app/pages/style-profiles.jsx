(function(){
// app/pages/style-profiles.jsx — Style profiles list + detail
// app/pages/usage.jsx        — Usage / charts

const { STYLE_PROFILES: SP, STYLE_AXES, USAGE } = window.LW_DATA;
const { Button: BSP, Pill: PSP, I: ISP, Card: CardSP, Tabs: TabsSP } = window.LW;

/* ─── TraitChart — radar-ish parallel bars ─────────────── */

function TraitChart({ traits, large }) {
  const w = large ? 360 : 200;
  const h = large ? 220 : 110;
  const pad = 12;
  const innerH = h - pad * 2;
  const innerW = w - pad * 2;
  const step = innerW / (traits.length - 1);
  // path from points
  const points = traits.map((v, i) => [pad + i * step, pad + innerH - (v / 100) * innerH]);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]},${p[1]}`).join(" ");
  const len = 1000;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`trait-chart ${large ? "trait-chart-lg" : ""}`} aria-hidden="true">
      {[0, 25, 50, 75, 100].map((y, i) => (
        <line key={i} x1={pad} y1={pad + innerH - (y / 100) * innerH} x2={pad + innerW} y2={pad + innerH - (y / 100) * innerH}
              stroke="var(--color-border-soft)" strokeWidth="0.5" />
      ))}
      <path d={d} fill="none" stroke="var(--color-brass)" strokeWidth="1.4" strokeDasharray={len} strokeDashoffset={len}
            style={{ animation: `draw-line 800ms var(--ease-in-out) forwards` }} />
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--color-brass)" />
      ))}
      {large && STYLE_AXES.map((a, i) => (
        <text key={a} x={pad + i * step} y={h - 1} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)" fontFamily="var(--font-mono)">{a}</text>
      ))}
    </svg>
  );
}

function StyleProfilesListPage() {
  return (
    <div className="page page-styles">
      <div className="page-head">
        <div>
          <h1>Профили стиля</h1>
          <p className="muted page-sub">Голос, к которому возвращается писатель. Извлекаются из готового текста или собираются вручную.</p>
        </div>
        <BSP variant="primary" iconLeft={<ISP.Plus />}>Новый профиль</BSP>
      </div>

      <div className="style-grid">
        {SP.map((p) => (
          <a key={p.id} href={`#/style-profiles/${p.id}`} className="style-card">
            <div className="style-chart">
              <TraitChart traits={p.traits} />
            </div>
            <h2>{p.name}</h2>
            <div className="cap muted">{p.source}</div>
            <div className="style-foot">
              <span className="mono faint">используется в {p.usage} книг.</span>
              <span className="style-axes mono faint">{STYLE_AXES.join(" · ")}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function StyleProfilePage({ route }) {
  const p = SP.find((x) => x.id === route.profileId) || SP[0];
  return (
    <div className="page page-style">
      <div className="page-head">
        <a href="#/style-profiles" className="back-link mono">← Профили стиля</a>
        <div style={{ display: "flex", gap: 8 }}>
          <BSP variant="secondary" iconLeft={<ISP.Refresh />}>Переизвлечь</BSP>
          <BSP variant="primary">Сохранить</BSP>
        </div>
      </div>

      <div className="style-detail">
        <section className="style-edit">
          <CardSP paper>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field">
                <label className="field-label">Имя профиля</label>
                <input className="input input-lg input-display" defaultValue={p.name} />
              </div>
              <div className="field">
                <label className="field-label">Описание</label>
                <textarea className="textarea" rows={3} defaultValue="Тихий, плотный голос. Короткие фразы после длинных. Запахи и звуки как опора сцены." />
              </div>

              <div className="style-bigchart">
                <TraitChart traits={p.traits} large />
              </div>

              <div className="trait-sliders">
                {STYLE_AXES.map((a, i) => (
                  <div key={a} className="trait-row">
                    <span className="trait-name">{a}</span>
                    <div className="trait-slider"><div style={{ width: `${p.traits[i]}%` }} /></div>
                    <span className="trait-val mono">{p.traits[i]}</span>
                  </div>
                ))}
              </div>

              <div className="field">
                <label className="field-label">Примеры удачных фраз</label>
                <textarea className="textarea" rows={4} defaultValue={"«Канделябр у северной стены давно не зажигали.»\n«Через стену кто-то засмеялся коротким, скомканным смехом.»"} />
              </div>

              <div className="field">
                <label className="field-label">Избегать</label>
                <div className="tag-row">
                  {["«внутри неё что-то ёкнуло»", "клише «как будто»", "наречия на -о подряд", "пафосные сравнения"].map((t) => (
                    <span key={t} className="tag-chip">{t}<button aria-label="убрать">×</button></span>
                  ))}
                </div>
              </div>
            </div>
          </CardSP>
        </section>

        <aside className="style-samples">
          <CardSP className="panel">
            <div className="panel-head">
              <h3>Источник</h3>
              <span className="cap mono faint">3 фрагмента</span>
            </div>
            <ol className="sample-list">
              {[
                { ch: 1, q: "«Дом стоял на низкой холмистой ноге, а Залив отсюда не был виден — только слышен по запаху, который приходил с северным ветром.»" },
                { ch: 2, q: "«Бронзовый канделябр на столе у окна никогда не зажигали. Бабушка говорила: пусть стоит для тишины.»" },
                { ch: 3, q: "«Лина пересчитала свечи. Шесть. Это было важно — не пять, не семь. Шесть.»" },
              ].map((s) => (
                <li key={s.ch} className="sample-item">
                  <span className="cap mono faint">гл. {s.ch}</span>
                  <em className="sample-quote">{s.q}</em>
                </li>
              ))}
            </ol>
          </CardSP>
        </aside>
      </div>
    </div>
  );
}

/* ─── Usage page (custom SVG charts) ─────────────────────── */

function fmt(n) { return n.toLocaleString("ru-RU"); }
function deltaPill(d, asPct) {
  const up = d > 0;
  const v = asPct ? `${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}%` : (d > 0 ? "+" : "") + d;
  return <span className={`delta ${up ? "delta-up" : "delta-down"} mono`}>{up ? "▲" : "▼"} {v}</span>;
}

function BarChart({ data }) {
  const max = Math.max(...data.map((d) => d.tokens));
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div key={d.name} className="bar-row" style={{ "--c": d.color }}>
          <span className="bar-label mono">{d.name}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.tokens / max) * 100}%`, background: d.color }} />
          </div>
          <span className="bar-val mono">{fmt(d.tokens)}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ series }) {
  const w = 420, h = 180, pad = 22;
  const max = Math.max(...series.map((s) => s.usd)) * 1.1;
  const step = (w - pad * 2) / (series.length - 1);
  const pts = series.map((s, i) => [pad + i * step, h - pad - (s.usd / max) * (h - pad * 2)]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]},${p[1]}`).join(" ");
  const area = d + ` L ${pts[pts.length - 1][0]} ${h - pad} L ${pts[0][0]} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="line-chart">
      <defs>
        <linearGradient id="lg-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="var(--color-brass)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-brass)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={pad} x2={w - pad}
              y1={pad + ((h - pad * 2) / 3) * i} y2={pad + ((h - pad * 2) / 3) * i}
              stroke="var(--color-border-soft)" strokeWidth="0.5" />
      ))}
      <path d={area} fill="url(#lg-brass)" />
      <path d={d} fill="none" stroke="var(--color-brass)" strokeWidth="1.6"
            strokeDasharray={1000} strokeDashoffset={1000}
            style={{ animation: `draw-line 900ms var(--ease-in-out) forwards` }} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="var(--color-brass)" />
          <text x={p[0]} y={h - 6} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)" fontFamily="var(--font-mono)">{series[i].date}</text>
        </g>
      ))}
    </svg>
  );
}

function UsagePage() {
  const [range, setRange] = React.useState(USAGE.range);
  const [backend, setBackend] = React.useState("all");
  return (
    <div className="page page-usage">
      <div className="page-head">
        <div>
          <h1>Использование</h1>
          <p className="muted page-sub">Что писатели сегодня попросили у моделей.</p>
        </div>
        <div className="usage-filters">
          {["сегодня", "7д", "30д", "своё"].map((r) => (
            <button key={r} className={`pill pill-lg ${r === range ? "pill-brass" : ""}`} onClick={() => setRange(r)}>{r}</button>
          ))}
          <span className="sep">·</span>
          {["all", "api", "subscription"].map((b) => (
            <button key={b} className={`pill ${b === backend ? "pill-strong" : ""}`} onClick={() => setBackend(b)}>{b === "all" ? "все" : b}</button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <CardSP className="stat-card">
          <div className="cap-upper">Токены</div>
          <div className="stat-val mono">{fmt(USAGE.totals.tokens)}</div>
          <div className="stat-foot">{deltaPill(USAGE.totals.deltas.tokens, true)} <span className="cap faint">к прошлому периоду</span></div>
        </CardSP>
        <CardSP className="stat-card">
          <div className="cap-upper">Стоимость</div>
          <div className="stat-val mono">${USAGE.totals.costUsd.toFixed(2)}</div>
          <div className="stat-foot">{deltaPill(USAGE.totals.deltas.cost, true)} <span className="cap faint">к прошлому периоду</span></div>
        </CardSP>
        <CardSP className="stat-card">
          <div className="cap-upper">Сессии</div>
          <div className="stat-val mono">{USAGE.totals.sessions}</div>
          <div className="stat-foot">{deltaPill(USAGE.totals.deltas.sessions, true)} <span className="cap faint">к прошлому периоду</span></div>
        </CardSP>
      </div>

      <div className="chart-row">
        <CardSP className="panel">
          <div className="panel-head">
            <h3>Токены по агентам</h3>
            <span className="cap mono faint">за {range}</span>
          </div>
          <BarChart data={USAGE.byAgent} />
        </CardSP>
        <CardSP className="panel">
          <div className="panel-head">
            <h3>Стоимость по дням</h3>
            <span className="cap mono faint">USD</span>
          </div>
          <LineChart series={USAGE.series} />
        </CardSP>
      </div>

      <CardSP className="panel">
        <div className="panel-head">
          <h3>Журнал запросов</h3>
          <span className="cap mono faint">{USAGE.table.length} последних</span>
        </div>
        <div className="usage-table">
          <table>
            <thead>
              <tr>
                <th>Время</th><th>Агент</th><th>Бэкенд</th><th>Модель</th>
                <th className="num">In</th><th className="num">Out</th><th className="num">$</th><th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {USAGE.table.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.time}</td>
                  <td className="mono">{r.agent}</td>
                  <td><span className="pill">{r.backend}</span></td>
                  <td className="mono">{r.model}</td>
                  <td className="num mono">{fmt(r.in)}</td>
                  <td className="num mono">{fmt(r.out)}</td>
                  <td className="num mono">{r.cost.toFixed(2)}</td>
                  <td>{r.status === "ok" ? <PSP tone="green">ok</PSP> : <PSP tone="amber">отменён</PSP>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardSP>
    </div>
  );
}

window.LW = Object.assign(window.LW, { StyleProfilesListPage, StyleProfilePage, UsagePage, TraitChart, BarChart, LineChart });

})();
