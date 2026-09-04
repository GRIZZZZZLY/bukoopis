(function(){
// app/primitives.jsx — Library Warm primitives (Button, Card, Pill, Kbd, Tooltip, Tabs, ProgressBar, etc.)

const { useState, useRef, useEffect, useLayoutEffect, useId, createContext, useContext } = React;

const cn = (...xs) => xs.filter(Boolean).join(" ");

/* ─── Button ──────────────────────────────────────────────── */

function Button({ variant = "secondary", size = "md", as: As = "button", iconLeft, iconRight, loading, children, className, ...props }) {
  return (
    <As
      className={cn("btn", `btn-${variant}`, `btn-${size}`, loading && "btn-loading", className)}
      {...props}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : iconLeft}
      <span className="btn-label">{children}</span>
      {iconRight}
    </As>
  );
}

/* ─── Pill / Tag ──────────────────────────────────────────── */

function Pill({ tone = "muted", icon, children, className }) {
  return (
    <span className={cn("pill", `pill-${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}

/* ─── Kbd ─────────────────────────────────────────────────── */

function Kbd({ children }) { return <kbd className="kbd">{children}</kbd>; }

/* ─── Diagnostic dot ──────────────────────────────────────── */

function Dot({ tone = "muted", size = 6 }) {
  const c = { red: "var(--color-ink-red)", amber: "var(--color-ink-amber)", blue: "var(--color-ink-blue)", green: "var(--color-ink-green)", brass: "var(--color-brass)", muted: "var(--color-text-muted)" }[tone];
  return <span className="dot" style={{ width: size, height: size, background: c }} aria-hidden="true" />;
}

/* ─── Card ────────────────────────────────────────────────── */

function Card({ as: As = "div", interactive, paper, accent, className, children, ...props }) {
  return (
    <As className={cn("card", paper && "card-paper", interactive && "card-int", accent && "card-accent", className)} {...props}>
      {paper ? <div className="paper-grain card-inner">{children}</div> : children}
    </As>
  );
}

/* ─── ProgressBar ─────────────────────────────────────────── */

function ProgressBar({ value, max = 100, label, valueLabel }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="pbar-wrap">
      <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="pbar-fill" style={{ width: `${pct}%` }} />
      </div>
      {valueLabel && <span className="pbar-label cap tabular">{valueLabel}</span>}
    </div>
  );
}

/* ─── Tabs ────────────────────────────────────────────────── */

function Tabs({ value, onChange, options, className }) {
  return (
    <div role="tablist" className={cn("tabs", className)}>
      {options.map((o) => {
        const id = typeof o === "string" ? o : o.id;
        const label = typeof o === "string" ? o : o.label;
        const count = typeof o === "object" ? o.count : undefined;
        const active = id === value;
        return (
          <button key={id} role="tab" aria-selected={active} className={cn("tab", active && "tab-active")} onClick={() => onChange(id)}>
            {label}
            {count != null && <span className="tab-count tabular">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Tooltip ─────────────────────────────────────────────── */

function Tooltip({ label, kbd, side = "right", children }) {
  return (
    <span className="ttip-wrap" data-side={side}>
      {children}
      <span className="ttip mono" role="tooltip">
        {label}
        {kbd && <span className="ttip-kbd"><Kbd>{kbd}</Kbd></span>}
      </span>
    </span>
  );
}

/* ─── Skeleton ────────────────────────────────────────────── */

function Skeleton({ w = "100%", h = 16, r = 6, label }) {
  return (
    <span className="skel" style={{ width: typeof w === "number" ? `${w}px` : w, height: h, borderRadius: r }} role={label ? "status" : undefined}>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/* ─── Icons (inline SVG, no lucide dep) ───────────────────── */

const I = {
  Check:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>,
  Play:     (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><path d="M6 4l14 8-14 8z"/></svg>,
  Dot:      (p) => <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" {...p}><circle cx="12" cy="12" r="5"/></svg>,
  Skip:     (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="9 18 15 12 9 6"/></svg>,
  ArrowR:   (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  ArrowL:   (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  Plus:     (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Search:   (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Settings: (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Book:     (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  Books:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h4v16H4z"/><path d="M9 4h4v16H9z"/><path d="m15 5 4 1-3 14-4-1z"/></svg>,
  Feather:  (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>,
  Sparkles: (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m12 3-1.9 5.7L4 10l6 1.5L12 17l1.9-5.4L20 10l-6.1-1.3z"/><path d="M19 17v3"/><path d="M17.5 18.5h3"/></svg>,
  Grip:     (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>,
  More:     (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...p}><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>,
  Chart:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Compass:  (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  Map:      (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Users:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Box:      (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Stack:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Globe:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Quill:    (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 21c3-1 6-3 8-5l9-9a3 3 0 0 0-4-4l-9 9c-2 2-4 5-5 8z"/><path d="M14 4l6 6"/></svg>,
  Eye:      (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  X:        (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Refresh:  (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Bookmark: (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
  Spark:    (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>,
  Edit:     (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>,
  Trash:    (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  Wand:     (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>,
};

window.LW = Object.assign(window.LW || {}, {
  cn, Button, Pill, Kbd, Dot, Card, ProgressBar, Tabs, Tooltip, Skeleton, I,
});

})();
