import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../focusMode");
}

describe("focusMode store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts unfocused", async () => {
    const m = await freshModule();
    expect(m.isFocused()).toBe(false);
  });

  it("toggleFocus flips state and notifies subscribers", async () => {
    const m = await freshModule();
    const seen: boolean[] = [];
    const unsub = m.subscribeFocus(() => seen.push(m.isFocused()));
    m.toggleFocus();
    m.toggleFocus();
    unsub();
    expect(seen).toEqual([true, false]);
  });

  it("setFocus is idempotent — no notify on same value", async () => {
    const m = await freshModule();
    let calls = 0;
    m.subscribeFocus(() => calls++);
    m.setFocus(false);
    expect(calls).toBe(0);
    m.setFocus(true);
    expect(calls).toBe(1);
  });
});
