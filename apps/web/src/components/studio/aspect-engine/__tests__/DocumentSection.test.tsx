import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect } from "@book-forge/shared";
import { DocumentSection } from "../DocumentSection.js";
import type { VariantGenerator } from "../types.js";

function aspect(over: Partial<StageAspect> = {}): StageAspect {
  return {
    id: "a1",
    name: "география",
    description: "рельеф и климат",
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
        payload: "Город стоит на сваях.",
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ],
    ...over,
  } as StageAspect;
}

function renderSection(over: Partial<StageAspect> = {}, gen?: VariantGenerator<string>) {
  const onPatchAspect = vi.fn().mockResolvedValue(true);
  const generator: VariantGenerator<string> = gen ?? { generate: vi.fn() };
  render(
    <DocumentSection
      aspect={aspect(over)}
      busy={false}
      generator={generator}
      accumulated={{ acceptedAspects: [] }}
      onPatchAspect={onPatchAspect}
      onBusy={vi.fn()}
      onError={vi.fn()}
      onProgress={vi.fn()}
    />,
  );
  return { onPatchAspect, generator };
}

describe("DocumentSection", () => {
  it("показывает текст раздела как текст, а не исходником", () => {
    renderSection({
      variants: [
        {
          id: "v1",
          label: "документ",
          payloadKind: "markdown",
          payload: "## Климат\n\nЗима круглый год.",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-09-22T00:00:00.000Z",
        },
      ],
    } as Partial<StageAspect>);
    expect(screen.getByText("Климат")).toBeInTheDocument();
    expect(screen.queryByText(/^## Климат/)).not.toBeInTheDocument();
  });

  it("правка сохраняется как принятый текст автора", async () => {
    const user = userEvent.setup();
    const { onPatchAspect } = renderSection();
    await user.click(screen.getByRole("button", { name: "Править" }));
    const box = screen.getByLabelText("Текст раздела «география»");
    await user.clear(box);
    await user.type(box, "Мой собственный текст.");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.status).toBe("accepted");
    expect(next.finalPayload).toBe("Мой собственный текст.");
    expect(next.variants.at(-1)?.editSource).toBe("manual");
  });

  it("редактор не закрывается, когда запись не прошла", async () => {
    const user = userEvent.setup();
    const onPatchAspect = vi.fn().mockResolvedValue(false);
    render(
      <DocumentSection
        aspect={aspect()}
        busy={false}
        generator={{ generate: vi.fn() }}
        accumulated={{ acceptedAspects: [] }}
        onPatchAspect={onPatchAspect}
        onBusy={vi.fn()}
        onError={vi.fn()}
        onProgress={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Править" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    // Текст автора — единственная его копия: окно остаётся открытым.
    expect(screen.getByLabelText("Текст раздела «география»")).toBeInTheDocument();
  });

  it("«Переписать» просит указание и шлёт его в refine", async () => {
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue([
      {
        id: "v2",
        label: "переписано",
        payloadKind: "markdown",
        payload: "Новый текст.",
        status: "generated",
        editSource: "refine",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const { onPatchAspect } = renderSection({}, { generate });
    await user.click(screen.getByRole("button", { name: "Переписать" }));
    await user.type(screen.getByLabelText("Что поменять в разделе «география»"), "мрачнее");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => expect(generate).toHaveBeenCalled());
    const input = generate.mock.calls[0]?.[0] as { refineFrom?: { instructions: string } };
    expect(input.refineFrom?.instructions).toBe("мрачнее");
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    // Прежний текст становится вытесненным, а не исчезает.
    expect(next.variants.find((v) => v.id === "v1")?.status).toBe("superseded");
  });

  it("«Другие варианты» на утверждённом разделе снимает прежний принятый текст", async () => {
    // Иначе sectionText показывает старый finalPayload поверх только что
    // сгенерированного варианта, а список рядом называет показанным другой.
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue([
      {
        id: "v2",
        label: "морской",
        payloadKind: "markdown",
        payload: "Новый вариант.",
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const { onPatchAspect } = renderSection(
      {
        status: "accepted",
        finalPayload: "Старый принятый текст.",
        selectedVariantId: "v1",
      } as Partial<StageAspect>,
      { generate },
    );
    await user.click(screen.getByRole("button", { name: "Другие варианты" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.status).toBe("reviewing");
    expect(next.finalPayload).toBeUndefined();
  });

  it("правка вытесняет показанный вариант, даже когда выбор не записан", async () => {
    const user = userEvent.setup();
    const { onPatchAspect } = renderSection();
    await user.click(screen.getByRole("button", { name: "Править" }));
    const box = screen.getByLabelText("Текст раздела «география»");
    await user.clear(box);
    await user.type(box, "Мой текст.");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.variants.find((v) => v.id === "v1")?.status).toBe("superseded");
    expect(next.variants.at(-1)?.parentVariantId).toBe("v1");
  });

  it("«Другие варианты» кладёт альтернативы рядом и даёт выбрать", async () => {
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue([
      {
        id: "v2",
        label: "морской",
        payloadKind: "markdown",
        payload: "Вариант про море.",
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const { onPatchAspect } = renderSection({}, { generate });
    await user.click(screen.getByRole("button", { name: "Другие варианты" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.variants).toHaveLength(2);
    expect(next.status).toBe("reviewing");
  });

  it("пропущенный раздел свёрнут и возвращается одной кнопкой", async () => {
    const user = userEvent.setup();
    const { onPatchAspect } = renderSection({ status: "skipped" });
    expect(screen.queryByText("Город стоит на сваях.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть раздел" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    expect((onPatchAspect.mock.calls[0]?.[1] as StageAspect).status).toBe("reviewing");
  });

  it("пустой раздел говорит об этом прямо", () => {
    renderSection({ status: "pending", variants: [] });
    expect(screen.getByText(/пуст/i)).toBeInTheDocument();
  });
});
