import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson { id: number }
interface CharacterJson { id: number; revision: number; profile: Record<string, unknown> }
interface RelationshipJson { id: number; revision: number; profile: Record<string, unknown> }

let t: TestApp;
let bookId: number;
let rin: CharacterJson;
let sarek: CharacterJson;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Ревизии" });
  bookId = b.id;
  rin = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  sarek = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Сарек",
    profile: { description: "Навигатор." },
  });
});
afterEach(() => t.cleanup());

describe("ревизии персонажа", () => {
  it("AC-02: второе изменение с той же ревизией получает 409", async () => {
    const first = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: rin.revision,
      profile: { description: "Инженер.", want: "вернуть станцию" },
    });
    expect(first.status).toBe(200);

    const second = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: rin.revision,
      profile: { description: "Инженер.", want: "уйти со станции" },
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; details?: { currentRevision: number } };
    expect(body.error).toBe("revision_conflict");
    expect(body.details?.currentRevision).toBe(1);

    const after = await sendJson<CharacterJson>(t.app, `/api/characters/${rin.id}`, "GET");
    expect(after.profile.want).toBe("вернуть станцию");
    expect(after.revision).toBe(1);
  });

  it("PATCH без expectedRevision — 400", async () => {
    const r = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      profile: { description: "Инженер." },
    });
    expect(r.status).toBe(400);
  });

  it("принятая ревизия попадает в историю", async () => {
    await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: 0,
      profile: { description: "Инженер.", need: "просить помощь" },
    });
    const rows = t.sqlite
      .prepare(
        `SELECT revision, origin FROM entity_profile_versions
         WHERE entity_type = 'character' AND entity_id = ? ORDER BY revision`,
      )
      .all(rin.id) as Array<{ revision: number; origin: string }>;
    expect(rows.map((r) => r.revision)).toEqual([1]);
    expect(rows[0]?.origin).toBe("author");
  });
});

describe("направленные отношения", () => {
  it("AC-05: A доверяет B, B не доверяет A — направления независимы", async () => {
    const ab = await sendJson<RelationshipJson>(
      t.app, `/api/books/${bookId}/relationships`, "POST",
      { fromCharacterId: rin.id, toCharacterId: sarek.id, type: "напарник", tension: 0 },
    );
    const ba = await sendJson<RelationshipJson>(
      t.app, `/api/books/${bookId}/relationships`, "POST",
      { fromCharacterId: sarek.id, toCharacterId: rin.id, type: "напарник", tension: 0 },
    );

    await send(t.app, `/api/relationships/${ab.id}`, "PATCH", {
      expectedRevision: ab.revision,
      profile: { trust: "верит на слово", respect: "уважает выдержку" },
    });
    await send(t.app, `/api/relationships/${ba.id}`, "PATCH", {
      expectedRevision: ba.revision,
      profile: { trust: "не доверяет обещаниям", resentment: "не простил смену" },
    });

    const list = await sendJson<RelationshipJson[]>(
      t.app, `/api/books/${bookId}/relationships`, "GET",
    );
    const forward = list.find((r) => r.id === ab.id);
    const back = list.find((r) => r.id === ba.id);
    expect(forward?.profile.trust).toBe("верит на слово");
    expect(back?.profile.trust).toBe("не доверяет обещаниям");
    expect(forward?.profile.resentment).toBeNull();
  });

  it("AC-30: связь между книгами не создаётся", async () => {
    const other = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Чужая" });
    const alien = await sendJson<CharacterJson>(
      t.app, `/api/books/${other.id}/characters`, "POST",
      { canonicalName: "Чужой", profile: { description: "X" } },
    );
    const r = await send(t.app, `/api/books/${bookId}/relationships`, "POST", {
      fromCharacterId: rin.id, toCharacterId: alien.id, type: "враг", tension: 0,
    });
    expect(r.status).toBe(400);
  });
});
