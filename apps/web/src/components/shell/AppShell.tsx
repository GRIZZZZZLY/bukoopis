import { Outlet, Link, NavLink, useLocation, useMatch } from "react-router-dom";
import { Library, Palette, BarChart3 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

/** Library-Warm global chrome: TopBar (56) · LeftRail (60) · main · StatusBar (24). */
export function AppShell() {
  return (
    <div className="lw min-h-screen grid grid-rows-[var(--topbar-h)_1fr_var(--statusbar-h)]">
      <TopBar />
      <div className="grid grid-cols-[var(--rail-l-collapsed)_1fr] min-h-0">
        <LeftRail />
        <main className="min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

/* ─── TopBar ───────────────────────────────────────────────── */

function TopBar() {
  return (
    <header className="lw-topbar">
      <Link
        to="/books"
        className="font-medium tracking-tight text-[var(--color-brass)] hover:text-[var(--color-brass-hi)] transition-colors"
        style={{ fontFamily: "var(--font-display)", fontSize: 18 }}
        aria-label="Bookopis — на главную"
      >
        Bookopis
      </Link>
      <span className="text-[var(--color-text-faint)]">/</span>
      <Breadcrumb />
      <div className="ml-auto flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
        <span className="hidden md:inline-flex items-center gap-1.5">
          <Kbd>Cmd</Kbd>
          <Kbd>K</Kbd>
        </span>
        <Link
          to="/usage"
          className="hidden sm:inline hover:text-[var(--color-text)] transition-colors"
        >
          Расходы
        </Link>
        <span
          aria-hidden="true"
          className="size-7 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)]"
        />
      </div>
    </header>
  );
}

/* ─── Breadcrumb (derived from pathname) ──────────────────── */

const STAGE_LABEL: Record<string, string> = {
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
  settings: "Настройки",
};

function Breadcrumb() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; to?: string; mono?: boolean }[] = [];
  if (parts[0] === "books") {
    crumbs.push({ label: "Книги", to: "/books" });
    const bookId = parts[1];
    if (bookId) {
      crumbs.push({ label: `#${bookId}`, to: `/books/${bookId}/studio`, mono: true });
      if (parts[2] === "studio") {
        crumbs.push({ label: "Studio", to: `/books/${bookId}/studio` });
        const stage = parts[3];
        if (stage && STAGE_LABEL[stage])
          crumbs.push({ label: STAGE_LABEL[stage] });
      } else if (parts[2] === "chapters" && parts[3]) {
        crumbs.push({ label: `Глава #${parts[3]}`, mono: true });
      }
    }
  } else if (parts[0] === "style-profiles") {
    crumbs.push({ label: "Профили стиля", to: "/style-profiles" });
    if (parts[1]) crumbs.push({ label: `#${parts[1]}`, mono: true });
  } else if (parts[0] === "usage") {
    crumbs.push({ label: "Расходы" });
  }

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Хлебные крошки" className="lw-crumb">
      {crumbs.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span className="sep">/</span>}
          {c.to ? (
            <Link
              to={c.to}
              className={
                c.mono ? "lw-mono text-[var(--color-text-muted)]" : "hover:text-[var(--color-text)]"
              }
            >
              {i === crumbs.length - 1 ? <b>{c.label}</b> : c.label}
            </Link>
          ) : (
            <span className={c.mono ? "lw-mono" : ""}>
              <b>{c.label}</b>
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ─── LeftRail ─────────────────────────────────────────────── */

function LeftRail() {
  return (
    <nav className="lw-leftrail" aria-label="Главная навигация">
      <RailLink to="/books" label="Книги" icon={<Library className="size-5" aria-hidden="true" />} />
      <RailLink
        to="/style-profiles"
        label="Стилевые профили"
        icon={<Palette className="size-5" aria-hidden="true" />}
      />
      <RailLink
        to="/usage"
        label="Расходы"
        icon={<BarChart3 className="size-5" aria-hidden="true" />}
      />
    </nav>
  );
}

function RailLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
}) {
  // Treat any deep path under /books/* as active "Книги".
  const inBooks = useMatch("/books/*") !== null;
  const inProfiles = useMatch("/style-profiles/*") !== null;
  const inUsage = useMatch("/usage") !== null;
  const active =
    (to === "/books" && inBooks) ||
    (to === "/style-profiles" && inProfiles) ||
    (to === "/usage" && inUsage);
  return (
    <NavLink
      to={to}
      end={to === "/usage"}
      className="lw-railbtn"
      data-active={active ? "true" : undefined}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </NavLink>
  );
}

/* ─── StatusBar (stubbed mono strip) ──────────────────────── */

function StatusBar() {
  return (
    <footer className="lw-statusbar">
      <span>агент: —</span>
      <span>·</span>
      <span>токены: —</span>
      <span>·</span>
      <span>cost: —</span>
      <span className="ml-auto text-[var(--color-ink-green)]">online</span>
    </footer>
  );
}
