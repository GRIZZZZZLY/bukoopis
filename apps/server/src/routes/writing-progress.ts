import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import { getWritingProgress, localDay } from "../utils/writing-progress.js";

export function createWritingProgressRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();
  // Свеча-цель: сколько слов написано руками за день.
  r.get("/writing-progress", (c) => {
    const date = c.req.query("date") ?? localDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }
    return c.json(getWritingProgress(sqlite, date));
  });
  return r;
}
