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
  /** Регрессия: шапка рукописи показывала order_index + 1 («Глава 21» для
      второй главы), номер должен браться из позиции в оглавлении. */
  it("reports the active chapter position", async () => {
    const seen: (number | null)[] = [];
    render(
      <MemoryRouter>
        <OutlineRail
          bookId={7}
          activeChapterId={2}
          collapsed={false}
          onActivePosition={(p) => seen.push(p)}
        />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /Туман/ });
    expect(seen.at(-1)).toBe(2);
  });

  it("reports null when the active chapter is not in the outline", async () => {
    const seen: (number | null)[] = [];
    render(
      <MemoryRouter>
        <OutlineRail
          bookId={7}
          activeChapterId={999}
          collapsed={false}
          onActivePosition={(p) => seen.push(p)}
        />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /Туман/ });
    expect(seen.at(-1)).toBeNull();
  });

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
