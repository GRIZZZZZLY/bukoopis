import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { approvePlan, PlanApproveError } from "../plan-approve.js";
import type { BookOutline } from "@book-forge/shared";

let t: TestApp;
let db: DatabaseType;
let bookId: number;

function setOutline(outline: BookOutline): void {
  db.prepare("UPDATE books SET outline_json = ? WHERE id = ?").run(
    JSON.stringify(outline),
    bookId,
  );
}

function planWith(chapters: Array<{ title: string; pov?: string }>): BookOutline {
  return {
    variants: [
      {
        label: "план",
        estimatedChapters: chapters.length,
        source: "author_material",
        chapters,
      },
    ],
    selectedIndex: 0,
    generatedAt: "2026-09-06T10:00:00.000Z",
  };
}

function chapterRows(): Array<{
  id: number;
  title: string;
  intent: string | null;
  order_index: number;
}> {
  return db
    .prepare(
      "SELECT id, title, intent, order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC",
    )
    .all(bookId) as Array<{
    id: number;
    title: string;
    intent: string | null;
    order_index: number;
  }>;
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "План",
    premise: "p",
  });
  bookId = b.id;
  db = new Database(`${t.dbDir}/test.sqlite`);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("approvePlan", () => {
  it("создаёт главы из плана с намерениями", () => {
    setOutline(planWith([{ title: "Порог", pov: "Рин" }, { title: "Мост" }]));
    const out = approvePlan(db, bookId);

    expect(out).toEqual({ created: 2, updated: 0 });
    const rows = chapterRows();
    expect(rows.map((r) => r.title)).toEqual(["Порог", "Мост"]);
    expect(rows[0]?.intent).toContain("POV: Рин");
    expect(rows[1]?.intent).toContain("Мост");
    // Разрежённая нумерация сохранена.
    expect(rows[0]!.order_index).toBeLessThan(rows[1]!.order_index);
  });

  it("сопоставляет по порядку: существующая глава получает намерение, лишняя строка создаётся", async () => {
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Моя первая" });
    setOutline(planWith([{ title: "Порог", pov: "Рин" }, { title: "Мост" }]));

    const out = approvePlan(db, bookId);
    expect(out).toEqual({ created: 1, updated: 1 });

    const rows = chapterRows();
    expect(rows).toHaveLength(2);
    // Название автора не тронуто, намерение проставлено.
    expect(rows[0]?.title).toBe("Моя первая");
    expect(rows[0]?.intent).toContain("POV: Рин");
    expect(rows[1]?.title).toBe("Мост");
  });

  it("повторное утверждение обновляет намерения и не плодит главы", () => {
    setOutline(planWith([{ title: "Порог" }]));
    approvePlan(db, bookId);
    setOutline(planWith([{ title: "Порог", pov: "Сарек" }]));
    const out = approvePlan(db, bookId);

    expect(out).toEqual({ created: 0, updated: 1 });
    expect(chapterRows()).toHaveLength(1);
    expect(chapterRows()[0]?.intent).toContain("POV: Сарек");
  });

  it("написанный текст не трогается", async () => {
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Написанная" },
    );
    await sendJson(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Текст автора." }] }],
      },
    });
    const before = db
      .prepare("SELECT current_version_id FROM chapters WHERE id = ?")
      .get(ch.id) as { current_version_id: number | null };

    setOutline(planWith([{ title: "Совсем другое название" }]));
    approvePlan(db, bookId);

    const after = db
      .prepare("SELECT title, current_version_id FROM chapters WHERE id = ?")
      .get(ch.id) as { title: string; current_version_id: number | null };
    expect(after.current_version_id).toBe(before.current_version_id);
    expect(after.title).toBe("Написанная");
  });

  it("больше глав, чем строк плана — лишние остаются нетронутыми", async () => {
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Первая" });
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Вторая" });
    setOutline(planWith([{ title: "Порог", pov: "Рин" }]));

    const out = approvePlan(db, bookId);
    expect(out).toEqual({ created: 0, updated: 1 });
    const rows = chapterRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.intent).toBeNull();
  });

  it("без выбранного варианта — отказ с причиной", () => {
    setOutline({ ...planWith([{ title: "Порог" }]), selectedIndex: null });
    expect(() => approvePlan(db, bookId)).toThrow(PlanApproveError);
    try {
      approvePlan(db, bookId);
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_selection");
    }
  });

  it("выбранный вариант без поглавных строк — отказ с причиной", () => {
    setOutline({
      variants: [{ label: "только синопсис", estimatedChapters: 10 }],
      selectedIndex: 0,
      generatedAt: "2026-09-06T10:00:00.000Z",
    });
    try {
      approvePlan(db, bookId);
      throw new Error("должно было бросить");
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_chapters");
    }
  });

  it("книга без плана вовсе — отказ с причиной", () => {
    try {
      approvePlan(db, bookId);
      throw new Error("должно было бросить");
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_outline");
    }
  });
});
