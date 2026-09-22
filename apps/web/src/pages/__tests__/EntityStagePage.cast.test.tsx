import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/** F22 ревью 2026-09-22: имена состава читались один раз при открытии этапа,
 *  и после «Добавить в канон» проверка различий видела ноль героев до
 *  перезагрузки страницы. */

vi.mock("@/api/client", () => ({
  api: {
    listCharacters: vi.fn(),
    getStudioState: vi.fn(),
    getConcept: vi.fn(),
    materializeEntitySet: vi.fn(),
  },
}));
vi.mock("@/components/studio/aspect-engine/EntityStageRunner", () => ({
  EntityStageRunner: (p: { onMaterialize: (id: string, body: unknown) => Promise<unknown> }) => (
    <button onClick={() => void p.onMaterialize("a1", {})}>материализовать</button>
  ),
}));
vi.mock("@/components/studio/CastCheckPanel", () => ({
  CastCheckPanel: (p: { characterCount: number }) => <p>героев: {p.characterCount}</p>,
}));

import { api } from "@/api/client";
import { EntityStagePage } from "../EntityStagePage";

describe("EntityStagePage — состав после материализации", () => {
  it("перечитывает состав, и проверка различий видит новых героев", async () => {
    vi.mocked(api.listCharacters)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValue([
        { id: 1, canonicalName: "Альфа" },
        { id: 2, canonicalName: "Бета" },
      ] as never);
    vi.mocked(api.getStudioState).mockResolvedValue({
      revision: 1,
      stages: {
        characters: { status: "in_progress", aspects: [{ id: "a1", name: "Герои" }] },
      },
    } as never);
    vi.mocked(api.getConcept).mockResolvedValue({} as never);
    vi.mocked(api.materializeEntitySet).mockResolvedValue({} as never);

    render(
      <MemoryRouter initialEntries={["/books/7/studio/characters"]}>
        <Routes>
          <Route path="/books/:bookId/studio/:stageId" element={<EntityStagePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("героев: 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "материализовать" }));
    expect(await screen.findByText("героев: 2")).toBeInTheDocument();
  });
});
