// Shared shell + primitive components for Library Warm.
// All components are React function components attached to window.
// Loaded as a Babel script.

const { useState, useEffect, useRef, useMemo } = React;

// --------------------------------------------------
// Icons (inline SVG, 16px)
// --------------------------------------------------
const Icon = ({ name, size = 16, stroke = 1.5, style }) => {
  const paths = {
    book: "M4 4h12v16H4zM7 4v16",
    plus: "M10 4v12M4 10h12",
    search: "M9 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm5-2 4 4",
    chev: "M6 8l4 4 4-4",
    chevR: "M8 6l4 4-4 4",
    cmd: "M6 3a3 3 0 1 1 0 6h12a3 3 0 1 1 0 6H6a3 3 0 1 1 0-6h12a3 3 0 1 1 0 6",
    sparkle: "M10 3l1.8 4.2L16 9l-4.2 1.8L10 15l-1.8-4.2L4 9l4.2-1.8L10 3z",
    x: "M5 5l10 10M15 5L5 15",
    check: "M4 10l4 4 8-8",
    dots: "M5 10h.01M10 10h.01M15 10h.01",
    clock: "M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM10 7v3l2 2",
    pen: "M3 17l4-1 9-9-3-3-9 9-1 4zM12 5l3 3",
    settings: "M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM10 2v2M10 16v2M2 10h2M16 10h2M4 4l1.5 1.5M14.5 14.5L16 16M16 4l-1.5 1.5M5.5 14.5L4 16",
    chart: "M3 17h14M5 14V8M9 14V5M13 14v-3M17 14V9",
    library: "M3 4h2v14H3zM7 4h2v14H7zM12 4l4 14 1.8-.5L13.8 3.5z",
    feather: "M16 4c-6 0-12 4-12 11v1l4-4h6c2 0 4-2 4-4M4 16l8-8",
    globe: "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM2 10h16M10 2c2.5 3 2.5 13 0 16M10 2c-2.5 3-2.5 13 0 16",
    grip: "M7 5h.01M7 10h.01M7 15h.01M13 5h.01M13 10h.01M13 15h.01",
    sun: "M10 4V2M10 18v-2M4 10H2M18 10h-2M5 5L3.5 3.5M16.5 16.5L15 15M5 15l-1.5 1.5M16.5 3.5L15 5M10 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    download: "M10 3v10M5 9l5 4 5-4M3 17h14",
    upload: "M10 17V7M5 11l5-4 5 4M3 3h14",
    arrow: "M4 10h12M12 6l4 4-4 4",
    trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
    bookmark: "M5 3h10v15l-5-3-5 3z",
    quote: "M5 7v3a3 3 0 0 0 3 3M13 7v3a3 3 0 0 0 3 3",
    folder: "M3 5h5l2 2h7v9H3z",
    eye: "M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
    filter: "M3 5h14M5 10h10M8 15h4",
    undo: "M6 7L3 10l3 3M3 10h9a4 4 0 0 1 0 8H8",
  };
  const d = paths[name] || paths.book;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={style}>
      <path d={d} />
    </svg>
  );
};

// --------------------------------------------------
// Buttons / pills / kbd
// --------------------------------------------------
const Btn = ({ variant = "secondary", size = "md", children, icon, iconRight, onClick, disabled, style }) => (
  <button className="lw-btn" data-variant={variant} data-size={size} onClick={onClick} disabled={disabled} style={style}>
    {icon && <Icon name={icon} />}
    {children}
    {iconRight && <Icon name={iconRight} />}
  </button>
);

const Pill = ({ tone, children, icon, style }) => (
  <span className="lw-pill" data-tone={tone} style={style}>
    {icon && <Icon name={icon} size={11} />}
    {children}
  </span>
);

const Kbd = ({ children }) => <span className="lw-kbd">{children}</span>;
const Dot = ({ tone, style }) => <span className="lw-dot" data-tone={tone} style={style} />;
const Mono = ({ children, style }) => <span className="lw-mono" style={style}>{children}</span>;

// --------------------------------------------------
// TopBar / LeftRail / StatusBar
// --------------------------------------------------
const TopBar = ({ crumbs = [], center, right }) => (
  <div className="lw-topbar">
    <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
      <div className="lw-display" style={{ fontSize: 18, color: "var(--brass)", letterSpacing: "0.01em" }}>Bookopis</div>
      <div className="lw-crumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {c.bold ? <b>{c.label}</b> : <span>{c.label}</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
    <div style={{ flex: 1, display: "flex", justifyContent: "center", color: "var(--text)" }}>
      {center}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto", color: "var(--text-muted)" }}>
      {right || (
        <>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <Kbd>⌘K</Kbd>
            <span>команды</span>
          </span>
          <Pill icon="feather">Тёплый рассказчик</Pill>
          <a className="lw-link" style={{ fontSize: 13 }}>Использование</a>
          <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--surface-3)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--brass)", fontSize: 12, fontWeight: 600 }}>А</div>
        </>
      )}
    </div>
  </div>
);

const LeftRail = ({ active = "books" }) => {
  const items = [
    { id: "books",   icon: "library",  label: "Книги" },
    { id: "current", icon: "book",     label: "Текущая" },
    { id: "style",   icon: "feather",  label: "Стиль" },
    { id: "usage",   icon: "chart",    label: "Использование" },
    { id: "settings",icon: "settings", label: "Настройки" },
  ];
  return (
    <div className="lw-leftrail">
      {items.map(it => (
        <button key={it.id} className="lw-railbtn" data-active={active === it.id} title={it.label}>
          <Icon name={it.icon} size={18} />
        </button>
      ))}
    </div>
  );
};

const StatusBar = ({ tokens = "12 480", agent = "writer", backend = "api", cost = "$0.18", net = "online", extra }) => (
  <div className="lw-statusbar">
    <span><Mono>{tokens}</Mono> tok / сессия</span>
    <span style={{ color: "var(--text-faint)" }}>·</span>
    <span>backend: <Mono style={{ color: "var(--brass)" }}>{backend}</Mono></span>
    <span style={{ color: "var(--text-faint)" }}>·</span>
    <span>агент: <Mono style={{ color: "var(--text-muted)" }}>{agent}</Mono></span>
    <span style={{ color: "var(--text-faint)" }}>·</span>
    <span><Mono>{cost}</Mono></span>
    <span style={{ flex: 1 }} />
    {extra}
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Dot tone={net === "online" ? "green" : "amber"} />
      {net}
    </span>
    <span style={{ color: "var(--text-faint)" }}>·</span>
    <span>Сохранено · только что</span>
  </div>
);

// --------------------------------------------------
// Tabs
// --------------------------------------------------
const Tabs = ({ items, active, onChange }) => (
  <div className="lw-tabs" role="tablist">
    {items.map(it => (
      <button key={it.id} role="tab"
        className="lw-tab" data-active={it.id === active}
        onClick={() => onChange?.(it.id)}>
        {it.label}
      </button>
    ))}
  </div>
);

// --------------------------------------------------
// Skeleton
// --------------------------------------------------
const Skel = ({ w = "100%", h = 12, r = 6, style }) => (
  <div className="lw-skel" style={{ width: w, height: h, borderRadius: r, ...style }} />
);

// --------------------------------------------------
// Card
// --------------------------------------------------
const Card = ({ children, style, padding = 16 }) => (
  <div className="lw-card" style={{ padding, ...style }}>{children}</div>
);

// --------------------------------------------------
// Trait radar (stylized)
// --------------------------------------------------
const Radar = ({ values = [70, 60, 80, 55, 65, 75], size = 140, labels }) => {
  const cx = size / 2, cy = size / 2, r = size / 2 - 14;
  const n = values.length;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (r * v) / 100;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  const grid = [25, 50, 75, 100].map(g => {
    const pts = Array.from({length: n}, (_, i) => pt(i, g));
    return pts.map((p,i) => `${i===0?'M':'L'}${p[0]},${p[1]}`).join(" ") + "Z";
  });
  const poly = values.map((v,i) => pt(i, v)).map((p,i) => `${i===0?'M':'L'}${p[0]},${p[1]}`).join(" ") + "Z";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {grid.map((d,i) => <path key={i} d={d} className="lw-radar-grid" opacity={0.4 + i*0.1} />)}
      {Array.from({length: n}, (_, i) => {
        const [x,y] = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="lw-radar-axis" />;
      })}
      <path d={poly} className="lw-radar-stroke" />
      {labels && labels.map((l, i) => {
        const [x,y] = pt(i, 118);
        return <text key={i} x={x} y={y} fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-ui)" textAnchor="middle" dominantBaseline="middle">{l}</text>;
      })}
    </svg>
  );
};

Object.assign(window, { Icon, Btn, Pill, Kbd, Dot, Mono, TopBar, LeftRail, StatusBar, Tabs, Skel, Card, Radar });
