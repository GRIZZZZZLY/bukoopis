import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenrePicker } from "../GenrePicker";

describe("GenrePicker", () => {
  it("renders root genre groups", () => {
    render(<GenrePicker selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Фэнтези$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Научная фантастика$/ })).toBeInTheDocument();
  });

  it("expanding a root reveals its child genres", async () => {
    render(<GenrePicker selected={[]} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /показать подвиды/ }));
    expect(screen.getByRole("button", { name: /Тёмное фэнтези/ })).toBeInTheDocument();
  });

  it("clicking a leaf adds it to selection", async () => {
    const onChange = vi.fn();
    render(<GenrePicker selected={[]} onChange={onChange} />);
    // Expand the first "показать подвиды" — that's fantasy (first root with children)
    const expanders = screen.getAllByRole("button", { name: /показать подвиды/ });
    await userEvent.click(expanders[0]!);
    await userEvent.click(screen.getByRole("button", { name: /Тёмное фэнтези/ }));
    expect(onChange).toHaveBeenCalledWith(["fantasy.dark_fantasy"]);
  });

  it("clicking a selected leaf removes it", async () => {
    const onChange = vi.fn();
    render(
      <GenrePicker
        selected={["fantasy.dark_fantasy"]}
        onChange={onChange}
      />,
    );
    // Auto-expand should have already revealed the child since it's selected.
    await userEvent.click(screen.getByRole("button", { name: /Тёмное фэнтези/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders incompatibility warning when both incompatible genres selected", () => {
    render(
      <GenrePicker
        selected={["sci_fi.hard_sci_fi", "fantasy"]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/несовместим/i),
    ).toBeInTheDocument();
  });
});
