import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryStatusBadge, MemoryStaleBanner } from "./MemoryStatus";
import type { ChapterMemoryInfo } from "@/api/client";

function mem(
  state: ChapterMemoryInfo["state"],
  bookStaleFromOrder: number | null = null,
): ChapterMemoryInfo {
  return { state, memoryVersionId: null, bookStaleFromOrder };
}

describe("MemoryStatusBadge", () => {
  it("renders nothing without memory info", () => {
    const { container } = render(
      <MemoryStatusBadge memory={null} onRetry={() => {}} retrying={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows fresh state", () => {
    render(
      <MemoryStatusBadge
        memory={mem("fresh")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.getByText("Память актуальна")).toBeInTheDocument();
  });

  it("shows updating state", () => {
    render(
      <MemoryStatusBadge
        memory={mem("updating")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(screen.getByText("Память обновляется…")).toBeInTheDocument();
  });

  it("shows not-in-memory state after an autosave-only change", () => {
    render(
      <MemoryStatusBadge
        memory={mem("none")}
        onRetry={() => {}}
        retrying={false}
      />,
    );
    expect(
      screen.getByText("Есть изменения, не добавленные в память"),
    ).toBeInTheDocument();
  });

  it("error state exposes a retry action", () => {
    const onRetry = vi.fn();
    render(
      <MemoryStatusBadge
        memory={mem("error")}
        onRetry={onRetry}
        retrying={false}
      />,
    );
    expect(screen.getByText("Ошибка обновления памяти")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("MemoryStaleBanner", () => {
  it("renders nothing when the book is not stale", () => {
    const { container } = render(
      <MemoryStaleBanner
        staleFromOrder={null}
        onRebuild={() => {}}
        rebuilding={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stale chapter and triggers rebuild", () => {
    const onRebuild = vi.fn();
    render(
      <MemoryStaleBanner
        staleFromOrder={4}
        onRebuild={onRebuild}
        rebuilding={false}
      />,
    );
    expect(
      screen.getByText(/Память книги устарела начиная с главы #4/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Перестроить с главы #4" }),
    );
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });
});
