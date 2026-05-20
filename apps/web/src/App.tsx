import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { BooksListPage } from "@/pages/BooksListPage";
import { BookRedirect } from "@/pages/BookRedirect";
import { ChapterPage } from "@/pages/ChapterPage";
import {
  StyleProfilesListPage,
  StyleProfilePage,
} from "@/pages/StyleProfilesPage";
import { UsagePage } from "@/pages/UsagePage";
import { StudioPage } from "@/pages/StudioPage";
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
import { EntityStagePage } from "@/pages/EntityStagePage";
import { ChaptersStagePage } from "@/pages/ChaptersStagePage";
import { SettingsStagePage } from "@/pages/SettingsStagePage";

function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  return <MarkdownStagePage />;
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/books" replace /> },
      { path: "/books", element: <BooksListPage /> },
      { path: "/books/:bookId", element: <BookRedirect /> },
      { path: "/books/:bookId/studio", element: <StudioPage /> },
      // Mounted before /studio/:stageId: static segments must not be shadowed
      // by the parametric dispatch.
      { path: "/books/:bookId/studio/chapters", element: <ChaptersStagePage /> },
      { path: "/books/:bookId/studio/settings", element: <SettingsStagePage /> },
      { path: "/books/:bookId/studio/:stageId", element: <StagePageDispatch /> },
      { path: "/books/:bookId/chapters/:chapterId", element: <ChapterPage /> },
      { path: "/style-profiles", element: <StyleProfilesListPage /> },
      { path: "/style-profiles/:profileId", element: <StyleProfilePage /> },
      { path: "/usage", element: <UsagePage /> },
      { path: "*", element: <p className="p-8">Не найдено</p> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
