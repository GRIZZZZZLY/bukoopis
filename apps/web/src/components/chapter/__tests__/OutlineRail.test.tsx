import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OutlineRail } from "../OutlineRail";

vi.mock("@/api/client", () => ({
  api: {
    listChapters: vi.fn().mockResolvedValue([
      { id: 1, orderIndex: 0, title: "Начало", status: "final" },
      { id: 2, orderIndex: 1, title: "Туман", status: "draft" },
    ]),
  },
}));

function renderRail(active = 2) {
  return render(
    <MemoryRouter>
      <OutlineRail bookId={7} activeChapterId={active} collapsed={false} />
    </MemoryRouter>,
  );
}

describe("OutlineRail", () => {
  it("lists chapters as links with numbering", async () => {
    renderRail();
    const link = await screen.findByRole("link", { name: /Туман/ });
    expect(link).toHaveAttribute("href", "/books/7/chapters/2");
    expect(screen.getByRole("link", { name: /Начало/ })).toBeInTheDocument();
  });

  it("marks the active chapter", async () => {
    renderRail(2);
    const item = (await screen.findByRole("link", { name: /Туман/ })).closest("li");
    expect(item?.className).toContain("outline-item-active");
  });

  it("renders nothing while collapsed", async () => {
    render(
      <MemoryRouter>
        <OutlineRail bookId={7} activeChapterId={1} collapsed={true} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
