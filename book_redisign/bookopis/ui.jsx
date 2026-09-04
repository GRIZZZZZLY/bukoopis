/* global React */
// UI primitives — Library Warm
const { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } = React;

// ───────────────────────────────────────────────
// Icons (inline SVG, lucide-style)
// ───────────────────────────────────────────────
const Icon = ({ d, size = 16, sw = 1.6, style, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}
       fill="none" stroke="currentColor" strokeWidth={sw}
       strokeLinecap="round" strokeLinejoin="round"
       style={style} {...rest}>{d}</svg>
);
const I = {
  book:     <path d="M4 4v16h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4z M4 4v14a2 2 0 0 1 2 2"/>,
  books:    <><path d="M4 4h4v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M16 6l3.8.8 2.6 14.4-3.8.8z"/></>,
  pen:      <path d="M14 4l6 6L8 22H2v-6L14 4z"/>,
  feather:  <><path d="M20 4L8 16l-4 4 4-4 8-8c2-2 4-2 4 0 0 4-4 8-8 8H4"/><path d="M16 8h-4"/></>,
  scroll:   <><path d="M4 5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><path d="M19 8v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"/><path d="M8 12h7M8 16h5"/></>,
  layers:   <><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></>,
  users:    <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="9" r="2.5"/><path d="M21 21v-2a3 3 0 0 0-2-2.8"/></>,
  cube:     <><path d="M12 3l9 5v8l-9 5-9-5V8l9-5z"/><path d="M3 8l9 5 9-5M12 13v10"/></>,
  map:      <><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></>,
  list:     <><path d="M4 6h16M4 12h16M4 18h10"/></>,
  cog:      <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/></>,
  chart:    <><path d="M4 20V8M10 20V4M16 20v-8M22 20H2"/></>,
  search:   <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></>,
  plus:     <><path d="M12 5v14M5 12h14"/></>,
  more:     <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  arrow:    <><path d="M5 12h14M13 5l7 7-7 7"/></>,
  arrowL:   <><path d="M19 12H5M11 19l-7-7 7-7"/></>,
  check:    <path d="M5 12l5 5L20 7"/>,
  x:        <><path d="M6 6l12 12M18 6L6 18"/></>,
  warn:     <><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18v.01"/></>,
  info:     <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v4h1"/></>,
  spark:    <><path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7z"/></>,
  grip:     <><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></>,
  panel:    <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  panelR:   <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
  cmd:      <><path d="M9 7a2 2 0 1 1-2 2h10a2 2 0 1 1-2 2v-4a2 2 0 1 1 2-2H7a2 2 0 1 1 2 2v8a2 2 0 1 1-2 2"/></>,
  download: <><path d="M12 3v12M6 11l6 6 6-6M4 21h16"/></>,
  upload:   <><path d="M12 21V9M6 13l6-6 6 6M4 3h16"/></>,
  eye:      <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  pause:    <><rect x="6" y="5" width="3.5" height="14"/><rect x="14.5" y="5" width="3.5" height="14"/></>,
  play:     <path d="M7 5l12 7-12 7V5z"/>,
  sliders:  <><path d="M4 6h13M20 6h0M4 12h7M14 12h6M4 18h11M18 18h2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3z"/>,
};

// ───────────────────────────────────────────────
// Buttons
// ───────────────────────────────────────────────
const Button = ({ variant = "secondary", size = "md", icon, iconRight, children, className = "", ...rest }) => {
  const cls = `btn btn-${variant}${size !== "md" ? ` btn-${size}` : ""} ${className}`;
  return (
    <button className={cls} {...rest}>
      {icon && <Icon d={icon} size={size === "sm" ? 14 : 16}/>}
      {children}
      {iconRight && <Icon d={iconRight} size={size === "sm" ? 14 : 16}/>}
    </button>
  );
};

const IconBtn = ({ icon, label, onClick, className = "", size = 16 }) => (
  <button
    className={`btn btn-ghost btn-sm ${className}`}
    aria-label={label}
    onClick={onClick}
    style={{ width: 32, height: 32, padding: 0 }}>
    <Icon d={icon} size={size}/>
  </button>
);

// ───────────────────────────────────────────────
// Pill / Kbd / Tooltip
// ───────────────────────────────────────────────
const Pill = ({ tone = "muted", dot, children, mono, agent, className = "" }) => {
  const toneClass = agent ? "pill-agent" : tone === "muted" ? "" : `pill-${tone}`;
  return (
    <span className={`pill ${toneClass} ${className}`} style={mono ? { fontFamily: "var(--font-mono)" } : null}>
      {dot && <span className="dot" style={{ background: "currentColor" }}/>}
      {children}
    </span>
  );
};

const Kbd = ({ children }) => <span className="kbd">{children}</span>;

const Tooltip = ({ label, kbd, children, side = "top" }) => (
  <span className="tooltip-host" style={{ display: "inline-flex" }}>
    {children}
    <span className="tt">
      {label}{kbd ? <span style={{ marginLeft: 8, opacity: 0.7 }}>{kbd}</span> : null}
    </span>
  </span>
);

// ───────────────────────────────────────────────
// Progress
// ───────────────────────────────────────────────
const Progress = ({ value, max = 100, label }) => (
  <div className="progress"
       role="progressbar"
       aria-valuemin="0"
       aria-valuemax={max}
       aria-valuenow={value}
       aria-label={label}>
    <div className="fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }}/>
  </div>
);

// ───────────────────────────────────────────────
// Tabs
// ───────────────────────────────────────────────
const Tabs = ({ value, onChange, tabs }) => (
  <div className="tabs" role="tablist">
    {tabs.map(t => (
      <div key={t.id}
           role="tab"
           aria-selected={value === t.id}
           tabIndex={0}
           className={`tab ${value === t.id ? "active" : ""}`}
           onClick={() => onChange(t.id)}>
        {t.label}
        {t.badge != null && (
          <span className="font-mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--color-text-faint)" }}>
            {t.badge}
          </span>
        )}
      </div>
    ))}
  </div>
);

// ───────────────────────────────────────────────
// Skeleton
// ───────────────────────────────────────────────
const Skel = ({ w, h = 12, rounded = 4, style }) => (
  <div className="skel" style={{ width: w, height: h, borderRadius: rounded, ...style }}/>
);

// ───────────────────────────────────────────────
// Card
// ───────────────────────────────────────────────
const Card = ({ children, hoverable, onClick, className = "", style }) => (
  <div className={`card ${hoverable ? "hoverable" : ""} ${className}`} onClick={onClick} style={style}>
    {children}
  </div>
);

// ───────────────────────────────────────────────
// Severity dot
// ───────────────────────────────────────────────
const SevDot = ({ tone = "amber", size = 8 }) => (
  <span className={`sev-${tone}`} style={{
    display: "inline-block",
    width: size, height: size,
    borderRadius: "50%",
    flexShrink: 0,
  }}/>
);

// ───────────────────────────────────────────────
// Stage definitions (shared across screens)
// ───────────────────────────────────────────────
const STAGES = [
  { id: "concept",    label: "Концепт",   icon: I.spark },
  { id: "world",      label: "Мир",       icon: I.map },
  { id: "lore",       label: "Лор",       icon: I.scroll },
  { id: "characters", label: "Персонажи", icon: I.users },
  { id: "items",      label: "Предметы",  icon: I.cube },
  { id: "plot",       label: "Сюжет",     icon: I.layers },
  { id: "chapters",   label: "Главы",     icon: I.list },
];

// Status: done | current | todo | skipped
const StageStepper = ({ activeStageId, statuses = {}, onNavigate }) => {
  const doneCount = STAGES.filter(s => statuses[s.id] === "done").length;
  return (
    <nav className="stepper" aria-label="Прогресс книги">
      {STAGES.map((s, idx) => {
        const status = activeStageId === s.id ? "current" : (statuses[s.id] || "todo");
        const glyph = status === "done"    ? "✓"
                    : status === "current" ? "▶"
                    : status === "skipped" ? "↷"
                    : "●";
        return (
          <div
            key={s.id}
            className={`stepper-seg ${status}`}
            aria-current={status === "current" ? "step" : undefined}
            onClick={() => onNavigate && onNavigate(s.id)}>
            <span className="glyph">{glyph}</span>
            <span className="ord">{String(idx + 1).padStart(2, "0")}</span>
            <span>{s.label}</span>
          </div>
        );
      })}
      <span className="stepper-counter">{doneCount}/7</span>
    </nav>
  );
};

// ───────────────────────────────────────────────
// Toast helpers (lightweight)
// ───────────────────────────────────────────────
const ToastContext = createContext(null);
const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, ...opts }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), opts.duration || 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone ? "toast-" + t.tone : ""}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
const useToast = () => useContext(ToastContext);

// ───────────────────────────────────────────────
// Router (hash-based, local)
// ───────────────────────────────────────────────
const RouterContext = createContext(null);
const useRoute = () => useContext(RouterContext);

const parseHash = (hash) => {
  const path = (hash || "").replace(/^#/, "") || "/books";
  return path;
};

const RouterProvider = ({ children }) => {
  const [path, setPath] = useState(parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setPath(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((to) => {
    window.location.hash = to;
  }, []);
  return (
    <RouterContext.Provider value={{ path, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

// Match like /books/:id/studio/:stage
const matchRoute = (path, pattern) => {
  const pp = pattern.split("/").filter(Boolean);
  const tp = path.split("/").filter(Boolean);
  if (pp.length !== tp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = tp[i];
    else if (pp[i] !== tp[i]) return null;
  }
  return params;
};

Object.assign(window, {
  React,
  Icon, I, Button, IconBtn, Pill, Kbd, Tooltip, Progress, Tabs, Skel, Card, SevDot,
  STAGES, StageStepper,
  ToastProvider, useToast,
  RouterProvider, useRoute, matchRoute, parseHash,
});
