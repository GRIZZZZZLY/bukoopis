import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

// OutlineRail lets the user navigate chapter -> chapter without leaving the
// /books/:bookId/chapters/:chapterId route. Without a remount key, React
// Router reuses the same ChapterPage instance across that navigation, which
// resurrects the old chapter's pending debounce-save timer, lets a stale
// Writer stream `onDone -> load()` overwrite the new chapter's content, and
// leaves stale lastSavedAt/saveError on screen. ChapterPageRoute (App.tsx)
// fixes this by keying ChapterPage on chapterId so React tears the old
// instance down and mounts a fresh one per chapter.
//
// This suite mocks ChapterPage with a mount/unmount probe so it never
// renders the real TipTap editor (cheap), and asserts the mount/unmount
// counts through a real navigation via react-router-dom.

const { mountSpy, unmountSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));

vi.mock("@/pages/ChapterPage", () => ({
  ChapterPage: function MockChapterPage() {
    useEffect(() => {
      mountSpy();
      return () => unmountSpy();
    }, []);
    return <div data-testid="chapter-page-probe" />;
  },
}));

import { ChapterPage } from "@/pages/ChapterPage";
import { ChapterPageRoute } from "./App";

function Nav({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

// Control group: mirrors the pre-fix route element (no `key`). Used to prove
// the mechanism — without a remount key, react-router reuses the element
// across a param-only navigation and the probe never unmounts/remounts.
function ChapterPageRouteWithoutKey() {
  return <ChapterPage />;
}

describe("ChapterPageRoute", () => {
  it("remounts ChapterPage when chapterId changes via in-app navigation", () => {
    render(
      <MemoryRouter initialEntries={["/books/1/chapters/1"]}>
        <Routes>
          <Route
            path="/books/:bookId/chapters/:chapterId"
            element={<ChapterPageRoute />}
          />
        </Routes>
        <Nav to="/books/1/chapters/2" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("chapter-page-probe")).toBeInTheDocument();
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(unmountSpy).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByText("go"));

    // A real remount: old instance's cleanup ran, a new instance mounted.
    expect(unmountSpy).toHaveBeenCalledTimes(1);
    expect(mountSpy).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("control: without a key, navigating between chapters does NOT remount", () => {
    mountSpy.mockClear();
    unmountSpy.mockClear();

    render(
      <MemoryRouter initialEntries={["/books/1/chapters/1"]}>
        <Routes>
          <Route
            path="/books/:bookId/chapters/:chapterId"
            element={<ChapterPageRouteWithoutKey />}
          />
        </Routes>
        <Nav to="/books/1/chapters/2" />
      </MemoryRouter>,
    );

    expect(mountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("go"));

    // This is the bug the fix addresses: same component instance survives
    // the navigation, so its old debounce timer / stream callbacks live on
    // under the new URL.
    expect(unmountSpy).toHaveBeenCalledTimes(0);
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });
});
