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

/** Правка автора так, как её шлёт панель: с тем, что он видел (F23). */
async function patchState(body: unknown): Promise<Response> {
  const seen = await sendJson<{ versionId: number; updatedAt: string | null }>(
    t.app,
    `/api/chapters/${chapterId}/scene-state`,
    "GET",
  );
  return send(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
    ...(body as object),
    expectedVersionId: seen.versionId,
    expectedUpdatedAt: seen.updatedAt,
  });
}

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

  it("после перезаписи главы отдаёт правку прежней версии к переносу", async () => {
    await patchState({
      place: "причал",
      carried: [{ name: "Нина", value: "ключ" }],
    });
    // Перезапись главы: новая версия становится текущей, анкета осталась у старой.
    await sendJson(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: { type: "doc", content: [] },
      source: "manual",
    });

    const got = await sendJson<{
      state: SceneState | null;
      carry: { state: SceneState; versionId: number } | null;
    }>(t.app, `/api/chapters/${chapterId}/scene-state`, "GET");
    expect(got.state).toBeNull();
    expect(got.carry?.versionId).toBe(versionId);
    expect(got.carry?.state.place).toBe("причал");

    // Перенос — обычная авторская запись на текущую версию; предлагать больше нечего.
    expect((await patchState(got.carry!.state)).status).toBe(200);
    const after = await sendJson<{
      origin: string | null;
      carry: unknown;
    }>(t.app, `/api/chapters/${chapterId}/scene-state`, "GET");
    expect(after.origin).toBe("manual");
    expect(after.carry).toBeNull();
  });
});

describe("PATCH /api/chapters/:id/scene-state", () => {
  it("правка автора сохраняется и помечается авторской (AC-6)", async () => {
    await patchState({
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

describe("PATCH анкеты сверяется с тем, что видел автор (F23 ревью 2026-09-22)", () => {
  it("вторая вкладка со старым снимком получает 409, а не перетирает первую", async () => {
    const seen = await sendJson<{ versionId: number; updatedAt: string | null }>(
      t.app,
      `/api/chapters/${chapterId}/scene-state`,
      "GET",
    );
    const expect0 = { expectedVersionId: seen.versionId, expectedUpdatedAt: seen.updatedAt };
    const first = await send(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
      place: "FIRST_TAB",
      ...expect0,
    });
    expect(first.status).toBe(200);
    const second = await send(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
      loose: ["SECOND_TAB"],
      ...expect0,
    });
    expect(second.status).toBe(409);
    const got = await sendJson<{ state: SceneState | null }>(t.app, `/api/chapters/${chapterId}/scene-state`, "GET");
    expect(got.state?.place).toBe("FIRST_TAB");
  });

  it("форма, открытая на прежней версии главы, не ложится на новую", async () => {
    const seen = await sendJson<{ versionId: number; updatedAt: string | null }>(
      t.app,
      `/api/chapters/${chapterId}/scene-state`,
      "GET",
    );
    await sendJson(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: { type: "doc", content: [] },
      source: "manual",
    });
    const res = await send(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", {
      place: "STALE_EDIT_FROM_V1",
      expectedVersionId: seen.versionId,
      expectedUpdatedAt: seen.updatedAt,
    });
    expect(res.status).toBe(409);
    const got = await sendJson<{ state: SceneState | null }>(t.app, `/api/chapters/${chapterId}/scene-state`, "GET");
    expect(got.state).toBeNull();
  });

  it("правка без ожиданий не принимается", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/scene-state`, "PATCH", { place: "x" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chapters/:id/scene-state/recompute", () => {
  it("снимает прежнюю анкету и ставит задание заново", async () => {
    await patchState({ place: "причал" });
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
