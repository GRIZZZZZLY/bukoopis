import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../client";

/** F08 ревью 2026-09-22: сервер отвечает «ничего не идёт» как
 *  `200 {running:false}`, а клиент ждал 404 — объект без `rows` уходил в
 *  панели как прогон, и они падали на `rows.map`, зависая в «идёт». */

afterEach(() => vi.unstubAllGlobals());

function serverReplies(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
  );
}

describe("inflight — граница клиента", () => {
  it("running:false от сервера — это null, а не прогон", async () => {
    serverReplies({ running: false });
    expect(await api.intakeInflight(1)).toBeNull();
    expect(await api.getQuickStartInflight(1)).toBeNull();
  });

  it("идущий прогон проходит как есть", async () => {
    serverReplies({ running: true, requestKey: "k", total: 1, startedAt: "t", rows: [] });
    expect(await api.intakeInflight(1)).toMatchObject({ requestKey: "k", rows: [] });
  });
});
