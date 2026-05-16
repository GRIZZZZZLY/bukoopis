import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BookRedirect } from "./BookRedirect";

describe("BookRedirect", () => {
  it("redirects /books/:id to /books/:id/studio", () => {
    render(
      <MemoryRouter initialEntries={["/books/7"]}>
        <Routes>
          <Route path="/books/:bookId" element={<BookRedirect />} />
          <Route
            path="/books/:bookId/studio"
            element={<div>STUDIO DASHBOARD</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("STUDIO DASHBOARD")).toBeInTheDocument();
  });
});
