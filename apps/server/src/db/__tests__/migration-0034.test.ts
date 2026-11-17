import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/**
 * Миграция 0034 на строках, которых в свежей базе не бывает: битый
 * `plan_json` не должен ронять перенос `active_plan_kind`. Таблицы —
 * минимальные, ровно те колонки, что миграция трогает.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, "../../../drizzle/0034_dossier.sql"), "utf8");

describe("миграция 0034_dossier", () => {
  it("битый plan_json не роняет миграцию; выбранный план получает beats", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE books (id integer PRIMARY KEY)");
    db.exec("CREATE TABLE chapters (id integer PRIMARY KEY, plan_json text)");
    const ins = db.prepare("INSERT INTO chapters (id, plan_json) VALUES (?, ?)");
    ins.run(1, "{не json");
    ins.run(2, JSON.stringify({ variants: [], selectedIndex: 0 }));
    ins.run(3, JSON.stringify({ variants: [], selectedIndex: null }));
    ins.run(4, null);

    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.replace(/--[^\n]*/g, "").trim()) db.exec(stmt);
    }

    const rows = db
      .prepare("SELECT id, active_plan_kind FROM chapters ORDER BY id")
      .all() as Array<{ id: number; active_plan_kind: string | null }>;
    expect(rows.map((r) => r.active_plan_kind)).toEqual([null, "beats", null, null]);
    db.close();
  });
});
