import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Lamp } from "lucide-react";
import type { Book, Chapter } from "@book-forge/shared";
import {
  applyAtmosphereClass,
  cycleAtmosphere,
  effectiveMode,
  useAtmosphere,
  type AtmosphereMode,
} from "../../lib/useAtmosphere";
import { setFocus, useFocusMode } from "../../lib/focusMode";
import { useSaveStatus } from "../../lib/saveStatus";
import { BOOK_SECTIONS, ROOM_LABELS, STAGE_LABELS } from "../../lib/labels";
import { CandleGauge } from "../atmosphere/CandleGauge";
import { DustLayer, shouldShowDust } from "../atmosphere/DustLayer";
import { CatCompanion } from "../atmosphere/CatCompanion";
import { JobIndicator } from "./JobIndicator";

export interface RouteInfo {
  name: "shelf" | "book" | "studio" | "chapter" | "styles" | "costs" | "other";
  bookId?: number;
  /** Раздел дома книги: overview | chapters | canon | memory | settings. */
  section?: string;
  stage?: string;
  chapterId?: number;
  profileId?: number;
}

export function parseRoute(pathname: string): RouteInfo {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "usage") return { name: "costs" };
  if (parts[0] === "style-profiles") {
    const pid = Number(parts[1]);
    return parts[1] && Number.isFinite(pid)
      ? { name: "styles", profileId: pid }
      : { name: "styles" };
  }
  if (parts[0] !== "books") return { name: "other" };
  if (!parts[1]) return { name: "shelf" };
  const bookId = Number(parts[1]);
  if (!Number.isFinite(bookId)) return { name: "other" };
  if (parts[2] === "studio") {
    return { name: "studio", bookId, stage: parts[3] ?? "concept" };
  }
  if (parts[2] === "chapters" && parts[3]) {
    return { name: "chapter", bookId, chapterId: Number(parts[3]) };
  }
  return { name: "book", bookId, section: parts[2] ?? "overview" };
}

interface Crumb {
  label: string;
  to?: string;
}

/** Порядковый номер главы — позиция в книге, а не разрежённый order_index. */
export function chapterCrumb(chapters: Chapter[] | null, chapterId: number): string {
  const i = chapters?.findIndex((c) => c.id === chapterId) ?? -1;
  const ch = i >= 0 ? chapters?.[i] : undefined;
  return ch ? `Глава ${i + 1} · ${ch.title}` : "Глава";
}

export function breadcrumbs(
  route: RouteInfo,
  book: Book | null,
  chapters: Chapter[] | null,
  profileName: string | null,
): Crumb[] {
  const shelf: Crumb = { label: ROOM_LABELS.shelf, to: "/books" };
  const bookCrumb: Crumb | null =
    route.bookId !== undefined
      ? { label: book?.title ?? "…", to: `/books/${route.bookId}` }
      : null;
  switch (route.name) {
    case "shelf":
      return [{ label: ROOM_LABELS.shelf }];
    case "book": {
      const s = BOOK_SECTIONS.find((x) => x.id === route.section);
      return [shelf, bookCrumb!, { label: s?.label ?? "" }];
    }
    case "studio": {
      const stage = STAGE_LABELS[route.stage as keyof typeof STAGE_LABELS];
      return [
        shelf,
        bookCrumb!,
        { label: stage ? `${ROOM_LABELS.studio} · ${stage}` : ROOM_LABELS.studio },
      ];
    }
    case "chapter":
      return [shelf, bookCrumb!, { label: chapterCrumb(chapters, route.chapterId!) }];
    case "styles":
      return route.profileId !== undefined
        ? [
            { label: ROOM_LABELS.styles, to: "/style-profiles" },
            { label: profileName ?? "…" },
          ]
        : [{ label: ROOM_LABELS.styles }];
    case "costs":
      return [{ label: ROOM_LABELS.costs }];
    default:
      return [];
  }
}

const LAST_BOOK_KEY = "bf:last-book";

function readLastBook(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_BOOK_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function rememberBook(id: number): void {
  try {
    localStorage.setItem(LAST_BOOK_KEY, String(id));
  } catch {
    /* приватное окно — пункт «Книга» просто появится только внутри книги */
  }
}

/** Книга и её главы для крошек: одна загрузка на книгу, повтор — если
 *  открытой главы нет в списке (глава создана после загрузки). */
function useBookContext(route: RouteInfo) {
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const bookId = route.bookId;
  const missingChapter =
    route.chapterId !== undefined &&
    chapters !== null &&
    !chapters.some((c) => c.id === route.chapterId);

  useEffect(() => {
    if (bookId === undefined) {
      setBook(null);
      setChapters(null);
      return;
    }
    rememberBook(bookId);
    let alive = true;
    api
      .getBook(bookId)
      .then((b) => alive && setBook(b))
      .catch(() => alive && setBook(null));
    api
      .listChapters(bookId)
      .then((c) => alive && setChapters(c))
      .catch(() => alive && setChapters(null));
    return () => {
      alive = false;
    };
    // Переименование книги видно после перехода между разделами.
  }, [bookId, route.section, route.stage, missingChapter]);

  return { book, chapters };
}

function useProfileName(profileId: number | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (profileId === undefined) return setName(null);
    let alive = true;
    api
      .getStyleProfile(profileId)
      .then((p) => alive && setName(p.name))
      .catch(() => alive && setName(null));
    return () => {
      alive = false;
    };
  }, [profileId]);
  return name;
}

/** Оболочка: слева рейл на всю высоту, справа верхняя панель и комната. */
export function AppShell() {
  const { pathname } = useLocation();
  const route = parseRoute(pathname);
  const focused = useFocusMode();
  const atmosphere = useAtmosphere();
  const { book, chapters } = useBookContext(route);
  const profileName = useProfileName(route.profileId);

  useEffect(() => {
    applyAtmosphereClass();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" data-focus={focused ? "true" : "false"}>
      {/* Первая цель Tab: рейл и топбар — это несколько остановок перед
          содержимым на каждой странице. */}
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <LeftRail route={route} />
      <TopBar crumbs={breadcrumbs(route, book, chapters, profileName)} />
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {shouldShowDust(effectiveMode(atmosphere), route.name) && <DustLayer />}
    </div>
  );
}

/* ─── TopBar ────────────────────────────────────────────── */

function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <header className="topbar">
      <nav aria-label="Хлебные крошки" className="crumbs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="crumb">
              {i > 0 && (
                <span className="crumb-sep" aria-hidden="true">
                  /
                </span>
              )}
              {c.to && !last ? (
                <Link to={c.to} className="crumb-link" viewTransition>
                  {c.label}
                </Link>
              ) : (
                <span
                  className={`crumb-label ${last ? "strong" : ""}`}
                  {...(last ? { "aria-current": "page" as const } : {})}
                >
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      <div className="topbar-right">
        <JobIndicator />
        <SaveStatus />
        <CandleGauge />
        <AtmosphereLamp />
      </div>
    </header>
  );
}

function SaveStatus() {
  const save = useSaveStatus();
  if (save.kind === "idle") return null;
  const label =
    save.kind === "saving"
      ? "сохраняю…"
      : save.kind === "error"
        ? "не сохранено"
        : save.at
          ? `сохранено · ${new Date(save.at).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "сохранено";
  return (
    <span
      className={`topbar-save mono ${save.kind === "error" ? "topbar-save-err" : ""}`}
      role="status"
    >
      {label}
    </span>
  );
}

/* ─── LeftRail ──────────────────────────────────────────── */

const RailIcon = {
  shelf: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3" y="5" width="3" height="11" />
      <rect x="8.5" y="2.5" width="3" height="13.5" />
      <rect x="14" y="6.5" width="3" height="9.5" />
      <line x1="1" y1="17.5" x2="19" y2="17.5" />
    </svg>
  ),
  book: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="4" y="2.5" width="12" height="15" rx="1" />
      <line x1="7" y1="2.5" x2="7" y2="17.5" />
    </svg>
  ),
  styles: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <line x1="3" y1="5" x2="17" y2="5" />
      <line x1="3" y1="10" x2="14" y2="10" />
      <line x1="3" y1="15" x2="10" y2="15" />
    </svg>
  ),
  costs: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
    </svg>
  ),
};

function LeftRail({ route }: { route: RouteInfo }) {
  const bookId = route.bookId ?? readLastBook();
  const inBook =
    route.name === "book" || route.name === "studio" || route.name === "chapter";
  type Item = { id: keyof typeof RailIcon; label: string; to: string; active: boolean };
  const items: Item[] = [
    { id: "shelf", label: ROOM_LABELS.shelf, to: "/books", active: route.name === "shelf" },
  ];
  // «Книга» — текущая или последняя открытая; до первой книги пункта нет.
  if (bookId !== null) {
    items.push({ id: "book", label: ROOM_LABELS.book, to: `/books/${bookId}`, active: inBook });
  }
  items.push(
    { id: "styles", label: ROOM_LABELS.styles, to: "/style-profiles", active: route.name === "styles" },
    { id: "costs", label: ROOM_LABELS.costs, to: "/usage", active: route.name === "costs" },
  );
  return (
    <aside className="leftrail" aria-label="Главная навигация">
      <Link to="/books" className="leftrail-brand" aria-label="book-forge — на полку" viewTransition>
        b
      </Link>
      <nav className="leftrail-nav">
        {items.map((it) => (
          <Link
            key={it.id}
            to={it.to}
            className={`leftrail-item ${it.active ? "leftrail-item-active" : ""}`}
            aria-current={it.active ? "page" : undefined}
            viewTransition
          >
            <span className="leftrail-bar" aria-hidden="true" />
            {RailIcon[it.id]}
            <span className="leftrail-label">{it.label}</span>
          </Link>
        ))}
      </nav>
      <CatCompanion />
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
