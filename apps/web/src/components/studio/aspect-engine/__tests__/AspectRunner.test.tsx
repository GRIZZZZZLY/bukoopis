import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { AspectRunner } from "../AspectRunner";
import { createMarkdownAdapter } from "../markdownAdapter";
import { createMockMarkdownGenerator } from "../mockGenerator";

const adapter = createMarkdownAdapter("world");
const generator = createMockMarkdownGenerator();
const generateSpy = vi.spyOn(generator, "generate");

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: true,
    source: "system",
    payloadKind: "markdown",
    variants: [],
    ...partial,
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return {
    status: "in_progress",
    playbookGenerated: true,
    aspects,
  };
}

beforeEach(() => {
  generateSpy.mockClear();
});

describe("AspectRunner", () => {
  it("shows a progress bar while generating markdown variants", async () => {
    let release: (() => void) | undefined;
    // Только на один вызов: beforeEach делает mockClear, который implementation
    // не снимает, и «висящий» промис протёк бы в остальные тесты.
    generateSpy.mockImplementationOnce(
      ((_input: unknown, onProgress?: (p: unknown) => void) => {
        onProgress?.({
          phase: "writing",
          pct: 55,
          attempt: 1,
          maxAttempts: 4,
          elapsedMs: 41_000,
          attemptElapsedMs: 41_000,
          attemptTimeoutMs: 180_000,
          estimateMs: 75_000,
        });
        return new Promise((resolve) => {
          release = () => resolve([]);
        });
      }) as never,
    );
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "55");
    expect(screen.getByText(/Модель пишет ответ/)).toBeInTheDocument();
    expect(screen.getByText(/55% · 41 c/)).toBeInTheDocument();

    release?.();
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
  });

  it("shows empty state when stage has no aspects", () => {
    render(
      <AspectRunner
        stage={makeStage([])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByText(/пока нет разделов/i)).toBeInTheDocument();
  });

  it("pending aspect shows Generate + Skip buttons", () => {
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Пропустить/ }),
    ).toBeInTheDocument();
  });

  it("clicking Generate calls generator and patches with reviewing+variants", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={3}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [rev, next] = onPatch.mock.calls[0]!;
    expect(rev).toBe(3);
    expect(next.aspects[0]!.status).toBe("reviewing");
    expect(next.aspects[0]!.variants).toHaveLength(2);
  });

  it("clicking Принять on a reviewing aspect patches with accepted+finalPayload", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Variant payload one",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "Variant payload two",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    const acceptButtons = screen.getAllByRole("button", { name: /Принять/ });
    await userEvent.click(acceptButtons[0]!);
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.selectedVariantId).toBe("v1");
    expect(next.aspects[0]!.finalPayload).toBe("Variant payload one");
    expect(next.aspects[0]!.variants[0]!.status).toBe("accepted");
  });

  it("clicking Skip on pending patches with status=skipped", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Пропустить/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![1].aspects[0]!.status).toBe("skipped");
  });

  it("accepted aspect renders renderFinal and Edit/Delete buttons", () => {
    const acceptedAspect = makeAspect({
      status: "accepted",
      selectedVariantId: "v1",
      finalPayload: "Окончательный текст об острове",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Окончательный текст об острове",
          status: "accepted",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Окончательный текст об острове/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Выбрать другой вариант/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Пропустить раздел/ }),
    ).toBeInTheDocument();
  });

  it("reopening an accepted aspect keeps its text instead of dropping it", async () => {
    const onPatch = vi.fn().mockResolvedValue({ stage: makeStage([]), revision: 2 });
    const acceptedAspect = makeAspect({
      status: "accepted",
      selectedVariantId: "v1",
      finalPayload: "Окончательный текст об острове",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Окончательный текст об острове",
          status: "accepted",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Выбрать другой вариант/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const patched = onPatch.mock.calls[0]![1] as StageState;
    const aspect = patched.aspects[0]!;
    expect(aspect.status).toBe("reviewing");
    expect(aspect.finalPayload).toBe("Окончательный текст об острове");
    expect(aspect.selectedVariantId).toBe("v1");
  });

  it("Перегенерировать calls generator a second time", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "p1",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "p2",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Перегенерировать/ }),
    );
    await waitFor(() => expect(generateSpy).toHaveBeenCalled());
  });

  it("error from onPatch shows inline alert", async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });

  it("clicking '✏️ Уточнить' opens inline refine form", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Variant payload one",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Уточнить/ }),
    );
    expect(screen.getByLabelText(/refine-instructions-v1/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Применить/ }),
    ).toBeInTheDocument();
  });

  it("marks an aspect that came from the author's own material", () => {
    const importedAspect = makeAspect({
      id: "imported",
      name: "Карта",
      status: "reviewing",
      order: 0,
      required: false,
      source: "import",
      variants: [
        {
          id: "v1",
          label: "из ваших материалов",
          payloadKind: "markdown",
          payload: "Барьер делит два мира.",
          status: "generated",
          editSource: "manual",
          generatedAt: "2026-09-05T10:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([importedAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    // The variant itself is also labelled "из ваших материалов" (that is how
    // imported drafts arrive), so the pill is queried by its own class —
    // otherwise this assertion would pass on the variant label alone and
    // never actually exercise the marker next to the aspect's name.
    expect(
      screen.getByText("из ваших материалов", { selector: "span.pill" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Барьер делит два мира.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Принять/ })).toBeEnabled();
  });

  it("submitting refine calls generator with refineFrom and patches with new variant + superseded parent", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "исходный текст для рефайна",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Уточнить/ }));
    await userEvent.type(
      screen.getByLabelText(/refine-instructions-v1/),
      "сделай мрачнее",
    );
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const callArg = generateSpy.mock.calls[0]![0];
    expect(callArg.refineFrom).toBeDefined();
    expect(callArg.refineFrom!.variantId).toBe("v1");
    expect(callArg.refineFrom!.instructions).toBe("сделай мрачнее");
    const [, next] = onPatch.mock.calls[0]!;
    // mockGenerator returns 2 variants — so total = parent (superseded) + 2 new = 3
    expect(next.aspects[0]!.variants).toHaveLength(3);
    expect(next.aspects[0]!.variants[0]!.status).toBe("superseded");
  });
});

/** В11 независимого ревью 2026-09-19: неудачное сохранение правки закрывало
 *  редактор и стирало набранный текст, а конфликт ревизии (автор принял
 *  соседний раздел, пока шла генерация) выбрасывал сгенерированные варианты
 *  вместе с платным вызовом. */
describe("AspectRunner — сохранность авторской работы (В11)", () => {
  function acceptedAspect(): StageAspect {
    return makeAspect({
      status: "accepted",
      finalPayload: "Принятый текст раздела.",
      selectedVariantId: "v1",
      variants: [
        {
          id: "v1",
          label: "вариант",
          payloadKind: "markdown",
          payload: "Принятый текст раздела.",
          status: "accepted",
          editSource: "llm",
          generatedAt: "2026-09-19T00:00:00.000Z",
        },
      ],
    });
  }

  it("неудачное сохранение правки оставляет редактор открытым и текст на месте", async () => {
    const onPatch = vi.fn(async () => {
      throw new Error("сеть отвалилась");
    });
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Редактировать текст" }),
    );
    const area = screen.getByRole("textbox", { name: /Текст раздела/ });
    await userEvent.clear(area);
    await userEvent.type(area, "Долгая авторская правка");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить правку" }));

    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    // Редактор не закрылся, текст не стёрт — иначе правку пришлось бы
    // набирать заново, и это единственная её копия.
    expect(
      (screen.getByRole("textbox", { name: /Текст раздела/ }) as HTMLTextAreaElement).value,
    ).toBe("Долгая авторская правка");
    expect(screen.getByText(/сеть отвалилась/)).toBeTruthy();
  });

  it("удачное сохранение правки редактор закрывает", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Редактировать текст" }),
    );
    const area = screen.getByRole("textbox", { name: /Текст раздела/ });
    await userEvent.clear(area);
    await userEvent.type(area, "Новая редакция");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить правку" }));

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Текст раздела/ })).toBeNull(),
    );
  });

  it("конфликт ревизии не выбрасывает работу: правка ложится на свежее состояние", async () => {
    const conflict = Object.assign(new Error("revision_conflict"), { status: 409 });
    const onPatch = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementation(async (rev: number, next: StageState) => ({
        stage: next,
        revision: rev + 1,
      }));
    // Свежее состояние: соседний раздел приняли, пока автор правил этот.
    const freshStage = makeStage([
      acceptedAspect(),
      makeAspect({ id: "a2", name: "климат", status: "accepted", finalPayload: "Климат." }),
    ]);
    const onReloadStage = vi.fn(async () => ({ stage: freshStage, revision: 7 }));

    render(
      <AspectRunner
        stage={makeStage([acceptedAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Редактировать текст" }),
    );
    const area = screen.getByRole("textbox", { name: /Текст раздела/ });
    await userEvent.clear(area);
    await userEvent.type(area, "Правка поверх конфликта");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить правку" }));

    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    expect(onReloadStage).toHaveBeenCalledTimes(1);
    // Повтор идёт с новой ревизией и несёт ОБА раздела: соседний, принятый
    // за это время, не потерян.
    const [rev, next] = onPatch.mock.calls[1] as [number, StageState];
    expect(rev).toBe(7);
    expect(next.aspects.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(next.aspects[0]!.finalPayload).toBe("Правка поверх конфликта");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Текст раздела/ })).toBeNull(),
    );
  });

  it("конфликт по ЭТОМУ же разделу не затирает чужую правку", async () => {
    const conflict = Object.assign(new Error("revision_conflict"), { status: 409 });
    const onPatch = vi.fn().mockRejectedValueOnce(conflict);
    // Свежее состояние: этот самый раздел переписан за это время — вторая
    // вкладка или быстрый сбор. Молча положить поверх значит стереть работу.
    const freshStage = makeStage([
      makeAspect({
        id: "a1",
        name: "география",
        status: "accepted",
        finalPayload: "Чужая редакция.",
      }),
    ]);
    const onReloadStage = vi.fn(async () => ({ stage: freshStage, revision: 7 }));

    render(
      <AspectRunner
        stage={makeStage([acceptedAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Редактировать текст" }),
    );
    const area = screen.getByRole("textbox", { name: /Текст раздела/ });
    await userEvent.clear(area);
    await userEvent.type(area, "Моя правка");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить правку" }));

    await waitFor(() => expect(onReloadStage).toHaveBeenCalledTimes(1));
    // Второй записи нет, и окно правки открыто: текст автора при нём.
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: /Текст раздела/ })).toBeTruthy();
  });
});
