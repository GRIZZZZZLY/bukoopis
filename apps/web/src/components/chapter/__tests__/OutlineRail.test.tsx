import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  // Ожидание строится вокруг самой величины, а не вокруг появления ссылки.
  // Позицию сообщает эффект, а он в React 18 выполняется ПОСЛЕ отрисовки:
  // дождавшись ссылки, тест иногда успевал проверить значение до вызова
  // колбэка и падал без всякой причины в коде. Проверка, которая иногда
  // врёт, хуже отсутствующей.
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
    await waitFor(() => expect(seen.at(-1)).toBe(2));
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
    // Тут `null` — и ответ, и начальное состояние, поэтому одного значения
    // мало: ждём именно сообщения, отправленного ПОСЛЕ загрузки списка.
    await screen.findByRole("link", { name: /Туман/ });
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
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
    // Список грузится и в свёрнутом виде — номер главы нужен шапке рукописи.
    // Без ожидания загрузка приземлялась уже после конца теста, и React
    // ругался на состояние, изменённое вне act; следующий тест в файле
    // получал это предупреждение в нагрузку.
    await act(async () => {
      await Promise.resolve();
    });
  });
});
