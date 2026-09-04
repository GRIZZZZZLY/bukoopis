/* global React, Icon, I, IconBtn, Kbd, Tooltip, useRoute, matchRoute */
const { useState, useEffect, useRef } = React;

// ───────────────────────────────────────────────
// TopBar
// ───────────────────────────────────────────────
const TopBar = ({ book, chapter, onToggleRail, scrolled }) => {
  const { path, navigate } = useRoute();
  const crumbs = [];
  crumbs.push({ label: "Книги", to: "/books" });
  if (book) {
    crumbs.push({ label: book.title, to: `/books/${book.id}/studio` });
    if (matchRoute(path, "/books/:id/studio/:stage")) {
      const m = matchRoute(path, "/books/:id/studio/:stage");
      const stageLabels = {
        world: "Мир", lore: "Лор", characters: "Персонажи",
        items: "Предметы", plot: "Сюжет", chapters: "Главы",
        settings: "Настройки",
      };
      crumbs.push({ label: stageLabels[m.stage] || m.stage });
    } else if (matchRoute(path, "/books/:id/studio")) {
      crumbs.push({ label: "Studio" });
    } else if (chapter) {
      crumbs.push({ label: `Гл. ${chapter.order}` });
    }
  } else if (path === "/style-profiles") crumbs.length && crumbs.pop(), crumbs.push({ label: "Профили стиля" });

  // For top-level pages without a book:
  const topLevel = {
    "/style-profiles": "Профили стиля",
    "/usage":          "Использование",
    "/design-system":  "Система дизайна",
  };
  if (topLevel[path]) {
    return renderTop(scrolled, onToggleRail, [{ label: topLevel[path] }], null, navigate);
  }
  return renderTop(scrolled, onToggleRail, crumbs, chapter, navigate);
};

function renderTop(scrolled, onToggleRail, crumbs, chapter, navigate) {
  return (
    <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
      <div onClick={() => navigate("/books")} className="wordmark" style={{ cursor: "pointer" }}>
        Bookopis
      </div>
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="crumb-sep">/</span>}
            {c.to
              ? <span style={{ cursor: "pointer" }} onClick={() => navigate(c.to)}>{c.label}</span>
              : <span className="crumb-current">{c.label}</span>}
          </React.Fragment>
        ))}
      </div>
      {chapter && (
        <div className="chapter-title" style={{ marginLeft: 24 }}>
          <span className="prefix">Гл. {chapter.order} ·</span>
          <span className="title">{chapter.title}</span>
        </div>
      )}
      <div className="spacer"/>
      <Tooltip label="Палитра команд" kbd="⌘K">
        <button className="btn btn-ghost btn-sm" style={{ gap: 8 }}>
          <Icon d={I.search} size={14}/>
          <span style={{ color: "var(--color-text-muted)" }}>Найти что-нибудь…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </Tooltip>
      <span className="style-pill">
        <span className="dot"/>
        <span className="font-mono" style={{ fontSize: 10, opacity: 0.6 }}>стиль</span>
        Достоевщина
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/usage")}>Использование</button>
      <div className="avatar" aria-label="Профиль">М</div>
    </header>
  );
}

// ───────────────────────────────────────────────
// LeftRail
// ───────────────────────────────────────────────
const LeftRail = ({ railMode, setRailMode }) => {
  const { path, navigate } = useRoute();
  const expanded = railMode === "expanded";
  const items = [
    { id: "books",    label: "Книги",          icon: I.books,    to: "/books",          kbd: "⌘B" },
    { id: "studio",   label: "Studio",         icon: I.feather,  to: "/books/1/studio", kbd: "⌘D" },
    { id: "styles",   label: "Профили стиля",  icon: I.bookmark, to: "/style-profiles", kbd: null },
    { id: "usage",    label: "Использование",  icon: I.chart,    to: "/usage",          kbd: null },
    { id: "settings", label: "Настройки",      icon: I.cog,      to: "/books/1/studio/settings", kbd: null },
  ];
  const isActive = (item) => {
    if (item.id === "books"    && path.startsWith("/books") && !path.includes("/studio")) return !path.includes("/chapters");
    if (item.id === "studio"   && (path.includes("/studio") || path.includes("/chapters/"))) return true;
    if (item.id === "styles"   && path.startsWith("/style-profiles")) return true;
    if (item.id === "usage"    && path === "/usage") return true;
    if (item.id === "settings" && path.endsWith("/settings")) return true;
    return false;
  };
  return (
    <aside className="leftrail" aria-label="Главная навигация">
      <Tooltip label={expanded ? "Свернуть" : "Развернуть"} kbd="⌘\">
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Переключить боковую панель"
          onClick={() => setRailMode(expanded ? "collapsed" : "expanded")}
          style={{ width: 32, height: 32, padding: 0, marginBottom: 8 }}>
          <Icon d={I.panel} size={16}/>
        </button>
      </Tooltip>

      <div className="rail-section">
        <div className="rail-section-label">Навигация</div>
        {items.map(item => (
          <Tooltip key={item.id} label={item.label} kbd={item.kbd}>
            <div
              className={`nav-item ${isActive(item) ? "active" : ""}`}
              onClick={() => navigate(item.to)}>
              <span className="icon"><Icon d={item.icon} size={18}/></span>
              <span className="label">{item.label}</span>
            </div>
          </Tooltip>
        ))}
      </div>

      <div className="rail-foot">
        <div className="divider" style={{ margin: "12px 0" }}/>
        <Tooltip label="Подсказки" kbd="?">
          <div className="nav-item" onClick={() => navigate("/design-system")}>
            <span className="icon"><Icon d={I.sliders} size={18}/></span>
            <span className="label">Система</span>
          </div>
        </Tooltip>
      </div>
    </aside>
  );
};

// ───────────────────────────────────────────────
// StatusBar
// ───────────────────────────────────────────────
const StatusBar = ({ session }) => {
  return (
    <footer className="statusbar" aria-label="Состояние сессии">
      <span><span className="dot dot-ok"/> Подключено</span>
      <span className="sep">·</span>
      <span>Бэкенд: <span style={{ color: "var(--color-text)" }}>subscription</span></span>
      <span className="sep">·</span>
      <span>Агент: <span style={{ color: "var(--color-text)" }}>{session?.agent || "—"}</span></span>
      <span className="sep">·</span>
      <span>Токенов: <span style={{ color: "var(--color-text)" }}>{session?.tokens?.toLocaleString("ru-RU") || "0"}</span></span>
      <span className="sep">·</span>
      <span>$ <span style={{ color: "var(--color-text)" }}>{session?.cost || "0.00"}</span></span>
      <span className="spacer"/>
      <span>Авто-сохранение · {session?.saved || "только что"}</span>
      <span className="sep">·</span>
      <Kbd>⌘K</Kbd>
      <span style={{ color: "var(--color-text-faint)" }}>палитра</span>
    </footer>
  );
};

Object.assign(window, { TopBar, LeftRail, StatusBar });
