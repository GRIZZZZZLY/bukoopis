import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TonePicker } from "../TonePicker";

describe("TonePicker", () => {
  it("renders a chip per registry tone", () => {
    render(<TonePicker selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Мрачный/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Светлый/ })).toBeInTheDocument();
  });

  it("marks selected chips with aria-pressed=true", () => {
    render(<TonePicker selected={["dark"]} onChange={() => {}} />);
    const dark = screen.getByRole("button", { name: /Мрачный/ });
    expect(dark).toHaveAttribute("aria-pressed", "true");
    const light = screen.getByRole("button", { name: /Светлый/ });
    expect(light).toHaveAttribute("aria-pressed", "false");
  });

  it("toggle adds a tone when not selected", async () => {
    const onChange = vi.fn();
    render(<TonePicker selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Мрачный/ }));
    expect(onChange).toHaveBeenCalledWith(["dark"]);
  });

  it("toggle removes a tone when already selected", async () => {
    const onChange = vi.fn();
    render(<TonePicker selected={["dark", "hopeful"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Мрачный/ }));
    expect(onChange).toHaveBeenCalledWith(["hopeful"]);
  });
});
