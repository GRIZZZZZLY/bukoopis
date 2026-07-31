import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

async function renderWith(kind: "idle" | "saving" | "saved") {
  vi.resetModules();
  const store = await import("@/lib/saveStatus");
  const { InkwellStatus } = await import("../InkwellStatus");
  store.reportSave({ kind, at: kind === "idle" ? null : 1 });
  return render(<InkwellStatus />);
}

describe("InkwellStatus", () => {
  beforeEach(() => vi.resetModules());

  it("drips while saving", async () => {
    const { container } = await renderWith("saving");
    expect(container.querySelector(".inkwell")?.className).toContain("inkwell-drip");
  });

  it("calm when saved", async () => {
    const { container } = await renderWith("saved");
    expect(container.querySelector(".inkwell")?.className).not.toContain("inkwell-drip");
  });
});
