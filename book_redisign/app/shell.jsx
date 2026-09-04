(function(){
// app/shell.jsx — Global shell: TopBar, LeftRail, StatusBar, hash router

const { useState: uS, useEffect: uE, useRef: uR } = React;
const { cn: cn2, Tooltip, Kbd, Pill, Dot, I, Button } = window.LW;

/* ─── hash router ────────────────────────────────────────── */

function useHashRoute() {
  const [hash, setHash] = uS(() => window.location.hash || "#/books");
  uE(() => {
    const onHash = () => setHash(window.location.hash || "#/books");
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.location.hash = "#/books";
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // parse
  const route = parseRoute(hash);
  return [route, hash];
}

function parseRoute(hash) {
  const path = (hash || "#/").replace(/^#/, "");
  const parts = path.split("/").filter(Boolean);
  // /books
  if (parts.length === 0 || parts[0] !== "books" && parts[0] !== "style-profiles" && parts[0] !== "usage" && parts[0] !== "ds") {
    return { name: "books" };
  }
  if (parts[0] === "ds") return { name: "ds" };
  if (parts[0] === "usage") return { name: "usage" };
  if (parts[0] === "style-profiles") {
    if (parts[1]) return { name: "style-profile", profileId: Number(parts[1]) };
    return { name: "style-profiles" };
  }
  if (parts[0] === "books" && !parts[1]) return { name: "books" };
  const bookId = Number(parts[1]);
  if (parts[2] === "studio") {
    const stage = parts[3]; // undefined | world | lore | plot | characters | items | chapters | settings
    return { name: "studio", bookId, stage: stage || null };
  }
  if (parts[2] === "chapters") {
    return { name: "chapter", bookId, chapterId: Number(parts[3]) };
  }
  return { name: "books" };
}

/* ─── TopBar ─────────────────────────────────────────────── */

function breadcrumb(route, getBookTitle) {
  const crumbs = [];
  if (route.name === "books")         crumbs.push("Книги");
  if (route.name === "studio")        crumbs.push("Книги", getBookTitle(route.bookId), "Studio", stageName(route.stage));
  if (route.name === "chapter")       crumbs.push("Книги", getBookTitle(route.bookId), "Глава " + route.chapterId);
  if (route.name === "style-profiles")crumbs.push("Профили стиля");
  if (route.name === "style-profile") crumbs.push("Профили стиля", "Профиль");
  if (route.name === "usage")         crumbs.push("Использование");
  if (route.name === "ds")            crumbs.push("Дизайн-система");
  return crumbs.filter(Boolean);
}
function stageName(stage) {
  return ({ world:"Мир", lore:"Лор", characters:"Персонажи", items:"Предметы", plot:"Сюжет", chapters:"Главы", settings:"Настройки" })[stage] || "Концепт";
}

function TopBar({ route, scrolled, focusMode, onToggleFocus }) {
  const { BOOKS } = window.LW_DATA;
  const getBookTitle = (id) => BOOKS.find((b) => b.id === id)?.title || "Книга";
  const crumbs = breadcrumb(route, getBookTitle);

  return (
    <header className={cn2("topbar", scrolled && "topbar-scrolled", focusMode && "topbar-focus")}>
      <div className="topbar-left">
        <a href="#/books" className="brand">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span className="brand-name">Bookopis</span>
        </a>
        <nav aria-label="Хлебные крошки" className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <span className="crumb-sep faint">/</span>}
              <span className={cn2("crumb-label", i === crumbs.length - 1 && "strong")}>{c}</span>
            </span>
          ))}
        </nav>
      </div>

      {route.name === "chapter" && <ChapterTitlePill chapterId={route.chapterId} />}

      <div className="topbar-right">
        <Tooltip label="Команды" kbd="⌘K" side="bottom">
          <button className="topbar-kbd" aria-label="Открыть палитру команд">
            <I.Search />
            <Kbd>⌘K</Kbd>
          </button>
        </Tooltip>
        <span className="topbar-style-pill">
          <Pill tone="brass" icon={<I.Quill />}>Соляной свет</Pill>
        </span>
        <a href="#/usage" className="topbar-link">Использование</a>
        <button className="avatar" aria-label="Профиль">Л</button>
      </div>
    </header>
  );
}

function ChapterTitlePill({ chapterId }) {
  const c = window.LW_DATA.CHAPTERS.find((x) => x.id === chapterId);
  if (!c) return null;
  return (
    <div className="topbar-center">
      <span className="topbar-chapter">
        <span className="topbar-chapter-num">Гл. {c.order} ·</span>
        <span className="topbar-chapter-title">{c.title}</span>
      </span>
    </div>
  );
}

/* ─── LeftRail ───────────────────────────────────────────── */

function LeftRail({ route, expanded, onToggle, focusMode }) {
  const bookId = route.bookId || 1;
  const items = [
    { id: "books",          label: "Книги",          href: "#/books",                  icon: "Books",  shortcut: "G B", active: route.name === "books" },
    { id: "studio",         label: "Studio",         href: `#/books/${bookId}/studio`, icon: "Compass",shortcut: "G S", active: route.name === "studio" || route.name === "chapter" },
    { id: "style-profiles", label: "Профили стиля",  href: "#/style-profiles",         icon: "Quill",  shortcut: "G P", active: route.name === "style-profiles" || route.name === "style-profile" },
    { id: "usage",          label: "Использование",  href: "#/usage",                  icon: "Chart",  shortcut: "G U", active: route.name === "usage" },
    { id: "ds",             label: "Дизайн-система", href: "#/ds",                     icon: "Bookmark", active: route.name === "ds" },
  ];
  return (
    <aside className={cn2("leftrail", expanded && "leftrail-exp", focusMode && "leftrail-hidden")} aria-label="Главная навигация">
      <button className="leftrail-toggle" onClick={onToggle} aria-label={expanded ? "Свернуть" : "Развернуть"}>
        <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
      </button>
      <nav className="leftrail-nav">
        {items.map((it) => {
          const Icon = I[it.icon];
          return (
            <Tooltip key={it.id} label={it.label} kbd={it.shortcut} side="right">
              <a href={it.href} className={cn2("leftrail-item", it.active && "leftrail-item-active")} aria-current={it.active ? "page" : undefined}>
                <span className="leftrail-bar" aria-hidden="true" />
                <span className="leftrail-icon"><Icon /></span>
                {expanded && <span className="leftrail-label">{it.label}</span>}
              </a>
            </Tooltip>
          );
        })}
      </nav>
      <div className="leftrail-foot">
        <Tooltip label="Настройки" side="right">
          <a href={`#/books/${bookId}/studio/settings`} className="leftrail-item">
            <span className="leftrail-bar" aria-hidden="true" />
            <span className="leftrail-icon"><I.Settings /></span>
            {expanded && <span className="leftrail-label">Настройки</span>}
          </a>
        </Tooltip>
      </div>
    </aside>
  );
}

/* ─── StatusBar ──────────────────────────────────────────── */

function StatusBar({ route, focusMode, saving, streaming }) {
  if (focusMode || route.name === "chapter" && false) return null;
  return (
    <footer className={cn2("statusbar mono", focusMode && "statusbar-dim")}>
      <span className="status-group">
        <Dot tone={streaming ? "brass" : "green"} />
        <span>{streaming ? "writer · пишет…" : saving ? "сохранение…" : "сохранено · только что"}</span>
      </span>
      <span className="sep faint">·</span>
      <span className="status-group">backend: <span className="strong">subscription</span></span>
      <span className="sep faint">·</span>
      <span className="status-group">sonnet · 4 210/8 192 ток.</span>
      <span className="sep faint">·</span>
      <span className="status-group">$0,27 за сессию</span>
      <span className="status-spacer" />
      <span className="status-group faint">v0.4.0 · Library Warm</span>
    </footer>
  );
}

window.LW = Object.assign(window.LW, { useHashRoute, parseRoute, TopBar, LeftRail, StatusBar });

})();
