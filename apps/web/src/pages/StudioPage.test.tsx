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
    patchConcept: vi.fn(),
    refineConceptField: vi.fn(),
    generatePitches: vi.fn(),
    blendPitch: vi.fn(),
    lockConcept: vi.fn(),
    unlockConcept: vi.fn(),
    intake: vi.fn(),
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function file(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function dropIntakeFile(name: string) {
  fireEvent.drop(screen.getByLabelText("Перетащите файлы с материалами"), {
    dataTransfer: { files: [file(name, "текст")], types: ["Files"] },
  });
}

const OK_INTAKE = {
  summary: [],
  ideaSet: false,
  chapters: [],
  failures: [],
  revision: 2,
};

describe("StudioPage progress", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows done count and a Продолжить link to the recommended stage", async () => {
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    m.getStudioWarnings.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByText(/Готово 0\/7/));
    const cont = screen.getByRole("link", { name: /Продолжить/ });
    expect(cont).toHaveAttribute("href", "/books/3/studio");
    expect(
      screen.getByRole("navigation", { name: "Этапы книги" }),
    ).toBeInTheDocument();
  });

  it("does not let a stale reload from a previous book overwrite a newer book's state", async () => {
    const book3 = deferred<Book>();
    m.getBook.mockImplementation((id: number) =>
      id === 3 ? book3.promise : Promise.resolve(makeBook(id)),
    );
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    m.getStudioWarnings.mockResolvedValue([] as never);

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

    // Book 3's getBook call is still pending — the page is on its loading
    // screen. Navigate to book 4 before it lands; StudioPage stays mounted
    // (same route, same component), only the :bookId param changes.
    fireEvent.click(screen.getByRole("link", { name: "К книге 4" }));
    await waitFor(() => expect(screen.getByText(/Книга 4/)).toBeInTheDocument());

    // Let book 3's stale response land after book 4 has already rendered.
    book3.resolve(makeBook(3));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText(/Книга 4/)).toBeInTheDocument();
    expect(screen.queryByText(/Книга 3/)).toBeNull();
  });

  it("does not let an older overlapping reload overwrite a fresher one", async () => {
    m.getBook.mockResolvedValue(makeBook(3));
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);

    const staleWarnings = deferred<never[]>();
    let warningsCall = 0;
    m.getStudioWarnings.mockImplementation(() => {
      warningsCall += 1;
      if (warningsCall === 1) return Promise.resolve([]); // initial page load
      if (warningsCall === 2) return staleWarnings.promise; // first intake — slow
      return Promise.resolve([
        { id: "fresh", severity: "info", message: "Свежее предупреждение" },
      ]); // second intake — fast
    });
    m.intake.mockResolvedValue(OK_INTAKE as never);

    renderAt();
    await waitFor(() => screen.getByText(/Готово 0\/7/));

    // First drop — its reload (call A) hangs on a slow warnings fetch.
    dropIntakeFile("Один.md");
    await waitFor(() => screen.getByText("Материалы разобраны"));

    // Dismiss the summary and drop again — its reload (call B) resolves fast,
    // while call A is still in flight (IntakePanel does not await onIntake).
    fireEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    dropIntakeFile("Два.md");
    await waitFor(() => screen.getByText("Свежее предупреждение"));

    // Now let call A's stale response land after call B already rendered.
    staleWarnings.resolve([
      { id: "stale", severity: "info", message: "Старое предупреждение" },
    ] as never);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Свежее предупреждение")).toBeInTheDocument();
    expect(screen.queryByText("Старое предупреждение")).toBeNull();
  });
});
