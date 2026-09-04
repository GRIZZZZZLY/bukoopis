(function(){
// app/app.jsx — Main app: wires shell + routes + tweaks panel

const { useState: us, useEffect: ue, useRef: ur } = React;
const {
  useHashRoute, TopBar, LeftRail, StatusBar,
  BooksListPage, StudioPage, ChapterPage,
  MarkdownStagePage, EntityStagePage, ChaptersStagePage,
  SettingsStagePage, StyleProfilesListPage, StyleProfilePage,
  UsagePage, DesignSystemPage, NotFound,
} = window.LW;

/* ─── Tweaks defaults — variant presets ──────────────────── */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "balanced",
  "brassHue": "#D49A4E",
  "grain": 0.5,
  "fontPair": "fraunces-lora",
  "rails": "both",
  "focusMode": false
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  "fraunces-lora": { display: '"Fraunces", ui-serif, Georgia, serif', prose: '"Lora", ui-serif, Georgia, serif', label: "Fraunces + Lora" },
  "playfair-source": { display: '"Playfair Display", ui-serif, Georgia, serif', prose: '"Source Serif 4", ui-serif, Georgia, serif', label: "Playfair + Source" },
  "newsreader-crimson": { display: '"Newsreader", ui-serif, Georgia, serif', prose: '"Crimson Pro", ui-serif, Georgia, serif', label: "Newsreader + Crimson" },
  "spectral-eb": { display: '"Spectral", ui-serif, Georgia, serif', prose: '"EB Garamond", ui-serif, Georgia, serif', label: "Spectral + EB Garamond" },
};

const VARIANT_PRESETS = {
  warm:       { brassHue: "#E1A858", grain: 0.75, label: "Warm · насыщенный" },
  balanced:   { brassHue: "#D49A4E", grain: 0.50, label: "Balanced · по умолчанию" },
  restrained: { brassHue: "#B07F33", grain: 0.20, label: "Restrained · холодный" },
};

function applyVariant(set, key) {
  const v = VARIANT_PRESETS[key];
  if (!v) return;
  set({ variant: key, brassHue: v.brassHue, grain: v.grain });
}

/* ─── App ─────────────────────────────────────────────────── */

function App() {
  const [route] = useHashRoute();
  const [scrolled, setScrolled] = us(false);
  const [leftExpanded, setLeftExpanded] = us(() => localStorage.getItem("lw.leftExp") === "true");
  const [rightCollapsed, setRightCollapsed] = us(false);
  const [leftCollapsed, setLeftCollapsed] = us(false);
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // apply font + brass tweak as CSS vars on :root
  ue(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-brass", t.brassHue);
    // recompute brass derivatives
    root.style.setProperty("--color-brass-tint", hexA(t.brassHue, 0.10));
    root.style.setProperty("--color-brass-glow", hexA(t.brassHue, 0.18));
    root.style.setProperty("--color-brass-soft", shade(t.brassHue, -16));
    root.style.setProperty("--color-brass-hi",   shade(t.brassHue, +12));
    root.style.setProperty("--grain-opacity", t.grain);
    const fp = FONT_PAIRS[t.fontPair] || FONT_PAIRS["fraunces-lora"];
    root.style.setProperty("--font-display", fp.display);
    root.style.setProperty("--font-prose",   fp.prose);
  }, [t.brassHue, t.grain, t.fontPair]);

  // scroll detection on main
  ue(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  ue(() => { localStorage.setItem("lw.leftExp", leftExpanded ? "true" : "false"); }, [leftExpanded]);

  // rails layout
  const railsMode = t.rails;
  ue(() => {
    if (railsMode === "manuscript-only") { setLeftCollapsed(true); setRightCollapsed(true); }
    else if (railsMode === "critique-only") { setLeftCollapsed(true); setRightCollapsed(false); }
    else if (railsMode === "outline-only") { setLeftCollapsed(false); setRightCollapsed(true); }
    else { setLeftCollapsed(false); setRightCollapsed(false); }
  }, [railsMode]);

  // keyboard shortcuts
  ue(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "/")        { e.preventDefault(); setRightCollapsed((v) => !v); }
      else if (meta && e.key === "\\") { e.preventDefault(); setLeftExpanded((v) => !v); }
      else if (meta && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setTweak("focusMode", !t.focusMode); }
      else if (e.key === "Escape" && t.focusMode) { setTweak("focusMode", false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t.focusMode]);

  return (
    <div className="app" data-focus={t.focusMode ? "true" : "false"}>
      <TopBar route={route} scrolled={scrolled} focusMode={t.focusMode} />
      <LeftRail route={route} expanded={leftExpanded} onToggle={() => setLeftExpanded((v) => !v)} focusMode={t.focusMode} />
      <main className="main">
        <div className="route" key={JSON.stringify(route)}>
          <Router route={route}
                  rightCollapsed={rightCollapsed} leftCollapsed={leftCollapsed}
                  focusMode={t.focusMode}
                  onToggleRight={() => setRightCollapsed((v) => !v)} />
        </div>
      </main>
      <StatusBar route={route} focusMode={t.focusMode} />

      <TweaksUI t={t} setTweak={setTweak} />
    </div>
  );
}

function Router({ route, rightCollapsed, leftCollapsed, focusMode, onToggleRight }) {
  if (route.name === "ds")             return <DesignSystemPage />;
  if (route.name === "books")          return <BooksListPage />;
  if (route.name === "studio") {
    const stage = route.stage;
    if (!stage)                                  return <StudioPage route={route} />;
    if (stage === "world" || stage === "lore" || stage === "plot")        return <MarkdownStagePage route={route} />;
    if (stage === "characters" || stage === "items")                       return <EntityStagePage route={route} />;
    if (stage === "chapters")                                              return <ChaptersStagePage route={route} />;
    if (stage === "settings")                                              return <SettingsStagePage route={route} />;
    return <NotFound />;
  }
  if (route.name === "chapter")        return <ChapterPage route={route} focusMode={focusMode} leftCollapsed={leftCollapsed} rightCollapsed={rightCollapsed} onToggleRight={onToggleRight} />;
  if (route.name === "style-profiles") return <StyleProfilesListPage />;
  if (route.name === "style-profile")  return <StyleProfilePage route={route} />;
  if (route.name === "usage")          return <UsagePage />;
  return <NotFound />;
}

/* ─── Tweaks UI ──────────────────────────────────────────── */

function TweaksUI({ t, setTweak }) {
  const { TweaksPanel, TweakSection, TweakSlider, TweakRadio, TweakSelect, TweakColor, TweakToggle, TweakButton } = window;
  return (
    <TweaksPanel>
      <TweakSection label="Готовые варианты" />
      <div className="twk-variants">
        {Object.entries(VARIANT_PRESETS).map(([k, v]) => (
          <button key={k}
                  className={"twk-variant" + (t.variant === k ? " twk-variant-on" : "")}
                  onClick={() => applyVariant(setTweak, k)}>
            <span className="twk-variant-swatch" style={{ background: v.brassHue }} />
            <span className="twk-variant-label">{v.label}</span>
          </button>
        ))}
      </div>

      <TweakSection label="Латунь" />
      <TweakColor label="Оттенок" value={t.brassHue}
                  options={["#E1A858", "#D49A4E", "#B07F33", "#9A6B2A"]}
                  onChange={(v) => setTweak("brassHue", v)} />

      <TweakSection label="Бумага" />
      <TweakSlider label="Зернистость" value={t.grain} min={0} max={1} step={0.05}
                   onChange={(v) => setTweak("grain", v)} />

      <TweakSection label="Шрифты" />
      <TweakSelect label="Пара" value={t.fontPair}
                   options={Object.entries(FONT_PAIRS).map(([k, v]) => ({ value: k, label: v.label }))}
                   onChange={(v) => setTweak("fontPair", v)} />

      <TweakSection label="Раскладка глав" />
      <TweakSelect label="Панели" value={t.rails}
                   options={[
                     { value: "both",            label: "План + Разбор" },
                     { value: "critique-only",   label: "Только разбор" },
                     { value: "outline-only",    label: "Только план" },
                     { value: "manuscript-only", label: "Только манускрипт" },
                   ]}
                   onChange={(v) => setTweak("rails", v)} />
      <TweakToggle label="Focus mode (⌘⇧F)" value={t.focusMode}
                   onChange={(v) => setTweak("focusMode", v)} />
    </TweaksPanel>
  );
}

/* ─── color helpers ──────────────────────────────────────── */

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function shade(hex, amt) {
  const h = hex.replace("#", "");
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);

})();
