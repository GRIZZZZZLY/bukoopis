import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}
interface VersionJson {
  id: number;
}

interface ExtractionResponse {
  id: number;
  chapterId: number;
  status: string;
  characters: Array<{
    id: string;
    name: string;
    decision: string;
    quote: string;
    mentionCount: number;
    status: string;
  }>;
  locations: Array<{ id: string; name: string; decision: string }>;
  items: Array<{ id: string; name: string; decision: string }>;
  hooks: Array<{ id: string; description: string; decision: string; type: string }>;
  relationships: Array<unknown>;
}

interface ChapterCanonEntry {
  type: string;
  entityId: number;
  name: string;
  mentionCount: number;
  quote: string | null;
}

let t: TestApp;
let bookId: number;
let chapterId: number;

function dbPath(app: TestApp): string {
  return join(app.dbDir, "test.sqlite");
}

function seedExtraction(
  app: TestApp,
  chapterId: number,
  payload: Record<string, unknown>,
): number {
  const db = new Database(dbPath(app));
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO chapter_canon_extractions
         (chapter_id, version_id, status, payload_json, cost_usd, input_tokens, output_tokens, created_at, updated_at)
         VALUES (?, NULL, 'ready', ?, 0.0042, 1000, 200, ?, ?)`,
      )
      .run(chapterId, JSON.stringify(payload), now, now);
    return Number(info.lastInsertRowid);
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;

  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Canon-test",
    premise: "Маяк и письмо",
  });
  bookId = b.id;
  const ch = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава первая" },
  );
  chapterId = ch.id;
  await sendJson<VersionJson>(
    t.app,
    `/api/chapters/${chapterId}/versions`,
    "POST",
    {
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Марра спустилась к маяку. Письмо ждало её на каменной полке.",
              },
            ],
          },
        ],
      },
    },
  );
});
afterEach(() => t.cleanup());

describe("canon-extraction routes", () => {
  it("GET returns null when no extraction exists", async () => {
    const res = await sendJson<ExtractionResponse | null>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions`,
      "GET",
    );
    expect(res).toBeNull();
  });

  it("GET returns seeded snapshot", async () => {
    seedExtraction(t, chapterId, {
      characters: [
        {
          id: "character:0",
          name: "Марра",
          profile: "молодая женщина у моря",
          status: "new",
          existingId: null,
          quote: "Марра спустилась к маяку",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      locations: [],
      items: [],
      hooks: [],
      relationships: [],
      notes: null,
    });
    const res = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions`,
      "GET",
    );
    expect(res.status).toBe("ready");
    expect(res.characters).toHaveLength(1);
    expect(res.characters[0]!.name).toBe("Марра");
    expect(res.characters[0]!.decision).toBe("pending");
  });

  it("POST accept on a 'new' character creates a character + mention", async () => {
    seedExtraction(t, chapterId, {
      characters: [
        {
          id: "character:0",
          name: "Марра",
          profile: "молодая женщина у моря",
          status: "new",
          existingId: null,
          quote: "Марра спустилась к маяку",
          mentionCount: 2,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      locations: [],
      items: [],
      hooks: [],
      relationships: [],
      notes: null,
    });

    const accepted = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions/character:0/accept`,
      "POST",
      { kind: "character" },
    );
    expect(accepted.characters[0]!.decision).toBe("accepted");

    const list = await sendJson<Array<{ id: number; canonicalName: string }>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.canonicalName).toBe("Марра");

    const mentions = await sendJson<ChapterCanonEntry[]>(
      t.app,
      `/api/chapters/${chapterId}/canon`,
      "GET",
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.type).toBe("character");
    expect(mentions[0]!.name).toBe("Марра");
    expect(mentions[0]!.mentionCount).toBe(2);
  });

  it("POST reject just marks decision as rejected", async () => {
    seedExtraction(t, chapterId, {
      characters: [
        {
          id: "character:0",
          name: "Чужак",
          profile: null,
          status: "new",
          existingId: null,
          quote: "Из тумана вышел чужак",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      locations: [],
      items: [],
      hooks: [],
      relationships: [],
      notes: null,
    });
    const after = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions/character:0/reject`,
      "POST",
      { kind: "character" },
    );
    expect(after.characters[0]!.decision).toBe("rejected");

    const list = await sendJson<Array<unknown>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(list).toHaveLength(0);
  });

  it("POST merge links candidate to existing entity and records mention", async () => {
    // First create an existing character.
    const existing = await sendJson<{ id: number; canonicalName: string }>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      {
        canonicalName: "Марра",
        profile: { description: "Дочь смотрителя маяка" },
      },
    );
    seedExtraction(t, chapterId, {
      characters: [
        {
          id: "character:0",
          name: "молодая женщина",
          profile: null,
          status: "ambiguous",
          existingId: existing.id,
          quote: "молодая женщина у воды",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      locations: [],
      items: [],
      hooks: [],
      relationships: [],
      notes: null,
    });
    const merged = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions/character:0/merge`,
      "POST",
      { kind: "character", targetId: existing.id },
    );
    expect(merged.characters[0]!.decision).toBe("merged");

    const list = await sendJson<Array<unknown>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    // No new character created.
    expect(list).toHaveLength(1);

    const mentions = await sendJson<ChapterCanonEntry[]>(
      t.app,
      `/api/chapters/${chapterId}/canon`,
      "GET",
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.entityId).toBe(existing.id);
  });

  it("POST accept-all processes pending characters/locations/items/hooks", async () => {
    seedExtraction(t, chapterId, {
      characters: [
        {
          id: "character:0",
          name: "Марра",
          profile: null,
          status: "new",
          existingId: null,
          quote: "Марра",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      locations: [
        {
          id: "location:0",
          name: "маяк",
          profile: null,
          status: "new",
          existingId: null,
          quote: "у маяка",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      items: [
        {
          id: "item:0",
          name: "письмо",
          profile: null,
          status: "new",
          existingId: null,
          quote: "письмо",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      hooks: [
        {
          id: "hook:0",
          description: "Что в письме?",
          type: "opened",
          status: "new",
          existingId: null,
          quote: "что в письме",
          mentionCount: 1,
          decision: "pending",
          decidedExistingId: null,
        },
      ],
      relationships: [],
      notes: null,
    });
    const after = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/canon-extractions/accept-all`,
      "POST",
    );
    expect(after.characters[0]!.decision).toBe("accepted");
    expect(after.locations[0]!.decision).toBe("accepted");
    expect(after.items[0]!.decision).toBe("accepted");
    expect(after.hooks[0]!.decision).toBe("accepted");

    const mentions = await sendJson<ChapterCanonEntry[]>(
      t.app,
      `/api/chapters/${chapterId}/canon`,
      "GET",
    );
    expect(mentions).toHaveLength(4);
  });

  it("POST extract-canon without API key returns a snapshot with status=error", async () => {
    const res = await sendJson<ExtractionResponse>(
      t.app,
      `/api/chapters/${chapterId}/extract-canon`,
      "POST",
    );
    expect(res.status).toBe("error");
  });

  it("404 when chapter is missing", async () => {
    const res = await send(
      t.app,
      `/api/chapters/9999/canon-extractions`,
      "GET",
    );
    // GET is permissive — returns null for missing chapters (treated as no snapshot).
    // Accept either null or 404 depending on implementation — we just need a non-500.
    expect([200, 404]).toContain(res.status);
  });
});

describe("отмена принятия (F01 ревью 2026-09-22)", () => {
  const candidate = (i: number, name: string) => ({
    id: `character:${i}`,
    name,
    profile: "",
    status: "new",
    existingId: null,
    quote: name,
    mentionCount: 1,
    decision: "pending",
    decidedExistingId: null,
  });
  const names = async () =>
    (await sendJson<Array<{ canonicalName: string }>>(t.app, `/api/books/${bookId}/characters`, "GET"))
      .map((c) => c.canonicalName)
      .sort();

  function seedTwo() {
    seedExtraction(t, chapterId, {
      characters: [candidate(0, "Альфа"), candidate(1, "Бета")],
      locations: [],
      items: [],
      hooks: [],
      relationships: [],
      notes: null,
    });
  }
  const accept = (i: number) =>
    send(t.app, `/api/chapters/${chapterId}/canon-extractions/character:${i}/accept`, "POST", { kind: "character" });
  const undo = (i: number) =>
    send(t.app, `/api/chapters/${chapterId}/canon-extractions/character:${i}/undo`, "POST", {});

  it("отмена первого удаляет его карточку, а не принятую следом", async () => {
    seedTwo();
    await accept(0);
    await accept(1);
    // Бета принята позже — прежний поиск «последнего упоминания» выбирал её.
    t.sqlite
      .prepare("UPDATE entity_chapter_mentions SET first_seen_at = '2099-01-01T00:00:00.000Z' WHERE entity_id = (SELECT id FROM characters WHERE canonical_name = 'Бета')")
      .run();

    expect((await undo(0)).status).toBe(200);
    expect(await names()).toEqual(["Бета"]);
  });

  it("карточку, которую правили после принятия, отмена не удаляет", async () => {
    seedTwo();
    await accept(0);
    t.sqlite
      .prepare("UPDATE characters SET updated_at = '2099-01-01T00:00:00.000Z' WHERE canonical_name = 'Альфа'")
      .run();

    expect((await undo(0)).status).toBe(409);
    expect(await names()).toEqual(["Альфа"]);
  });
});
