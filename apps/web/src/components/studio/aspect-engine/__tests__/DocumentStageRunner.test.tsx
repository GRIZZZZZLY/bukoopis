import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  return { onPatch, onReloadStage };
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
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
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

  it("утверждать нечего — кнопка выключена", () => {
    renderRunner(emptyStage());
    expect(screen.getByRole("button", { name: "Утвердить мир" })).toBeDisabled();
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
