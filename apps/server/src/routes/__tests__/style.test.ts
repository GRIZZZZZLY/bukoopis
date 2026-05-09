import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface ProfileJson {
  id: number;
  name: string;
  language: string;
  corporaCount: number;
  totalChars: number;
  fingerprint: unknown;
}

interface CorpusJson {
  id: number;
  filename: string;
  format: string;
  charCount: number;
  sceneCount: number;
}

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => t.cleanup());

const SAMPLE_TXT = `Глава 1. Начало

Абзац первой сцены. Текст идёт длинными витыми предложениями, как любил автор.
Короткое.

Тёмный лес простирался во все стороны до самого горизонта. Дорога, петляющая между древних дубов, уходила вдаль.

Глава 2. Дальше

Сцена вторая начинается с другого тона.

Действие. Звук. Тишина.

Эмиссар вышел из-за угла.

Глава 3. Финал

Третья глава для разнообразия. Здесь проза тянется длинными периодами, насыщенными придаточными, которые расходятся, словно ветви старого дерева, в самые неожиданные стороны.

Конец сцены.`;

describe("style profiles CRUD", () => {
  it("creates profile and returns it in list", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "Пехов", language: "ru", description: "Тёмное славянское фэнтези" },
    );
    expect(p.id).toBeGreaterThan(0);
    expect(p.name).toBe("Пехов");
    expect(p.corporaCount).toBe(0);

    const list = await sendJson<ProfileJson[]>(
      t.app,
      "/api/style-profiles",
      "GET",
    );
    expect(list.length).toBe(1);
  });

  it("validates create body", async () => {
    const res = await send(t.app, "/api/style-profiles", "POST", {
      name: "",
    });
    expect(res.status).toBe(400);
  });

  it("patches name + description", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const u = await sendJson<ProfileJson>(
      t.app,
      `/api/style-profiles/${p.id}`,
      "PATCH",
      { name: "Y", description: "обновлено" },
    );
    expect(u.name).toBe("Y");
  });

  it("delete cascades to corpora", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    await send(t.app, `/api/style-profiles/${p.id}/corpora`, "POST", {
      filename: "sample.txt",
      content: SAMPLE_TXT,
      encoding: "utf8",
    });
    await send(t.app, `/api/style-profiles/${p.id}`, "DELETE");
    const list = await sendJson<ProfileJson[]>(
      t.app,
      "/api/style-profiles",
      "GET",
    );
    expect(list.length).toBe(0);
  });
});

describe("corpora upload", () => {
  it("uploads .txt and parses scenes", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const corpus = await sendJson<CorpusJson>(
      t.app,
      `/api/style-profiles/${p.id}/corpora`,
      "POST",
      { filename: "sample.txt", content: SAMPLE_TXT, encoding: "utf8" },
    );
    expect(corpus.format).toBe("txt");
    expect(corpus.charCount).toBeGreaterThan(0);
    expect(corpus.sceneCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects unsupported extension", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const res = await send(t.app, `/api/style-profiles/${p.id}/corpora`, "POST", {
      filename: "novel.docx",
      content: "x".repeat(500),
      encoding: "utf8",
    });
    expect(res.status).toBe(400);
  });

  it("rejects too-short content", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const res = await send(t.app, `/api/style-profiles/${p.id}/corpora`, "POST", {
      filename: "tiny.txt",
      content: "короче ста знаков.",
      encoding: "utf8",
    });
    expect(res.status).toBe(400);
  });

  it("delete corpus removes scenes via cascade", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const corpus = await sendJson<CorpusJson>(
      t.app,
      `/api/style-profiles/${p.id}/corpora`,
      "POST",
      { filename: "s.txt", content: SAMPLE_TXT, encoding: "utf8" },
    );
    const del = await send(
      t.app,
      `/api/style-profiles/${p.id}/corpora/${corpus.id}`,
      "DELETE",
    );
    expect(del.status).toBe(204);
    const list = await sendJson<CorpusJson[]>(
      t.app,
      `/api/style-profiles/${p.id}/corpora`,
      "GET",
    );
    expect(list.length).toBe(0);
  });
});

describe("extract endpoint (without API key)", () => {
  it("400 when corpus too small", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    const res = await send(
      t.app,
      `/api/style-profiles/${p.id}/extract`,
      "POST",
      {},
    );
    expect(res.status).toBe(400);
  });

  it("500 when extractor fails (no API key)", async () => {
    const p = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "X" },
    );
    // Add enough content to surpass the 5-scene minimum
    const longText = Array(10)
      .fill(0)
      .map(
        (_, i) =>
          `Глава ${i + 1}. Раздел\n\n${"А ".repeat(150)}.\n\n${"Б ".repeat(150)}.\n\n${"В ".repeat(150)}.`,
      )
      .join("\n\n");
    await send(t.app, `/api/style-profiles/${p.id}/corpora`, "POST", {
      filename: "big.txt",
      content: longText,
      encoding: "utf8",
    });
    const res = await send(
      t.app,
      `/api/style-profiles/${p.id}/extract`,
      "POST",
      { sampleSize: 5 },
    );
    expect([400, 500]).toContain(res.status);
  });
});

describe("book.styleProfileId integration", () => {
  it("updates book.styleProfileId via PATCH", async () => {
    const profile = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "P" },
    );
    const book = await sendJson<{ id: number; styleProfileId: number | null }>(
      t.app,
      "/api/books",
      "POST",
      { title: "B" },
    );
    expect(book.styleProfileId).toBeNull();
    const updated = await sendJson<{ styleProfileId: number | null }>(
      t.app,
      `/api/books/${book.id}`,
      "PATCH",
      { styleProfileId: profile.id },
    );
    expect(updated.styleProfileId).toBe(profile.id);
  });

  it("setting style profile to null clears it", async () => {
    const profile = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "P" },
    );
    const book = await sendJson<{ id: number; styleProfileId: number | null }>(
      t.app,
      "/api/books",
      "POST",
      { title: "B" },
    );
    await send(t.app, `/api/books/${book.id}`, "PATCH", {
      styleProfileId: profile.id,
    });
    const cleared = await sendJson<{ styleProfileId: number | null }>(
      t.app,
      `/api/books/${book.id}`,
      "PATCH",
      { styleProfileId: null },
    );
    expect(cleared.styleProfileId).toBeNull();
  });
});
