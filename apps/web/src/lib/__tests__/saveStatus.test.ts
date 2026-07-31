import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../saveStatus");
}

describe("saveStatus store", () => {
  beforeEach(() => vi.resetModules());

  it("starts idle", async () => {
    const m = await freshModule();
    expect(m.getSaveStatus()).toEqual({ kind: "idle", at: null });
  });

  it("reportSave updates state and notifies", async () => {
    const m = await freshModule();
    let seen = 0;
    m.subscribeSaveStatus(() => seen++);
    m.reportSave({ kind: "saving", at: 123 });
    expect(m.getSaveStatus()).toEqual({ kind: "saving", at: 123 });
    expect(seen).toBe(1);
  });

  it("resetSaveStatus returns to idle", async () => {
    const m = await freshModule();
    m.reportSave({ kind: "saved", at: 5 });
    m.resetSaveStatus();
    expect(m.getSaveStatus()).toEqual({ kind: "idle", at: null });
  });
});
