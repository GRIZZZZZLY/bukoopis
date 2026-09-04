import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { emptyBookConcept } from "@book-forge/shared";
import {
  derivePremiseFromConcept,
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
    expect(ctx.plotAspects).toEqual([]);
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

  it("loads accepted world+lore+plot aspects, ignoring pending/skipped/non-markdown", () => {
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
        plot: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "c1",
              name: "завязка",
              status: "accepted",
              order: 0,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
              finalPayload: "Героиня теряет корабль в первую же ночь.",
            },
            {
              id: "c2",
              name: "финал",
              status: "skipped",
              order: 1,
              required: false,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
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
    expect(ctx.plotAspects).toEqual([
      { name: "завязка", payload: "Героиня теряет корабль в первую же ночь." },
    ]);
  });

  it("returns empty for unknown book id", () => {
    const ctx = loadStudioContext(sqlite, 9999);
    expect(ctx.concept).toBeNull();
    expect(ctx.worldAspects).toEqual([]);
    expect(ctx.loreAspects).toEqual([]);
    expect(ctx.plotAspects).toEqual([]);
  });
});

describe("studioContextToPrompt", () => {
  it("returns null when nothing to render", () => {
    const out = studioContextToPrompt({
      concept: null,
      worldAspects: [],
      loreAspects: [],
      plotAspects: [],
    });
    expect(out).toBeNull();
  });

  it("renders concept + world + lore + plot in sections", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        pitches: [],
        genre: "fantasy",
        tone: "dark",
        audience: "adult",
        premise: { logline: "Герой ищет правду" },
      },
      worldAspects: [{ name: "география", payload: "Острова." }],
      loreAspects: [{ name: "фракции", payload: "Гильдии." }],
      plotAspects: [{ name: "завязка", payload: "Корабль тонет." }],
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
    expect(out!).toContain("## Сюжет");
    expect(out!).toContain("завязка");
    expect(out!).toContain("Корабль тонет.");
  });

  it("renders only concept when no aspects", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        pitches: [],
        genre: "thriller",
        tone: "tense",
        audience: "ya",
        premise: {},
      },
      worldAspects: [],
      loreAspects: [],
      plotAspects: [],
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("## Концепт");
    expect(out!).not.toContain("## Мир");
    expect(out!).not.toContain("## Лор");
    expect(out!).not.toContain("## Сюжет");
  });

  it("renders genre, tone and hook as single lines", () => {
    const text = studioContextToPrompt({
      concept: {
        ...emptyBookConcept(),
        genre: "камерная антиутопия",
        tone: "холодный",
        hook: "В списке — её имя.",
        premise: { logline: "Когда…" },
      },
      worldAspects: [],
      loreAspects: [],
      plotAspects: [],
    } as never);
    expect(text).toContain("Жанр: камерная антиутопия");
    expect(text).toContain("Тон: холодный");
    expect(text).toContain("Крючок: В списке — её имя.");
    expect(text).not.toContain("Жанры:");
  });
});

describe("derivePremiseFromConcept", () => {
  const base = {
    schemaVersion: 1 as const,
    pitches: [],
    genres: [],
    tones: [],
    audience: "adult" as const,
  };

  it("returns null without a concept", () => {
    expect(derivePremiseFromConcept(null)).toBeNull();
  });

  it("returns null when every premise field is blank", () => {
    expect(
      derivePremiseFromConcept({ ...base, premise: { logline: "   " } }),
    ).toBeNull();
  });

  it("uses the logline alone when it is the only field", () => {
    expect(
      derivePremiseFromConcept({
        ...base,
        premise: { logline: "Картограф ищет остров, которого нет." },
      }),
    ).toBe("Картограф ищет остров, которого нет.");
  });

  it("appends protagonist/conflict/stakes when present", () => {
    const out = derivePremiseFromConcept({
      ...base,
      premise: {
        logline: "Картограф ищет остров, которого нет.",
        protagonist: "Мира, картограф",
        conflict: "Гильдия скрывает карты",
        stakes: "Затонет весь архипелаг",
      },
    });
    expect(out).toBe(
      [
        "Картограф ищет остров, которого нет.",
        "Протагонист: Мира, картограф",
        "Конфликт: Гильдия скрывает карты",
        "Ставки: Затонет весь архипелаг",
      ].join("\n"),
    );
  });

  it("works from premise fields alone when the logline is missing", () => {
    expect(
      derivePremiseFromConcept({
        ...base,
        premise: { protagonist: "Мира" },
      }),
    ).toBe("Протагонист: Мира");
  });

  it("uses the hook alone when the premise is otherwise empty", () => {
    expect(
      derivePremiseFromConcept({
        ...base,
        hook: "В списке — её имя.",
        premise: {},
      }),
    ).toBe("Крючок: В списке — её имя.");
  });

  it("appends the hook after stakes, pinning the line order", () => {
    const out = derivePremiseFromConcept({
      ...base,
      hook: "В списке — её имя.",
      premise: {
        logline: "Картограф ищет остров, которого нет.",
        protagonist: "Мира, картограф",
        conflict: "Гильдия скрывает карты",
        stakes: "Затонет весь архипелаг",
      },
    });
    expect(out).toBe(
      [
        "Картограф ищет остров, которого нет.",
        "Протагонист: Мира, картограф",
        "Конфликт: Гильдия скрывает карты",
        "Ставки: Затонет весь архипелаг",
        "Крючок: В списке — её имя.",
      ].join("\n"),
    );
  });

  it("does not emit the hook line when the hook is blank or whitespace-only", () => {
    expect(
      derivePremiseFromConcept({
        ...base,
        hook: "   ",
        premise: { logline: "Картограф ищет остров, которого нет." },
      }),
    ).toBe("Картограф ищет остров, которого нет.");
  });
});
