import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StyleFreshnessNote } from "../StyleFreshnessNote";

vi.mock("@/api/client", () => ({
  api: {
    getStyleFreshness: vi.fn(),
    refreshStyleFromChapters: vi.fn(),
    runStyleExtract: vi.fn(),
  },
}));

import { api } from "@/api/client";

const STALE = {
  profileId: 4,
  profileName: "Мой голос",
  kind: "extracted" as const,
  lastExtractedAt: "2026-09-01T00:00:00Z",
  versionsSince: 7,
  chaptersSince: 5,
  stale: true,
};

beforeEach(() => {
  vi.mocked(api.getStyleFreshness).mockReset();
  vi.mocked(api.refreshStyleFromChapters).mockReset();
  vi.mocked(api.runStyleExtract).mockReset();
});

describe("StyleFreshnessNote", () => {
  it("молчит, пока стиль свежий", async () => {
    vi.mocked(api.getStyleFreshness).mockResolvedValue({ ...STALE, chaptersSince: 1, stale: false });
    const { container } = render(<StyleFreshnessNote bookId={1} />);
    await waitFor(() => expect(api.getStyleFreshness).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("устарел — называет число глав и пересобирает в два шага", async () => {
    vi.mocked(api.getStyleFreshness)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce({ ...STALE, chaptersSince: 0, stale: false });
    vi.mocked(api.refreshStyleFromChapters).mockResolvedValue({ corpusId: 9, chapters: [] });
    vi.mocked(api.runStyleExtract).mockResolvedValue({} as never);
    render(<StyleFreshnessNote bookId={1} />);
    expect(await screen.findByText(/принято глав: 5/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /пересобрать/i }));
    await waitFor(() => expect(api.refreshStyleFromChapters).toHaveBeenCalledWith(1));
    await waitFor(() => expect(api.runStyleExtract).toHaveBeenCalledWith(4, {}));
    await waitFor(() => expect(screen.queryByText(/принято глав/)).toBeNull());
  });
});
