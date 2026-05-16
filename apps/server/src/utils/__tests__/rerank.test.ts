import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  rerankCandidates: vi.fn(),
}));

import { rerankCandidates } from "@book-forge/agents";
import { rerankByRelevance, rerankEnabled } from "../rerank.js";

const rerankMock = vi.mocked(rerankCandidates);

interface Item {
  tag: string;
  text: string;
}
const items: Item[] = [
  { tag: "a", text: "дракон напал" },
  { tag: "b", text: "любовная сцена" },
  { tag: "c", text: "морской бой" },
  { tag: "d", text: "тихий вечер" },
];

beforeEach(() => {
  rerankMock.mockReset();
  delete process.env.RETRIEVAL_RERANK;
});
afterEach(() => {
  delete process.env.RETRIEVAL_RERANK;
});

describe("rerankEnabled", () => {
  it("reflects RETRIEVAL_RERANK env", () => {
    expect(rerankEnabled()).toBe(false);
    process.env.RETRIEVAL_RERANK = "1";
    expect(rerankEnabled()).toBe(true);
  });
});

describe("rerankByRelevance", () => {
  it("passthrough (slice topK) and no LLM call when disabled", async () => {
    const r = await rerankByRelevance(items, "дракон", (i) => i.text, 2);
    expect(r.map((x) => x.tag)).toEqual(["a", "b"]);
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("passthrough when items <= topK even if enabled", async () => {
    process.env.RETRIEVAL_RERANK = "1";
    const r = await rerankByRelevance(items.slice(0, 2), "q", (i) => i.text, 2);
    expect(r).toHaveLength(2);
    expect(rerankMock).not.toHaveBeenCalled();
  });

  it("reorders by score, drops below threshold, caps topK when enabled", async () => {
    process.env.RETRIEVAL_RERANK = "1";
    rerankMock.mockResolvedValue({
      ranked: [
        { id: 0, score: 0.9 }, // a
        { id: 1, score: 0.05 }, // b — dropped (< 0.15)
        { id: 2, score: 0.7 }, // c
        { id: 3, score: 0.4 }, // d
      ],
    });
    const r = await rerankByRelevance(items, "морской дракон", (i) => i.text, 2);
    expect(rerankMock).toHaveBeenCalledTimes(1);
    expect(r.map((x) => x.tag)).toEqual(["a", "c"]); // 0.9, 0.7; b dropped, d capped
  });

  it("falls back to slice(topK) when judge scores everything below threshold", async () => {
    process.env.RETRIEVAL_RERANK = "1";
    rerankMock.mockResolvedValue({
      ranked: items.map((_, i) => ({ id: i, score: 0 })),
    });
    const r = await rerankByRelevance(items, "q", (i) => i.text, 2);
    expect(r.map((x) => x.tag)).toEqual(["a", "b"]);
  });
});
