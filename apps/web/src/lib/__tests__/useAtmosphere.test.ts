import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../useAtmosphere");
}

describe("useAtmosphere store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("defaults to full and applies atm-full class", async () => {
    const m = await freshModule();
    expect(m.getAtmosphere()).toBe("full");
    m.applyAtmosphereClass();
    expect(document.documentElement.classList.contains("atm-full")).toBe(true);
  });

  it("persists mode to localStorage and swaps html class", async () => {
    const m = await freshModule();
    m.setAtmosphere("calm");
    expect(localStorage.getItem("bf-atmosphere")).toBe("calm");
    expect(document.documentElement.classList.contains("atm-calm")).toBe(true);
    expect(document.documentElement.classList.contains("atm-full")).toBe(false);
  });

  it("restores persisted mode on module init", async () => {
    localStorage.setItem("bf-atmosphere", "off");
    const m = await freshModule();
    expect(m.getAtmosphere()).toBe("off");
  });

  it("cycles full -> calm -> off -> full", async () => {
    const m = await freshModule();
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("calm");
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("off");
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("full");
  });

  it("effectiveMode degrades full to calm under prefers-reduced-motion", async () => {
    const m = await freshModule();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(m.effectiveMode("full")).toBe("calm");
    expect(m.effectiveMode("off")).toBe("off");
    vi.unstubAllGlobals();
  });
});
