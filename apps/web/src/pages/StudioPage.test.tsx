import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import { StudioPage } from "./StudioPage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";
import type { Book } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getConcept: vi.fn(),
    getBook: vi.fn(),
    getStudioState: vi.fn(),
    getStudioWarnings: vi.fn(),
    listChapters: vi.fn(),
    patchConcept: vi.fn(),
    refineConceptField: vi.fn(),
    generatePitches: vi.fn(),
    blendPitch: vi.fn(),
    lockConcept: vi.fn(),
    unlockConcept: vi.fn(),
    intake: vi.fn(),
    intakeStream: vi.fn(),
    cancelIntake: vi.fn(),
  },
}));

const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio"]}>
      <Routes>
        <Route path="/books/:bookId/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A promise this test can resolve on its own schedule, to model a slow or
 *  out-of-order network response. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeBook(id: number): Book {
  return {
    id,
    title: `Книга ${id}`,
    language: "ru",
    premise: null,
    outlineJson: null,
    styleProfileId: null,
    status: "draft",
    writerModel: "sonnet",
    plotModel: "sonnet",
    criticModel: "sonnet",
    writerProvider: "anthropic",
    writerLocalModel: null,
    authorNotes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function stateWithWorld(status: "complete" | "not_started") {
  const s = emptyStudioState();
  s.stages.world = { status, playbookGenerated: false, aspects: [] };
  return s;
}

describe("StudioPage — этап «Замысел»", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.listChapters.mockResolvedValue([] as never);
  });

  it("показывает полосу этапов с активным замыслом и без дашборда", async () => {
    m.getBook.mockResolvedValue(makeBook(3));
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    renderAt();
    const nav = await screen.findByRole("navigation", { name: "Этапы книги" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Замысел/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Замысел пропустить нельзя")).toBeInTheDocument();
    // Приём материалов и быстрый сбор переехали в дом книги.
    expect(screen.queryByLabelText("Приём материалов")).toBeNull();
    expect(screen.queryByLabelText("Быстрый сбор")).toBeNull();
  });

  it("не даёт позднему ответу прежней книги перетереть состояние новой", async () => {
    const state3 = deferred<ReturnType<typeof emptyStudioState>>();
    m.getBook.mockImplementation((id: number) => Promise.resolve(makeBook(id)));
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockImplementation(((id: number) =>
      id === 3 ? state3.promise : Promise.resolve(stateWithWorld("not_started"))) as never);

    render(
      <MemoryRouter initialEntries={["/books/3/studio"]}>
        <Routes>
          <Route
            path="/books/:bookId/studio"
            element={
              <>
                <Link to="/books/4/studio">К книге 4</Link>
                <StudioPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // Книга 3 ещё грузится; переходим на книгу 4 — StudioPage остаётся
    // смонтированной, меняется только :bookId.
    fireEvent.click(screen.getByRole("link", { name: "К книге 4" }));
    expect(await screen.findByRole("link", { name: /Мир.*не начат/ })).toBeInTheDocument();

    // Поздний ответ книги 3 (мир готов) приходит после книги 4.
    state3.resolve(stateWithWorld("complete"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByRole("link", { name: /Мир.*не начат/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("link", { name: /Мир.*готов/ })).toBeNull());
  });
});
