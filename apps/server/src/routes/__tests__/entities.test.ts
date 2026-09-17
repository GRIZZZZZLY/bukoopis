import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson {
  id: number;
}
interface CharacterJson {
  id: number;
  bookId: number;
  canonicalName: string;
  profile: { description: string; want?: string | null };
  revision: number;
}
interface LocationJson {
  id: number;
  bookId: number;
  name: string;
  profile: { description: string };
}
interface HookJson {
  id: number;
  status: string;
  description: string;
}
interface RelationshipJson {
  id: number;
  fromCharacterId: number;
  toCharacterId: number;
  type: string;
  tension: number;
  revision: number;
}

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Knowledge test",
  });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("characters CRUD", () => {
  it("creates and lists a character", async () => {
    const c = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      {
        canonicalName: "Ратибор",
        profile: { description: "Молодой колдун", want: "Месть" },
      },
    );
    expect(c.id).toBeGreaterThan(0);
    expect(c.canonicalName).toBe("Ратибор");
    const list = await sendJson<CharacterJson[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(list.length).toBe(1);
  });

  it("validates create body (400)", async () => {
    const res = await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "",
      profile: {},
    });
    expect(res.status).toBe(400);
  });

  it("404 when book missing for character create", async () => {
    const res = await send(t.app, `/api/books/9999/characters`, "POST", {
      canonicalName: "X",
      profile: { description: "y" },
    });
    expect(res.status).toBe(404);
  });

  it("patches profile only (canonicalName preserved)", async () => {
    const c = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      {
        canonicalName: "Ратибор",
        profile: { description: "v1" },
      },
    );
    const u = await sendJson<CharacterJson>(
      t.app,
      `/api/characters/${c.id}`,
      "PATCH",
      { expectedRevision: c.revision, profile: { description: "v2", want: "Power" } },
    );
    expect(u.canonicalName).toBe("Ратибор");
    expect(u.profile.description).toBe("v2");
    expect(u.profile.want).toBe("Power");
  });

  it("deletes character cascading knowledge + relationships", async () => {
    const c1 = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "A", profile: { description: "x" } },
    );
    const c2 = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "B", profile: { description: "y" } },
    );
    await send(t.app, `/api/characters/${c1.id}/knowledge`, "POST", {
      fact: "знает тайну",
    });
    await send(t.app, `/api/books/${bookId}/relationships`, "POST", {
      fromCharacterId: c1.id,
      toCharacterId: c2.id,
      type: "враг",
      tension: -0.8,
    });
    const del = await send(t.app, `/api/characters/${c1.id}`, "DELETE");
    expect(del.status).toBe(204);
    const rels = await sendJson<RelationshipJson[]>(
      t.app,
      `/api/books/${bookId}/relationships`,
      "GET",
    );
    expect(rels.length).toBe(0);
  });
});

describe("locations CRUD", () => {
  it("creates location", async () => {
    const l = await sendJson<LocationJson>(
      t.app,
      `/api/books/${bookId}/locations`,
      "POST",
      { name: "Капище", profile: { description: "лесная поляна" } },
    );
    expect(l.name).toBe("Капище");
  });

  it("rejects invalid profile", async () => {
    const res = await send(t.app, `/api/books/${bookId}/locations`, "POST", {
      name: "X",
      profile: {},
    });
    expect(res.status).toBe(400);
  });
});

describe("items CRUD", () => {
  it("creates item", async () => {
    const i = await sendJson<{ id: number; name: string }>(
      t.app,
      `/api/books/${bookId}/items`,
      "POST",
      {
        name: "Посох Велеса",
        profile: { description: "древний посох с рунами" },
      },
    );
    expect(i.name).toBe("Посох Велеса");
  });
});

describe("hooks CRUD", () => {
  it("creates hook with default status=open", async () => {
    const h = await sendJson<HookJson>(
      t.app,
      `/api/books/${bookId}/hooks`,
      "POST",
      { description: "Кто отравил князя?" },
    );
    expect(h.status).toBe("open");
  });

  it("filters by status", async () => {
    await send(t.app, `/api/books/${bookId}/hooks`, "POST", {
      description: "h1",
    });
    const h2 = await sendJson<HookJson>(
      t.app,
      `/api/books/${bookId}/hooks`,
      "POST",
      { description: "h2" },
    );
    await send(t.app, `/api/hooks/${h2.id}`, "PATCH", { status: "resolved" });
    const open = await sendJson<HookJson[]>(
      t.app,
      `/api/books/${bookId}/hooks?status=open`,
      "GET",
    );
    expect(open.length).toBe(1);
    const resolved = await sendJson<HookJson[]>(
      t.app,
      `/api/books/${bookId}/hooks?status=resolved`,
      "GET",
    );
    expect(resolved.length).toBe(1);
  });

  it("rejects invalid status", async () => {
    const res = await send(t.app, `/api/books/${bookId}/hooks`, "POST", {
      description: "x",
      status: "invalid",
    });
    expect(res.status).toBe(400);
  });
});

describe("relationships CRUD", () => {
  it("rejects from===to", async () => {
    const c = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "A", profile: { description: "x" } },
    );
    const res = await send(
      t.app,
      `/api/books/${bookId}/relationships`,
      "POST",
      { fromCharacterId: c.id, toCharacterId: c.id, type: "self" },
    );
    expect(res.status).toBe(400);
  });

  it("rejects characters from other book", async () => {
    const otherBook = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "Other",
    });
    const cThis = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "Mine", profile: { description: "x" } },
    );
    const cOther = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${otherBook.id}/characters`,
      "POST",
      { canonicalName: "Foreign", profile: { description: "y" } },
    );
    const res = await send(
      t.app,
      `/api/books/${bookId}/relationships`,
      "POST",
      {
        fromCharacterId: cThis.id,
        toCharacterId: cOther.id,
        type: "rival",
      },
    );
    expect(res.status).toBe(400);
  });

  it("creates and patches tension", async () => {
    const a = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "A", profile: { description: "x" } },
    );
    const b = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "B", profile: { description: "y" } },
    );
    const r = await sendJson<RelationshipJson>(
      t.app,
      `/api/books/${bookId}/relationships`,
      "POST",
      {
        fromCharacterId: a.id,
        toCharacterId: b.id,
        type: "наставник",
        tension: -0.3,
      },
    );
    expect(r.tension).toBeCloseTo(-0.3, 5);
    const u = await sendJson<RelationshipJson>(
      t.app,
      `/api/relationships/${r.id}`,
      "PATCH",
      { expectedRevision: r.revision, tension: 0.7 },
    );
    expect(u.tension).toBeCloseTo(0.7, 5);
  });
});

describe("character knowledge", () => {
  it("creates and lists knowledge", async () => {
    const c = await sendJson<CharacterJson>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "Ратибор", profile: { description: "x" } },
    );
    await send(t.app, `/api/characters/${c.id}/knowledge`, "POST", {
      fact: "знает тайну Всеслава",
    });
    const list = await sendJson<{ fact: string }[]>(
      t.app,
      `/api/characters/${c.id}/knowledge`,
      "GET",
    );
    expect(list.length).toBe(1);
    expect(list[0]!.fact).toContain("тайну");
  });
});
