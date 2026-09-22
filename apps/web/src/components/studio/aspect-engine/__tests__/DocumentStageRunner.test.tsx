import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageState } from "@book-forge/shared";

const streamDocumentMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    streamStageDocument: (...args: unknown[]) => streamDocumentMock(...args),
  };
});

import { DocumentStageRunner } from "../DocumentStageRunner.js";

function emptyStage(over: Partial<StageState> = {}): StageState {
  return { status: "not_started", playbookGenerated: false, aspects: [], ...over };
}

function renderRunner(stage: StageState) {
  const onPatch = vi.fn().mockImplementation(async (_rev: number, next: StageState) => ({
    stage: next,
    revision: 2,
  }));
  const onReloadStage = vi.fn().mockResolvedValue({ stage, revision: 2 });
  return {
    onPatch,
    onReloadStage,
    ...render(
      <DocumentStageRunner
        bookId={1}
        stageId="world"
        stageLabel="Мир"
        stage={stage}
        revision={1}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    ),
  };
}

describe("DocumentStageRunner", () => {
  beforeEach(() => {
    streamDocumentMock.mockReset();
    streamDocumentMock.mockImplementation(async (_b, _s, _body, handlers) => {
      handlers.onDone({
        sections: [
          { name: "география", description: "рельеф", markdown: "Город на сваях." },
          { name: "власть", description: "кто правит", markdown: "Правит совет." },
        ],
        contextRef: { hash: "h", summary: "s", includedAspectIds: [], includedEntityIds: [] },
        modelId: "sonnet",
      });
    });
  });

  it("собирает весь документ одним нажатием и одним ожиданием", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(emptyStage());
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(streamDocumentMock).toHaveBeenCalledTimes(1);
    const next = onPatch.mock.calls[0]?.[1] as StageState;
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects.every((a) => a.status === "reviewing")).toBe(true);
  });

  it("заметки автора уходят в сборку и сохраняются вместе с ней", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(emptyStage());
    await user.type(screen.getByLabelText(/заметки/i), "Без магии.");
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    const body = streamDocumentMock.mock.calls[0]?.[2] as { authorNotes?: string };
    expect(body.authorNotes).toBe("Без магии.");
    expect((onPatch.mock.calls[0]?.[1] as StageState).authorNotes).toBe("Без магии.");
  });

  it("сохранённые заметки показываются при открытии этапа", () => {
    renderRunner(emptyStage({ authorNotes: "Зима круглый год." }));
    expect(screen.getByLabelText(/заметки/i)).toHaveValue("Зима круглый год.");
  });

  it("заметки сохраняются по уходу с поля, а не только вместе со сборкой", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(emptyStage());
    const box = screen.getByLabelText(/заметки/i);
    await user.type(box, "Без магии.");
    fireEvent.blur(box);
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    expect((onPatch.mock.calls[0]?.[1] as StageState).authorNotes).toBe("Без магии.");
    // Сборка вызовом не тронута: это отдельная запись, не побочный эффект сборки.
    expect(streamDocumentMock).not.toHaveBeenCalled();
  });

  it("уход с поля без изменения текста ничего не пишет", () => {
    const { onPatch } = renderRunner(emptyStage({ authorNotes: "Было." }));
    const box = screen.getByLabelText(/заметки/i);
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("разделы с текстом уходят в сборку как неприкосновенные", async () => {
    const user = userEvent.setup();
    renderRunner(
      emptyStage({
        aspects: [
          {
            id: "a1",
            name: "власть",
            status: "accepted",
            order: 0,
            required: false,
            source: "import",
            payloadKind: "markdown",
            variants: [],
            finalPayload: "Правит совет старейшин.",
          },
          {
            id: "a2",
            name: "ремёсла",
            status: "pending",
            order: 1,
            required: false,
            source: "llm",
            payloadKind: "markdown",
            variants: [],
          },
        ],
      } as Partial<StageState>),
    );
    // Подпись кнопки зависит от состояния документа: здесь один раздел пуст,
    // и кнопка обязана обещать ровно то, что сделает.
    await user.click(
      screen.getByRole("button", { name: "Дописать недостающее (1)" }),
    );
    await waitFor(() => expect(streamDocumentMock).toHaveBeenCalled());
    const body = streamDocumentMock.mock.calls[0]?.[2] as {
      existingSections: Array<{ name: string; text: string }>;
      emptySectionNames: string[];
    };
    expect(body.existingSections).toEqual([
      { name: "власть", text: "Правит совет старейшин." },
    ]);
    expect(body.emptySectionNames).toEqual(["ремёсла"]);
  });

  it("кнопка обещает ровно то, что сделает", () => {
    const { unmount } = renderRunner(emptyStage());
    expect(screen.getByRole("button", { name: "Собрать мир" })).toBeInTheDocument();
    unmount();

    const filled = emptyStage({
      status: "in_progress",
      aspects: [
        {
          id: "a1",
          name: "власть",
          status: "accepted",
          order: 0,
          required: false,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
          finalPayload: "Правит совет.",
        },
      ],
    } as Partial<StageState>);
    renderRunner(filled);
    // Пустых разделов нет: «Собрать» обещало бы пересборку, которой не будет.
    expect(
      screen.getByRole("button", { name: "Дополнить документ" }),
    ).toBeInTheDocument();
  });

  it("конфликт ревизии при сборке не выбрасывает документ", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const stage = emptyStage();
    const onPatch = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementation(async (_r: number, next: StageState) => ({ stage: next, revision: 10 }));
    const onReloadStage = vi.fn().mockResolvedValue({ stage, revision: 9 });
    render(
      <DocumentStageRunner bookId={1} stageId="world" stageLabel="Мир" stage={stage}
        revision={1} onPatch={onPatch} onReloadStage={onReloadStage} />,
    );
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    // Второй раз — от свежей ревизии, и документ на месте.
    expect(onPatch.mock.calls[1]?.[0]).toBe(9);
    expect((onPatch.mock.calls[1]?.[1] as StageState).aspects).toHaveLength(2);
    expect(streamDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("конфликт при сборке не затирает раздел, заполненный за это время", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const stage = emptyStage();
    const fresh = emptyStage({
      status: "in_progress",
      aspects: [{
        id: "x1", name: "география", status: "accepted", order: 0, required: false,
        source: "llm", payloadKind: "markdown", variants: [], finalPayload: "Написано в другой вкладке.",
      }],
    } as Partial<StageState>);
    const onPatch = vi.fn().mockRejectedValueOnce(conflict)
      .mockImplementation(async (_r: number, next: StageState) => ({ stage: next, revision: 10 }));
    const onReloadStage = vi.fn().mockResolvedValue({ stage: fresh, revision: 9 });
    render(
      <DocumentStageRunner bookId={1} stageId="world" stageLabel="Мир" stage={stage}
        revision={1} onPatch={onPatch} onReloadStage={onReloadStage} />,
    );
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    const saved = onPatch.mock.calls[1]?.[1] as StageState;
    expect(saved.aspects.find((a) => a.name === "география")?.finalPayload)
      .toBe("Написано в другой вкладке.");
  });

  it("«Утвердить мир» принимает весь документ одним изменением", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(
      emptyStage({
        status: "in_progress",
        aspects: [
          {
            id: "a1",
            name: "география",
            status: "reviewing",
            order: 0,
            required: false,
            source: "llm",
            payloadKind: "markdown",
            variants: [
              {
                id: "v1",
                label: "документ",
                payloadKind: "markdown",
                payload: "Город на сваях.",
                status: "generated",
                editSource: "llm",
                generatedAt: "2026-09-22T00:00:00.000Z",
              },
            ],
          },
        ],
      } as Partial<StageState>),
    );
    await user.click(screen.getByRole("button", { name: "Утвердить мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const next = onPatch.mock.calls[0]?.[1] as StageState;
    expect(next.aspects[0]?.status).toBe("accepted");
    expect(next.aspects[0]?.finalPayload).toBe("Город на сваях.");
  });

  it("конфликт при утверждении утверждает свежий документ", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const stage = emptyStage({
      status: "in_progress",
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "reviewing",
          order: 0,
          required: false,
          source: "llm",
          payloadKind: "markdown",
          variants: [
            {
              id: "v1",
              label: "документ",
              payloadKind: "markdown",
              payload: "Город на сваях.",
              status: "generated",
              editSource: "llm",
              generatedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        },
      ],
    } as Partial<StageState>);
    const onPatch = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementation(async (_r: number, next: StageState) => ({
        stage: next,
        revision: 10,
      }));
    const onReloadStage = vi.fn().mockResolvedValue({ stage, revision: 9 });
    render(
      <DocumentStageRunner
        bookId={1}
        stageId="world"
        stageLabel="Мир"
        stage={stage}
        revision={1}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Утвердить мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    // Второй раз — от свежей ревизии, и документ утверждён, а не потерян.
    expect(onPatch.mock.calls[1]?.[0]).toBe(9);
    const saved = onPatch.mock.calls[1]?.[1] as StageState;
    expect(saved.aspects[0]?.status).toBe("accepted");
    expect(saved.aspects[0]?.finalPayload).toBe("Город на сваях.");
  });

  it("утверждать нечего — кнопка выключена", () => {
    renderRunner(emptyStage());
    expect(screen.getByRole("button", { name: "Утвердить мир" })).toBeDisabled();
  });

  it("обязательный пустой раздел получает отдельную формулировку", () => {
    renderRunner(
      emptyStage({
        status: "in_progress",
        aspects: [
          {
            id: "a1",
            name: "география",
            status: "reviewing",
            order: 0,
            required: true,
            source: "llm",
            payloadKind: "markdown",
            variants: [],
          },
        ],
      } as Partial<StageState>),
    );
    expect(
      screen.getByText(
        "Обязательных пустых разделов: 1 — этап не закроется, пока их не написать или не пометить «Не нужен».",
      ),
    ).toBeInTheDocument();
  });

  it("отказ сборки виден и не оставляет экран в «идёт сборка»", async () => {
    const user = userEvent.setup();
    streamDocumentMock.mockImplementation(async (_b, _s, _body, handlers) => {
      handlers.onError("модель недоступна");
    });
    const { onPatch } = renderRunner(emptyStage());
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("модель недоступна"),
    );
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Собрать мир" })).toBeEnabled();
  });

  it("конфликт ревизии не затирает чужую правку раздела", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const stage = emptyStage({
      status: "in_progress",
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "reviewing",
          order: 0,
          required: false,
          source: "llm",
          payloadKind: "markdown",
          variants: [
            {
              id: "v1",
              label: "документ",
              payloadKind: "markdown",
              payload: "Город на сваях.",
              status: "generated",
              editSource: "llm",
              generatedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        },
      ],
    } as Partial<StageState>);
    const onPatch = vi.fn().mockRejectedValueOnce(conflict);
    // Чужая версия ТОГО ЖЕ раздела: повторять поверх нельзя.
    const theirs = structuredClone(stage);
    theirs.aspects[0]!.name = "география (правил кто-то другой)";
    const onReloadStage = vi.fn().mockResolvedValue({ stage: theirs, revision: 9 });
    render(
      <DocumentStageRunner
        bookId={1}
        stageId="world"
        stageLabel="Мир"
        stage={stage}
        revision={1}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Править" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onReloadStage).toHaveBeenCalled());
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/изменили в другом месте/i);
  });
});
