import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
  Link,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { BooksListPage } from "@/pages/BooksListPage";
import { ChapterPage } from "@/pages/ChapterPage";
import {
  StyleProfilesListPage,
  StyleProfilePage,
} from "@/pages/StyleProfilesPage";
import { UsagePage } from "@/pages/UsagePage";
import { StudioPage } from "@/pages/StudioPage";
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
import { PlanStagePage } from "@/pages/PlanStagePage";
import { EntityStagePage } from "@/pages/EntityStagePage";
import { ChaptersStagePage } from "@/pages/ChaptersStagePage";
import { SettingsStagePage } from "@/pages/SettingsStagePage";
import { PlotBoardPage } from "@/pages/PlotBoardPage";
import { BookLayout } from "@/components/book/BookLayout";
import { BookOverviewPage } from "@/pages/book/BookOverviewPage";
import { BookChaptersPage } from "@/pages/book/BookChaptersPage";
import { BookCanonPage } from "@/pages/book/BookCanonPage";

function NotFound() {
  return (
    <main className="max-w-md mx-auto p-12 flex flex-col items-center text-center gap-4">
      <h1
        className="text-[28px] leading-tight text-[var(--color-text-strong)]"
        style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
      >
        Страница потерялась
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
        Возможно, её перенесли в другую главу. Вернёмся к началу?
      </p>
      <Link
        to="/books"
        className="btn btn-primary"
      >
        На полку
      </Link>
    </main>
  );
}

function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  // Этап сюжета сохранил идентификатор, но перестал быть markdown-аспектами:
  // его экран — план книги.
  if (stageId === "plot") {
    return <PlanStagePage />;
  }
  return <MarkdownStagePage />;
}

/** Старые адреса: настройки жили в Мастерской, заметки памяти — на «доске». */
function MovedTo({ section }: { section: string }) {
  const { bookId } = useParams<{ bookId: string }>();
  return <Navigate to={`/books/${bookId}/${section}`} replace />;
}

// OutlineRail lets the user jump chapter -> chapter without leaving this
// route (same path pattern, only :chapterId changes), so React Router does
// not unmount/remount ChapterPage on its own. That leaves the old chapter's
// debounce timer, Writer stream, and save-status state alive under the new
// URL. Keying on chapterId forces a real remount per chapter.
export function ChapterPageRoute() {
  const { chapterId } = useParams<{ chapterId: string }>();
  return <ChapterPage key={chapterId} />;
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/books" replace /> },
      { path: "/books", element: <BooksListPage /> },
      {
        // Дом книги: шапка, меню разделов, раздел.
        path: "/books/:bookId",
        element: <BookLayout />,
        children: [
          { index: true, element: <BookOverviewPage /> },
          { path: "chapters", element: <BookChaptersPage /> },
          { path: "canon", element: <BookCanonPage /> },
          { path: "memory", element: <PlotBoardPage /> },
          { path: "settings", element: <SettingsStagePage /> },
        ],
      },
      { path: "/books/:bookId/studio", element: <StudioPage /> },
      // Mounted before /studio/:stageId: static segments must not be shadowed
      // by the parametric dispatch.
      { path: "/books/:bookId/studio/chapters", element: <ChaptersStagePage /> },
      { path: "/books/:bookId/studio/settings", element: <MovedTo section="settings" /> },
      { path: "/books/:bookId/studio/:stageId", element: <StagePageDispatch /> },
      { path: "/books/:bookId/board", element: <MovedTo section="memory" /> },
      {
        path: "/books/:bookId/chapters/:chapterId",
        element: <ChapterPageRoute />,
      },
      { path: "/style-profiles", element: <StyleProfilesListPage /> },
      { path: "/style-profiles/:profileId", element: <StyleProfilePage /> },
      { path: "/usage", element: <UsagePage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
