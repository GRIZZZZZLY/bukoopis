import { describe, it, expect, vi, afterEach } from "vitest";

describe("useAtmosphere", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("всегда полная и ставит класс atm-full", async () => {
    // Сохранённое «off» из прежнего переключателя больше ничего не значит.
    localStorage.setItem("bf-atmosphere", "off");
    const m = await import("../useAtmosphere");
    m.applyAtmosphereClass();
    expect(m.getAtmosphere()).toBe("full");
    expect(document.documentElement.classList.contains("atm-full")).toBe(true);
  });

  it("системное «уменьшить движение» гасит анимации до calm", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const m = await import("../useAtmosphere");
    expect(m.effectiveMode()).toBe("calm");
  });
});
