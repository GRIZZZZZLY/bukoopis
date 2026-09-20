import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CastCheckPanel } from "../CastCheckPanel";
import type { CastCheckReport } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: { getCastCheck: vi.fn(), runCastCheck: vi.fn() },
}));

import { api } from "@/api/client";

/**
 * Отчёт — предложение, а не правка. Панель обязана показывать, что он описывает
 * уже не тех героев, иначе он стареет молча (ТЗ 9.1).
 */

const REPORT: CastCheckReport = {
  generatedAt: "2026-09-20T10:00:00.000Z",
  basis: [
    { characterId: 7, revision: 1 },
    { characterId: 9, revision: 0 },
  ],
  pairs: [
    {
      characterIds: [7, 9],
      similarity: "оба уходят от прямого ответа",
      basis: "совпадают принципы и голос",
      situations: ["request_for_help", "mistake"],
      directions: ["дать Ворту физическое действие вместо паузы"],
      keep: "сама пауза работает",
    },
  ],
  notes: "Остальные различимы",
};

const NAMES = new Map([
  [7, "Нина Соловьёва"],
  [9, "Ворт Соловьёв"],
]);

beforeEach(() => {
  vi.mocked(api.getCastCheck).mockReset();
  vi.mocked(api.runCastCheck).mockReset();
});

function renderPanel() {
  render(<CastCheckPanel bookId={1} names={NAMES} characterCount={2} />);
}

describe("CastCheckPanel", () => {
  it("показывает пару именами, основание, ситуации и что сохранить", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: REPORT, stale: false });
    renderPanel();
    expect(await screen.findByText(/Нина Соловьёва/)).toBeInTheDocument();
    expect(screen.getByText(/Ворт Соловьёв/)).toBeInTheDocument();
    expect(screen.getByText(/совпадают принципы и голос/)).toBeInTheDocument();
    expect(screen.getByText(/просьба о помощи/)).toBeInTheDocument();
    expect(screen.getByText(/сама пауза работает/)).toBeInTheDocument();
  });

  it("называет направления предложениями, а не правками", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: REPORT, stale: false });
    renderPanel();
    expect(await screen.findByText(/Можно развести/)).toBeInTheDocument();
    expect(screen.getByText(/дать Ворту физическое действие/)).toBeInTheDocument();
  });

  it("устаревший отчёт помечен", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: REPORT, stale: true });
    renderPanel();
    expect(await screen.findByText(/состав изменился/i)).toBeInTheDocument();
  });

  it("свежий отчёт этой пометки не несёт", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: REPORT, stale: false });
    renderPanel();
    await screen.findByText(/совпадают принципы/);
    expect(screen.queryByText(/состав изменился/i)).not.toBeInTheDocument();
  });

  it("пустой список пар — это результат, а не пустота", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({
      report: { ...REPORT, pairs: [] },
      stale: false,
    });
    renderPanel();
    expect(await screen.findByText(/взаимозаменяемых пар не нашлось/i)).toBeInTheDocument();
  });

  it("кнопка запускает проверку и показывает свежий отчёт", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: null, stale: false });
    vi.mocked(api.runCastCheck).mockResolvedValue({
      report: REPORT,
      stale: false,
      droppedPairs: 0,
    });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /Проверить различия/ }));
    expect(api.runCastCheck).toHaveBeenCalledWith(1);
    expect(await screen.findByText(/совпадают принципы и голос/)).toBeInTheDocument();
  });

  it("на одном герое кнопка недоступна: сравнивать не с кем", async () => {
    vi.mocked(api.getCastCheck).mockResolvedValue({ report: null, stale: false });
    render(<CastCheckPanel bookId={1} names={NAMES} characterCount={1} />);
    expect(await screen.findByRole("button", { name: /Проверить различия/ })).toBeDisabled();
  });
});
