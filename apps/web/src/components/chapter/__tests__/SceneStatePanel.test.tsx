import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SceneStatePanel } from "../SceneStatePanel";
import type { SceneState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getSceneState: vi.fn(),
    saveSceneState: vi.fn(),
    recomputeSceneState: vi.fn(),
  },
}));

import { api } from "@/api/client";

const STATE: SceneState = {
  place: "причал",
  timeMarker: "поздний вечер",
  present: ["Нина — у воды"],
  appearance: [],
  carried: [{ name: "Нина", value: "ключ от склада" }],
  condition: [],
  surroundings: [],
  loose: [],
  changes: [],
};

beforeEach(() => {
  vi.mocked(api.getSceneState).mockReset();
  vi.mocked(api.saveSceneState).mockReset();
  vi.mocked(api.recomputeSceneState).mockReset();
});

describe("SceneStatePanel", () => {
  it("печатает только заполненные группы", async () => {
    vi.mocked(api.getSceneState).mockResolvedValue({
      chapterId: 1,
      versionId: 7,
      state: STATE,
      origin: "llm",
      updatedAt: null,
      carry: null,
    });
    render(<SceneStatePanel chapterId={1} />);

    expect(await screen.findByText(/причал/)).toBeTruthy();
    expect(screen.getByText(/ключ от склада/)).toBeTruthy();
    // Пустые группы не рисуются: заголовок без строк читается как «ничего нет».
    expect(screen.queryByText("Осталось незакрытым")).toBeNull();
  });

  it("анкеты нет — говорит об этом, а не рисует пустые поля", async () => {
    vi.mocked(api.getSceneState).mockResolvedValue({
      chapterId: 1,
      versionId: null,
      state: null,
      origin: null,
      updatedAt: null,
      carry: null,
    });
    render(<SceneStatePanel chapterId={1} />);
    expect(await screen.findByText(/Анкеты нет/)).toBeTruthy();
  });

  it("правка сохраняется строками «Имя: что»", async () => {
    vi.mocked(api.getSceneState).mockResolvedValue({
      chapterId: 1,
      versionId: 7,
      state: STATE,
      origin: "llm",
      updatedAt: null,
      carry: null,
    });
    vi.mocked(api.saveSceneState).mockResolvedValue({ chapterId: 1, state: STATE });
    render(<SceneStatePanel chapterId={1} />);

    await userEvent.click(await screen.findByRole("button", { name: "Править" }));
    const carried = screen.getByDisplayValue("Нина: ключ от склада");
    await userEvent.clear(carried);
    await userEvent.type(carried, "Нина: чужой телефон");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.saveSceneState).toHaveBeenCalled());
    const [, sent] = vi.mocked(api.saveSceneState).mock.calls[0]!;
    expect(sent.carried).toEqual([{ name: "Нина", value: "чужой телефон" }]);
  });

  it("правка с прежней версии предлагается к переносу и уходит одной кнопкой", async () => {
    vi.mocked(api.getSceneState)
      .mockResolvedValueOnce({
        chapterId: 1,
        versionId: 8,
        state: null,
        origin: null,
        updatedAt: null,
        carry: { state: STATE, versionId: 7, updatedAt: "2026-09-21T00:00:00.000Z" },
      })
      .mockResolvedValue({
        chapterId: 1,
        versionId: 8,
        state: STATE,
        origin: "manual",
        updatedAt: null,
        carry: null,
      });
    vi.mocked(api.saveSceneState).mockResolvedValue({ chapterId: 1, state: STATE });
    render(<SceneStatePanel chapterId={1} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Перенести мою правку" }),
    );
    await waitFor(() => expect(api.saveSceneState).toHaveBeenCalledWith(1, STATE));
    // После переноса предлагать нечего, а анкета на месте и помечена авторской.
    expect(await screen.findByText(/перенесена/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Перенести мою правку" })).toBeNull(),
    );
  });

  it("«Пересчитать» снимает анкету с экрана и говорит, что считается", async () => {
    vi.mocked(api.getSceneState).mockResolvedValue({
      chapterId: 1,
      versionId: 7,
      state: STATE,
      origin: "manual",
      updatedAt: null,
      carry: null,
    });
    vi.mocked(api.recomputeSceneState).mockResolvedValue({
      chapterId: 1,
      versionId: 7,
      enqueued: true,
    });
    render(<SceneStatePanel chapterId={1} />);

    await userEvent.click(await screen.findByRole("button", { name: "Пересчитать" }));
    await waitFor(() => expect(api.recomputeSceneState).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Считается/)).toBeTruthy();
  });
});
