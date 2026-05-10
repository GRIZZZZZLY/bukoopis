import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../studio-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "bookforge-stx-"));
  sqlite = new Database(join(dbDir, "test.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite
    .prepare(
      `INSERT INTO books (title, created_at, updated_at) VALUES ('T', ?, ?)`,
    )
    .run(new Date().toISOString(), new Date().toISOString());
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadStudioContext", () => {
  it("returns empty when book has no concept and no studio_state", () => {
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.concept).toBeNull();
    expect(ctx.worldAspects).toEqual([]);
    expect(ctx.loreAspects).toEqual([]);
  });

  it("loads concept from books.concept JSON", () => {
    sqlite
      .prepare("UPDATE books SET concept = ? WHERE id = ?")
      .run(
        JSON.stringify({
          schemaVersion: 1,
          genres: ["fantasy"],
          tones: ["dark"],
          audience: "adult",
          premise: { logline: "Герой ищет правду" },
        }),
        1,
      );
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.concept?.genres).toEqual(["fantasy"]);
    expect(ctx.concept?.premise.logline).toBe("Герой ищет правду");
  });

  it("loads accepted world+lore aspects, ignoring pending/skipped/non-markdown", () => {
    const studioState = {
      schemaVersion: 1,
      revision: 5,
      stages: {
        world: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "a1",
              name: "география",
              status: "accepted",
              order: 0,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
              finalPayload: "Архипелаг северных островов.",
            },
            {
              id: "a2",
              name: "магия",
              status: "pending",
              order: 1,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
            },
          ],
        },
        lore: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "b1",
              name: "фракции",
              status: "accepted",
              order: 0,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
              finalPayload: "Три гильдии — морская, кузнечная, певчая.",
            },
            {
              id: "b2",
              name: "артефакты_категория",
              status: "accepted",
              order: 1,
              required: false,
              source: "llm",
              payloadKind: "entity_set",
              variants: [],
              finalPayload: { candidates: [] },
            },
          ],
        },
      },
    };
    sqlite
      .prepare("UPDATE books SET studio_state = ? WHERE id = ?")
      .run(JSON.stringify(studioState), 1);
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.worldAspects).toEqual([
      { name: "география", payload: "Архипелаг северных островов." },
    ]);
    expect(ctx.loreAspects).toEqual([
      { name: "фракции", payload: "Три гильдии — морская, кузнечная, певчая." },
    ]);
  });

  it("returns empty for unknown book id", () => {
    const ctx = loadStudioContext(sqlite, 9999);
    expect(ctx.concept).toBeNull();
    expect(ctx.worldAspects).toEqual([]);
    expect(ctx.loreAspects).toEqual([]);
  });
});

describe("studioContextToPrompt", () => {
  it("returns null when nothing to render", () => {
    const out = studioContextToPrompt({
      concept: null,
      worldAspects: [],
      loreAspects: [],
    });
    expect(out).toBeNull();
  });

  it("renders concept + world + lore in sections", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        genres: ["fantasy"],
        tones: ["dark"],
        audience: "adult",
        premise: { logline: "Герой ищет правду" },
      },
      worldAspects: [{ name: "география", payload: "Острова." }],
      loreAspects: [{ name: "фракции", payload: "Гильдии." }],
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("## Концепт");
    expect(out!).toContain("fantasy");
    expect(out!).toContain("Герой ищет правду");
    expect(out!).toContain("## Мир");
    expect(out!).toContain("география");
    expect(out!).toContain("Острова.");
    expect(out!).toContain("## Лор");
    expect(out!).toContain("фракции");
  });

  it("renders only concept when no aspects", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        genres: ["thriller"],
        tones: ["tense"],
        audience: "ya",
        premise: {},
      },
      worldAspects: [],
      loreAspects: [],
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("## Концепт");
    expect(out!).not.toContain("## Мир");
    expect(out!).not.toContain("## Лор");
  });
});
