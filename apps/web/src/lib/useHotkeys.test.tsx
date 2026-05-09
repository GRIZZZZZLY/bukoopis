import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys } from "./useHotkeys";

function fireKey(opts: {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}): void {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
}

describe("useHotkeys", () => {
  it("calls handler on mod+s", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": handler }));
    fireKey({ key: "s", ctrl: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire mod+s on plain s", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": handler }));
    fireKey({ key: "s" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls esc handler on Escape", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ esc: handler }));
    fireKey({ key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls mod+enter handler", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ "mod+enter": handler }));
    fireKey({ key: "Enter", ctrl: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call handler when component unmounted", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkeys({ "mod+s": handler }));
    unmount();
    fireKey({ key: "s", ctrl: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores extra modifiers (no shift required)", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": handler }));
    fireKey({ key: "s", ctrl: true, shift: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("matches mod+shift+z when both set", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ "mod+shift+z": handler }));
    fireKey({ key: "z", ctrl: true, shift: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
