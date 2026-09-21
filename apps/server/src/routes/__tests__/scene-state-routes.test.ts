import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { SceneState } from "@book-forge/shared";

/** Анкета непрерывности на странице главы: показ, правка автором, пересчёт. */

let t: TestApp;
let bookId: number;
let chapterId: number;
let versionId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Книга",
  });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Прилив" },
  );
  chapterId = ch.id;
  const v = await sendJson<{ id: number }>(
    t.app,
    `/api/chapters/${chapterId}/versions`,
    "POST",
    { contentJson: { type: "doc", content: [] }, source: "manual" },
  );
  versionId = v.id;
});
afterEach(() => t.cleanup());

describe("GET /api/chapters/:id/scene-state", () => {
  it("«анкеты нет» — обычный ответ, а не 404", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/scene-state`, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: null, origin: null });
  });

  it("несуществующая глава — 404", async () => {
    const res = await send(t.app, "/api/chapters/999999/scene-state", "GET");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/chapters/:id/scene-state", () => {
  it("правка автора сохраняется и помечается авторской (AC-6)", async () => {
    await sendJson(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
      place: "причал",
      carried: [{ name: "Нина", value: "ключ" }],
    });
    const got = await sendJson<{ state: SceneState | null; origin: string | null }>(
      t.app,
      `/api/chapters/${chapterId}/scene-state`,
      "GET",
    );
    expect(got.origin).toBe("manual");
    expect(got.state?.place).toBe("причал");
    expect(got.state?.carried).toEqual([{ name: "Нина", value: "ключ" }]);
  });

  it("негодное тело — 400, а не запись мусора", async () => {
    const res = await send(
      t.app,
      `/api/chapters/${chapterId}/scene-state`,
      "PATCH",
      { place: { нет: "строки" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chapters/:id/scene-state/recompute", () => {
  it("снимает прежнюю анкету и ставит задание заново", async () => {
    await sendJson(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
      place: "причал",
    });
    // Задание версии уже отработало «вхолостую» — помечаем, как будто готово.
    t.sqlite
      .prepare("UPDATE memory_jobs SET status='done' WHERE chapter_version_id = ? AND kind='scene_state'")
      .run(versionId);

    const res = await sendJson<{ enqueued: boolean }>(
      t.app,
      `/api/chapters/${chapterId}/scene-state/recompute`,
      "POST",
      {},
    );
    expect(res.enqueued).toBe(true);

    const got = await sendJson<{ state: SceneState | null }>(
      t.app,
      `/api/chapters/${chapterId}/scene-state`,
      "GET",
    );
    // Авторская строка снята: пересчёт заказан именно поверх неё.
    expect(got.state).toBeNull();
    // Задание заведено заново: прежняя строка (помеченная done вручную)
    // снята, новая прошла обработчик и честно сообщила о пропуске короткой
    // главы — то есть работа действительно повторилась.
    const job = t.sqlite
      .prepare(
        "SELECT status, result_json FROM memory_jobs WHERE chapter_version_id = ? AND kind='scene_state'",
      )
      .get(versionId) as { status: string; result_json: string | null } | undefined;
    expect(job?.result_json).toBe('{"skipped":"short"}');
  });
});
