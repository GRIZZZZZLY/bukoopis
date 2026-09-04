import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsagePage } from "./UsagePage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getUsage: vi.fn(),
  },
}));

const mockGetUsage = vi.mocked(api).getUsage as unknown as ReturnType<
  typeof vi.fn
>;

describe("UsagePage", () => {
  beforeEach(() => {
    mockGetUsage.mockReset();
  });

  it("renders empty state cards", async () => {
    mockGetUsage.mockResolvedValue({
      totalUsd: 0,
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      perRoute: [],
      perDay: [],
      recent: [],
    });
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Расходы LLM")).toBeInTheDocument();
    });
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("Нет данных в выбранном диапазоне.")).toBeInTheDocument();
  });

  it("renders perRoute table when data present", async () => {
    mockGetUsage.mockResolvedValue({
      totalUsd: 1.234,
      totalCalls: 5,
      totalInputTokens: 1000,
      totalOutputTokens: 2000,
      totalCacheReadTokens: 100,
      totalCacheCreationTokens: 200,
      perRoute: [
        {
          route: "writer.chapter",
          calls: 3,
          costUsd: 0.9,
          inputTokens: 500,
          outputTokens: 1500,
        },
      ],
      perDay: [{ date: "2026-05-08", costUsd: 1.234, calls: 5 }],
      recent: [],
    });
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // "$1.23" appears both as the total stat and as the per-day bar value.
      expect(screen.getAllByText("$1.23").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("writer.chapter")).toBeInTheDocument();
    expect(screen.getByText("$0.900")).toBeInTheDocument();
  });

  it("shows error when API call fails", async () => {
    mockGetUsage.mockRejectedValue(new Error("network blew up"));
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/network blew up/)).toBeInTheDocument();
    });
  });
});
