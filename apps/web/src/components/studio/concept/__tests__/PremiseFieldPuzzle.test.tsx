import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PremiseFieldPuzzle } from "../PremiseFieldPuzzle";

interface Variant {
  id: string;
  label: string;
  payload: string;
}

interface ApiShape {
  variants: Variant[];
}

const fakeRefine = vi.fn<
  (field: string, draft?: string) => Promise<ApiShape>
>();

beforeEach(() => {
  fakeRefine.mockReset();
});

describe("PremiseFieldPuzzle", () => {
  it("renders textarea with current value and a Generate button", () => {
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value="мой черновик"
        onChange={() => {}}
        onRefine={fakeRefine}
        useTextarea
      />,
    );
    expect(screen.getByDisplayValue("мой черновик")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Другие формулировки/ }),
    ).toBeInTheDocument();
  });

  it("Generate calls onRefine with field + current value as draft", async () => {
    fakeRefine.mockResolvedValue({
      variants: [
        { id: "v1", label: "героическая", payload: "Героический вариант" },
        { id: "v2", label: "тёмная", payload: "Тёмный вариант" },
      ],
    });
    render(
      <PremiseFieldPuzzle
        label="Протагонист"
        field="protagonist"
        value="черновик"
        onChange={() => {}}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Другие формулировки/ }),
    );
    await waitFor(() =>
      expect(fakeRefine).toHaveBeenCalledWith("protagonist", "черновик"),
    );
    expect(screen.getByText("Героический вариант")).toBeInTheDocument();
    expect(screen.getByText("Тёмный вариант")).toBeInTheDocument();
  });

  it("clicking a variant calls onChange with payload and clears variants", async () => {
    fakeRefine.mockResolvedValue({
      variants: [
        { id: "v1", label: "a", payload: "Вариант A" },
        { id: "v2", label: "b", payload: "Вариант B" },
      ],
    });
    const onChange = vi.fn();
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value=""
        onChange={onChange}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Другие формулировки/ }),
    );
    await waitFor(() => screen.getByText("Вариант A"));
    const acceptButtons = screen.getAllByRole("button", { name: /Принять/ });
    await userEvent.click(acceptButtons[0]!);
    expect(onChange).toHaveBeenLastCalledWith("Вариант A");
    expect(screen.queryByText("Вариант B")).not.toBeInTheDocument();
  });

  it("renders error and recovery when onRefine rejects", async () => {
    fakeRefine.mockRejectedValue(new Error("offline"));
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value=""
        onChange={() => {}}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Другие формулировки/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/offline/),
    );
    expect(
      screen.getByRole("button", { name: /Другие формулировки/ }),
    ).toBeEnabled();
  });
});
