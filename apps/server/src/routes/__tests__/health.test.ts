import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.cleanup());

describe("/api/health", () => {
  it("returns status ok + db ok + vec boolean", async () => {
    const res = await send(t.app, "/api/health", "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: string;
      vec: boolean;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.vec).toBe("boolean");
    expect(typeof body.timestamp).toBe("string");
  });
});
