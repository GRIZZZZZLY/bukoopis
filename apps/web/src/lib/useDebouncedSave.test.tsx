import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedSave } from "./useDebouncedSave";

describe("useDebouncedSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces multiple marks into one save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDebouncedSave(save, { delayMs: 100 }));

    act(() => {
      result.current.mark("a");
      result.current.mark("ab");
      result.current.mark("abc");
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
  });

  it("skips save when value unchanged vs baseline", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 50 }),
    );
    act(() => {
      result.current.setBaseline("same");
      result.current.mark("same");
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("flushNow saves immediately", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 1000 }),
    );
    act(() => {
      result.current.mark("now");
    });
    await act(async () => {
      await result.current.flushNow();
    });
    expect(save).toHaveBeenCalledWith("now");
  });

  it("sets lastSavedAt after successful save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 50 }),
    );
    act(() => {
      result.current.mark("x");
    });
    // Use flushNow so we don't depend on fake-timer + microtask ordering.
    await act(async () => {
      await result.current.flushNow();
    });
    expect(result.current.lastSavedAt).not.toBeNull();
  });
});
