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

  /** В10 ревью 2026-09-19: упавший автосейв не перезапускал таймер. Автор
   *  отвлекался, и всё набранное висело несохранённым до следующей клавиши —
   *  а если её не было, до закрытия вкладки. */
  it("повторяет сохранение после сбоя, пока не выйдет", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("сеть"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 50, retryDelaysMs: [200] }),
    );

    act(() => {
      result.current.mark("текст");
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.lastSavedAt).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it("новая правка отменяет запланированный повтор и сохраняет её саму", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("сеть"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 50, retryDelaysMs: [500] }),
    );

    act(() => {
      result.current.mark("первое");
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.mark("второе");
    });
    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("второе");

    // Повтор первого больше не срабатывает: его текст уже вытеснен.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
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

  /** Повторы не вечны: на отказе, который сам не пройдёт (глава удалена,
   *  конфликт ревизии), бесконечный стук раз в 30 секунд ничего не спасает и
   *  сыплет тостами. После последней паузы хук останавливается; текст
   *  остаётся в ожидании и уйдёт со следующей правкой или по Ctrl+S. */
  it("перестаёт повторять, когда паузы кончились", async () => {
    const save = vi.fn().mockRejectedValue(new Error("глава удалена"));
    const { result } = renderHook(() =>
      useDebouncedSave(save, { delayMs: 50, retryDelaysMs: [100, 200] }),
    );

    act(() => {
      result.current.mark("текст");
    });
    for (const step of [60, 120, 220, 400, 400]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    // Первая попытка плюс две по списку пауз — и всё.
    expect(save).toHaveBeenCalledTimes(3);
  });
});
