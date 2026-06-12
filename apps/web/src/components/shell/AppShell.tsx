import { useEffect, useState } from "react";
import {
  Outlet,
  Link,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import {
  BookOpen,
  Feather,
  Bookmark,
  BarChart3,
  Cog,
  PanelLeft,
  Search,
  Sliders,
} from "lucide-react";

type RailMode = "collapsed" | "expanded" | "hidden";

const STAGE_LABEL: Record<string, string> = {
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
  settings: "Настройки",
};

const TOP_LEVEL_LABEL: Record<string, string> = {
  "/style-profiles": "Профили стиля",
  "/usage": "Использование",
};

/** Library-Warm global shell. Reference: book_redisign/bookopis/shell.jsx. */
export function AppShell() {
  const [railMode, setRailMode] = useState<RailMode>("expanded");
  const [scrolled, setScrolled] = useState(false);

  // Drive layout via body data attribute (CSS in styles/library-warm.css picks it up).
  useEffect(() => {
    document.body.dataset.rail = railMode;
    return () => {
      delete document.body.dataset.rail;
    };
  }, [railMode]);

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateColumns: `${railMode === "expanded" ? 240 : railMode === "hidden" ? 0 : 60}px 1fr`,
        gridTemplateRows: "56px 1fr 24px",
        gridTemplateAreas: `
          "rail topbar"
          "rail main"
          "rail status"
        `,
        transition: "grid-template-columns 200ms cubic-bezier(0.22, 0.9, 0.32, 1)",
      }}
    >
      <TopBar scrolled={scrolled} />
      <LeftRail railMode={railMode} setRailMode={setRailMode} />
      <main
        style={{ gridArea: "main", overflow: "auto", position: "relative" }}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
      >
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

/* ─── TopBar ────────────────────────────────────────────── */

function TopBar({ scrolled }: { scrolled: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const crumbs = useCrumbs();

  return (
    <header
      className={`topbar ${scrolled ? "scrolled" : ""}`}
      style={{ gridArea: "topbar" }}
    >
      <div
        onClick={() => navigate("/books")}
        className="wordmark"
        style={{ cursor: "pointer" }}
      >
        Bookopis
      </div>
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span
            key={i}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {i > 0 && <span className="crumb-sep">/</span>}
            {c.to ? (
              <span
                style={{ cursor: "pointer" }}
                onClick={() => navigate(c.to!)}
              >
                {c.label}
              </span>
            ) : (
              <span className="crumb-current">{c.label}</span>
            )}
          </span>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ gap: 8 }}
        aria-label="Палитра команд (Cmd+K)"
        title="Палитра команд · Cmd+K"
      >
        <Search size={14} aria-hidden="true" />
        <span style={{ color: "var(--color-text-muted)" }}>
          Найти что-нибудь…
        </span>
        <span className="kbd">⌘K</span>
      </button>
      <Link to="/style-profiles" className="style-pill" title="Профили стиля">
        <span className="dot" />
        <span className="font-mono" style={{ fontSize: 10, opacity: 0.6 }}>
          стиль
        </span>
        Профили
      </Link>
      <Link
        to="/usage"
        className="btn btn-ghost btn-sm"
        style={{ textDecoration: "none" }}
      >
        Использование
      </Link>
      <div className="avatar" aria-label="Профиль" title="Профиль">
        {avatarLetter(pathname)}
      </div>
    </header>
  );
}

function avatarLetter(_pathname: string): string {
  return "М";
}

interface Crumb {
  label: string;
  to?: string;
}

function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const crumbs: Crumb[] = [];

  if (TOP_LEVEL_LABEL[pathname]) {
    crumbs.push({ label: TOP_LEVEL_LABEL[pathname]! });
    return crumbs;
  }

  if (pathname.startsWith("/books")) {
    crumbs.push({ label: "Книги", to: "/books" });
    const parts = pathname.split("/").filter(Boolean); // ['books', ':id', ...]
    const bookId = parts[1];
    if (bookId && bookId !== "design-preview.html") {
      crumbs.push({
        label: `#${bookId}`,
        to: `/books/${bookId}/studio`,
      });
      if (parts[2] === "studio") {
        const stage = parts[3];
        if (stage && STAGE_LABEL[stage]) {
          crumbs.push({ label: STAGE_LABEL[stage]! });
        } else {
          crumbs.push({ label: "Studio" });
        }
      } else if (parts[2] === "chapters" && parts[3]) {
        crumbs.push({ label: `Гл. ${parts[3]}` });
      }
    }
  } else if (pathname.startsWith("/style-profiles")) {
    crumbs.push({ label: "Профили стиля", to: "/style-profiles" });
    const parts = pathname.split("/").filter(Boolean);
    if (parts[1]) crumbs.push({ label: `#${parts[1]}` });
  }

  return crumbs;
}

/* ─── LeftRail ──────────────────────────────────────────── */

interface RailItem {
  id: string;
  label: string;
  to: string;
  icon: React.ReactNode;
  kbd?: string;
}

function LeftRail({
  railMode,
  setRailMode,
}: {
  railMode: RailMode;
  setRailMode: (m: RailMode) => void;
}) {
  const navigate = useNavigate();
  const expanded = railMode === "expanded";

  const items: RailItem[] = [
    {
      id: "books",
      label: "Книги",
      to: "/books",
      icon: <BookOpen size={18} aria-hidden="true" />,
      kbd: "⌘B",
    },
    {
      id: "styles",
      label: "Профили стиля",
      to: "/style-profiles",
      icon: <Bookmark size={18} aria-hidden="true" />,
    },
    {
      id: "usage",
      label: "Использование",
      to: "/usage",
      icon: <BarChart3 size={18} aria-hidden="true" />,
    },
  ];

  return (
    <aside
      className="leftrail"
      aria-label="Главная навигация"
      style={{ gridArea: "rail" }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={expanded ? "Свернуть боковую панель" : "Развернуть боковую панель"}
        title={expanded ? "Свернуть · Cmd+\\" : "Развернуть · Cmd+\\"}
        onClick={() => setRailMode(expanded ? "collapsed" : "expanded")}
        style={{ width: 32, height: 32, padding: 0, marginBottom: 8 }}
      >
        <PanelLeft size={16} aria-hidden="true" />
      </button>

      <div className="rail-section">
        <div className="rail-section-label">Навигация</div>
        {items.map((item) => (
          <RailItemNode key={item.id} item={item} navigate={navigate} />
        ))}
      </div>

      <div style={{ marginTop: "auto" }}>
        <div className="divider" style={{ margin: "12px 0" }} />
        <div
          className="nav-item"
          title="Подсказки"
          onClick={() => navigate("/usage")}
        >
          <span className="icon">
            <Sliders size={18} aria-hidden="true" />
          </span>
          <span className="label">Система</span>
        </div>
      </div>
    </aside>
  );
}

function RailItemNode({
  item,
  navigate,
}: {
  item: RailItem;
  navigate: (to: string) => void;
}) {
  const inBooks = useMatch("/books/*") !== null;
  const inProfiles = useMatch("/style-profiles/*") !== null;
  const inUsage = useMatch("/usage") !== null;
  const active =
    (item.to === "/books" && inBooks) ||
    (item.to === "/style-profiles" && inProfiles) ||
    (item.to === "/usage" && inUsage);
  return (
    <div
      className={`nav-item ${active ? "active" : ""}`}
      onClick={() => navigate(item.to)}
      title={item.kbd ? `${item.label} · ${item.kbd}` : item.label}
    >
      <span className="icon">{item.icon}</span>
      <span className="label">{item.label}</span>
    </div>
  );
}

/* ─── StatusBar ─────────────────────────────────────────── */

function StatusBar() {
  return (
    <footer
      className="statusbar"
      aria-label="Состояние сессии"
      style={{ gridArea: "status" }}
    >
      <span>
        <span className="dot dot-ok" /> Подключено
      </span>
      <span className="sep">·</span>
      <span>
        Бэкенд:{" "}
        <span style={{ color: "var(--color-text)" }}>subscription</span>
      </span>
      <span className="sep">·</span>
      <span>
        Агент: <span style={{ color: "var(--color-text)" }}>—</span>
      </span>
      <span className="sep">·</span>
      <span>
        Токенов: <span style={{ color: "var(--color-text)" }}>0</span>
      </span>
      <span className="sep">·</span>
      <span>
        $ <span style={{ color: "var(--color-text)" }}>0.00</span>
      </span>
      <span style={{ flex: 1 }} />
      <span>Авто-сохранение · только что</span>
      <span className="sep">·</span>
      <span className="kbd">⌘K</span>
      <span style={{ color: "var(--color-text-faint)" }}>палитра</span>
    </footer>
  );
}
