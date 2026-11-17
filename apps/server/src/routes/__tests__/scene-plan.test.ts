import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "./_helpers.js";

interface ChapterJson {
  id: number;
  scenePlan: { scenes: { events: string[] }[]; basedOn: number } | null;
  scenePlanStale: boolean;
}

const PLAN = { scenes: [{ events: ["раз", "два", "три"] }] };

let t: TestApp;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
  const ch = await sendJson<ChapterJson>(t.app, `/api/books/${b.id}/chapters`, "POST", { title: "Г" });
  chapterId = ch.id;
  await sendJson(t.app, `/api/chapters/${chapterId}`, "PATCH", { intent: "Герой уходит." });
});
afterEach(() => t.cleanup());

const patch = (body: unknown) =>
  sendJson<ChapterJson>(t.app, `/api/chapters/${chapterId}`, "PATCH", body);

describe("план сцен главы", () => {
  it("сохраняется, не устарел", async () => {
    const ch = await patch({ scenePlan: PLAN });
    expect(ch.scenePlan?.scenes).toEqual(PLAN.scenes);
    expect(ch.scenePlanStale).toBe(false);
  });
  it("после смены intent устарел, план остаётся", async () => {
    await patch({ scenePlan: PLAN });
    const ch = await patch({ intent: "Герой остаётся." });
    expect(ch.scenePlan).not.toBeNull();
    expect(ch.scenePlanStale).toBe(true);
  });
  it("null стирает, отсутствие поля не трогает", async () => {
    await patch({ scenePlan: PLAN });
    expect((await patch({ title: "Н" })).scenePlan).not.toBeNull();
    const ch = await patch({ scenePlan: null });
    expect(ch.scenePlan).toBeNull();
    expect(ch.scenePlanStale).toBe(false);
  });
});
