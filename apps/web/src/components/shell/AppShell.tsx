import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  Compass,
  Feather,
  Lamp,
  Search,
  Settings,
} from "lucide-react";
import {
  applyAtmosphereClass,
  cycleAtmosphere,
  useAtmosphere,
  type AtmosphereMode,
} from "../../lib/useAtmosphere";

const STAGE_LABEL: Record<string, string> = {
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
  settings: "Настройки",
};

interface RouteInfo {
  name:
    | "books"
    | "studio"
    | "chapter"
    | "style-profiles"
    | "style-profile"
    | "usage"
    | "other";
  bookId?: string;
  stage?: string;
  chapterId?: string;
}

function parseRoute(pathname: string): RouteInfo {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "usage") return { name: "usage" };
  if (parts[0] === "style-profiles") {
    return parts[1]
      ? { name: "style-profile" }
      : { name: "style-profiles" };
  }
  if (parts[0] === "books") {
    if (!parts[1]) return { name: "books" };
    const bookId = parts[1];
    if (parts[2] === "studio") {
      return { name: "studio", bookId, stage: parts[3] };
    }
    if (parts[2] === "chapters" && parts[3]) {
      return { name: "chapter", bookId, chapterId: parts[3] };
    }
    return { name: "books", bookId };
  }
  return { name: "other" };
}

function breadcrumb(route: RouteInfo): string[] {
  switch (route.name) {
    case "books":
      return ["Книги"];
    case "studio":
      return [
        "Книги",
        `#${route.bookId}`,
        "Studio",
        route.stage ? (STAGE_LABEL[route.stage] ?? route.stage) : "Концепт",
      ];
    case "chapter":
      return ["Книги", `#${route.bookId}`, `Глава ${route.chapterId}`];
    case "style-profiles":
      return ["Профили стиля"];
    case "style-profile":
      return ["Профили стиля", "Профиль"];
    case "usage":
      return ["Использование"];
    default:
      return [];
  }
}

/** Library-Warm global shell. Reference: extracted app/shell.jsx + app.jsx. */
export function AppShell() {
  const { pathname } = useLocation();
  const route = parseRoute(pathname);
  const [expanded, setExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    applyAtmosphereClass();
  }, []);

  return (
    <div className="app" data-focus="false">
      <TopBar route={route} scrolled={scrolled} />
      <LeftRail
        route={route}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      <main className="main">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

/* ─── TopBar ────────────────────────────────────────────── */

function TopBar({ route, scrolled }: { route: RouteInfo; scrolled: boolean }) {
  const crumbs = breadcrumb(route);
  return (
    <header className={`topbar ${scrolled ? "topbar-scrolled" : ""}`}>
      <div className="topbar-left">
        <Link to="/books" className="brand" viewTransition>
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span className="brand-name">Bookopis</span>
        </Link>
        <nav aria-label="Хлебные крошки" className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <span className="crumb-sep faint">/</span>}
              <span
                className={`crumb-label ${i === crumbs.length - 1 ? "strong" : ""}`}
              >
                {c}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="topbar-kbd"
          aria-label="Открыть палитру команд"
          title="Команды · Cmd+K"
        >
          <Search size={14} aria-hidden="true" />
          <span className="kbd">⌘K</span>
        </button>
        <Link to="/style-profiles" title="Профили стиля" viewTransition>
          <span className="pill pill-brass">
            <Feather size={11} aria-hidden="true" />
            Стиль
          </span>
        </Link>
        <Link to="/usage" className="topbar-link" viewTransition>
          Использование
        </Link>
        <AtmosphereLamp />
        <button type="button" className="avatar" aria-label="Профиль">
          М
        </button>
      </div>
    </header>
  );
}

/* ─── LeftRail ──────────────────────────────────────────── */

function LeftRail({
  route,
  expanded,
  onToggle,
}: {
  route: RouteInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const bookId = route.bookId;
  const items = [
    {
      id: "books",
      label: "Книги",
      to: "/books",
      icon: <BookOpen size={18} aria-hidden="true" />,
      active: route.name === "books",
      show: true,
    },
    {
      id: "studio",
      label: "Studio",
      to: bookId ? `/books/${bookId}/studio` : "/books",
      icon: <Compass size={18} aria-hidden="true" />,
      active: route.name === "studio" || route.name === "chapter",
      show: Boolean(bookId),
    },
    {
      id: "style-profiles",
      label: "Профили стиля",
      to: "/style-profiles",
      icon: <Feather size={18} aria-hidden="true" />,
      active: route.name === "style-profiles" || route.name === "style-profile",
      show: true,
    },
    {
      id: "usage",
      label: "Использование",
      to: "/usage",
      icon: <BarChart3 size={18} aria-hidden="true" />,
      active: route.name === "usage",
      show: true,
    },
  ];
  return (
    <aside
      className={`leftrail ${expanded ? "leftrail-exp" : ""}`}
      aria-label="Главная навигация"
    >
      <button
        type="button"
        className="leftrail-toggle"
        onClick={onToggle}
        aria-label={expanded ? "Свернуть" : "Развернуть"}
      >
        <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
      </button>
      <nav className="leftrail-nav">
        {items
          .filter((it) => it.show)
          .map((it) => (
            <Link
              key={it.id}
              to={it.to}
              className={`leftrail-item ${it.active ? "leftrail-item-active" : ""}`}
              aria-current={it.active ? "page" : undefined}
              title={it.label}
              viewTransition
            >
              <span className="leftrail-bar" aria-hidden="true" />
              <span className="leftrail-icon">{it.icon}</span>
              {expanded && <span className="leftrail-label">{it.label}</span>}
            </Link>
          ))}
      </nav>
      {bookId && (
        <div className="leftrail-foot">
          <Link
            to={`/books/${bookId}/studio/settings`}
            className={`leftrail-item ${route.stage === "settings" ? "leftrail-item-active" : ""}`}
            title="Настройки"
            viewTransition
          >
            <span className="leftrail-bar" aria-hidden="true" />
            <span className="leftrail-icon">
              <Settings size={18} aria-hidden="true" />
            </span>
            {expanded && <span className="leftrail-label">Настройки</span>}
          </Link>
        </div>
      )}
    </aside>
  );
}

/* ─── AtmosphereLamp ────────────────────────────────────── */

const ATM_TITLE: Record<AtmosphereMode, string> = {
  full: "Атмосфера: полная",
  calm: "Атмосфера: спокойная",
  off: "Атмосфера: выкл",
};

function AtmosphereLamp() {
  const mode = useAtmosphere();
  return (
    <button
      type="button"
      className={`topbar-lamp ${mode !== "off" ? "topbar-lamp-on" : ""}`}
      onClick={cycleAtmosphere}
      aria-label={ATM_TITLE[mode]}
      title={`${ATM_TITLE[mode]} · клик переключает`}
    >
      <Lamp size={15} aria-hidden="true" />
    </button>
  );
}

/* ─── StatusBar ─────────────────────────────────────────── */

function StatusBar() {
  return (
    <footer className="statusbar mono" aria-label="Состояние сессии">
      <span className="status-group">
        <span className="dot dot-ok" />
        <span>сохранено · только что</span>
      </span>
      <span className="sep faint">·</span>
      <span className="status-group">
        backend: <span className="strong">subscription</span>
      </span>
      <span className="status-spacer" />
      <span className="status-group faint">v0.4.0 · Library Warm</span>
    </footer>
  );
}
