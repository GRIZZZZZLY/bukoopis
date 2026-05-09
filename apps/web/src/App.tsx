import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";
import { BooksListPage } from "@/pages/BooksListPage";
import { BookPage } from "@/pages/BookPage";
import { ChapterPage } from "@/pages/ChapterPage";
import {
  StyleProfilesListPage,
  StyleProfilePage,
} from "@/pages/StyleProfilesPage";
import { UsagePage } from "@/pages/UsagePage";
import { StudioPage } from "@/pages/StudioPage";
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
import { EntityStagePage } from "@/pages/EntityStagePage";

function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  return <MarkdownStagePage />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/books" replace />,
  },
  {
    path: "/books",
    element: <BooksListPage />,
  },
  {
    path: "/books/:bookId",
    element: <BookPage />,
  },
  {
    path: "/books/:bookId/studio",
    element: <StudioPage />,
  },
  {
    path: "/books/:bookId/studio/:stageId",
    element: <StagePageDispatch />,
  },
  {
    path: "/books/:bookId/chapters/:chapterId",
    element: <ChapterPage />,
  },
  {
    path: "/style-profiles",
    element: <StyleProfilesListPage />,
  },
  {
    path: "/style-profiles/:profileId",
    element: <StyleProfilePage />,
  },
  {
    path: "/usage",
    element: <UsagePage />,
  },
  {
    path: "*",
    element: <p className="p-8">Не найдено</p>,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
