import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createCharacterInputSchema,
  updateCharacterInputSchema,
  createLocationInputSchema,
  updateLocationInputSchema,
  createItemInputSchema,
  updateItemInputSchema,
  createHookInputSchema,
  updateHookInputSchema,
  createRelationshipInputSchema,
  updateRelationshipInputSchema,
  createCharacterKnowledgeInputSchema,
} from "@book-forge/shared";
import {
  toCharacter,
  toLocation,
  toItem,
  toHook,
  toRelationship,
  toCharacterKnowledge,
  type CharacterRow,
  type LocationRow,
  type ItemRow,
  type HookRow,
  type RelationshipRow,
  type CharacterKnowledgeRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import {
  addEntityAlias,
  listEntityAliases,
  deleteEntityAlias,
} from "../utils/entity-resolve.js";
import { z } from "zod";

function bookExists(sqlite: DatabaseType, id: number): boolean {
  const row = sqlite
    .prepare("SELECT id FROM books WHERE id = ?")
    .get(id) as { id: number } | undefined;
  return Boolean(row);
}

function bumpBook(sqlite: DatabaseType, bookId: number): void {
  sqlite
    .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), bookId);
}

export function createEntitiesRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();

  // ─────────────── Characters ───────────────

  r.get("/books/:id/characters", (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const rows = sqlite
      .prepare(
        "SELECT * FROM characters WHERE book_id = ? ORDER BY canonical_name ASC",
      )
      .all(id) as CharacterRow[];
    return c.json(rows.map(toCharacter));
  });

  r.post("/books/:id/characters", async (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createCharacterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.data.canonicalName,
        JSON.stringify(parsed.data.profile),
        now,
        now,
      );
    bumpBook(sqlite, id);
    const row = sqlite
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(info.lastInsertRowid) as CharacterRow;
    return c.json(toCharacter(row), 201);
  });

  r.get("/characters/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = sqlite
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(id) as CharacterRow | undefined;
    if (!row) return notFound(c, "character");
    return c.json(toCharacter(row));
  });

  r.patch("/characters/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateCharacterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(id) as CharacterRow | undefined;
    if (!existing) return notFound(c, "character");
    const next = {
      canonicalName: parsed.data.canonicalName ?? existing.canonical_name,
      profileJson: parsed.data.profile
        ? JSON.stringify(parsed.data.profile)
        : existing.profile_json,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE characters SET canonical_name = ?, profile_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.canonicalName, next.profileJson, now, id);
    bumpBook(sqlite, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(id) as CharacterRow;
    return c.json(toCharacter(row));
  });

  r.delete("/characters/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM characters WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "character");
    sqlite.prepare("DELETE FROM characters WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Locations ───────────────

  r.get("/books/:id/locations", (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const rows = sqlite
      .prepare("SELECT * FROM locations WHERE book_id = ? ORDER BY name ASC")
      .all(id) as LocationRow[];
    return c.json(rows.map(toLocation));
  });

  r.post("/books/:id/locations", async (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createLocationInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO locations (book_id, name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, parsed.data.name, JSON.stringify(parsed.data.profile), now, now);
    bumpBook(sqlite, id);
    const row = sqlite
      .prepare("SELECT * FROM locations WHERE id = ?")
      .get(info.lastInsertRowid) as LocationRow;
    return c.json(toLocation(row), 201);
  });

  r.patch("/locations/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateLocationInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM locations WHERE id = ?")
      .get(id) as LocationRow | undefined;
    if (!existing) return notFound(c, "location");
    const next = {
      name: parsed.data.name ?? existing.name,
      profileJson: parsed.data.profile
        ? JSON.stringify(parsed.data.profile)
        : existing.profile_json,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE locations SET name = ?, profile_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.name, next.profileJson, now, id);
    bumpBook(sqlite, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM locations WHERE id = ?")
      .get(id) as LocationRow;
    return c.json(toLocation(row));
  });

  r.delete("/locations/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM locations WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "location");
    sqlite.prepare("DELETE FROM locations WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Items ───────────────

  r.get("/books/:id/items", (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const rows = sqlite
      .prepare("SELECT * FROM items WHERE book_id = ? ORDER BY name ASC")
      .all(id) as ItemRow[];
    return c.json(rows.map(toItem));
  });

  r.post("/books/:id/items", async (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createItemInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO items (book_id, name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, parsed.data.name, JSON.stringify(parsed.data.profile), now, now);
    bumpBook(sqlite, id);
    const row = sqlite
      .prepare("SELECT * FROM items WHERE id = ?")
      .get(info.lastInsertRowid) as ItemRow;
    return c.json(toItem(row), 201);
  });

  r.patch("/items/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateItemInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM items WHERE id = ?")
      .get(id) as ItemRow | undefined;
    if (!existing) return notFound(c, "item");
    const next = {
      name: parsed.data.name ?? existing.name,
      profileJson: parsed.data.profile
        ? JSON.stringify(parsed.data.profile)
        : existing.profile_json,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE items SET name = ?, profile_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.name, next.profileJson, now, id);
    bumpBook(sqlite, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM items WHERE id = ?")
      .get(id) as ItemRow;
    return c.json(toItem(row));
  });

  r.delete("/items/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM items WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "item");
    sqlite.prepare("DELETE FROM items WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Hooks ───────────────

  r.get("/books/:id/hooks", (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const status = c.req.query("status");
    const rows = status
      ? (sqlite
          .prepare(
            "SELECT * FROM hooks WHERE book_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(id, status) as HookRow[])
      : (sqlite
          .prepare(
            "SELECT * FROM hooks WHERE book_id = ? ORDER BY created_at DESC",
          )
          .all(id) as HookRow[]);
    return c.json(rows.map(toHook));
  });

  r.post("/books/:id/hooks", async (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createHookInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO hooks
         (book_id, seed_chapter_id, description, status, expected_resolution_chapter_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.data.seedChapterId ?? null,
        parsed.data.description,
        parsed.data.status ?? "open",
        parsed.data.expectedResolutionChapterOrder ?? null,
        now,
        now,
      );
    bumpBook(sqlite, id);
    const row = sqlite
      .prepare("SELECT * FROM hooks WHERE id = ?")
      .get(info.lastInsertRowid) as HookRow;
    return c.json(toHook(row), 201);
  });

  r.patch("/hooks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateHookInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM hooks WHERE id = ?")
      .get(id) as HookRow | undefined;
    if (!existing) return notFound(c, "hook");
    const next = {
      seedChapterId:
        parsed.data.seedChapterId === undefined
          ? existing.seed_chapter_id
          : parsed.data.seedChapterId,
      description: parsed.data.description ?? existing.description,
      status: parsed.data.status ?? existing.status,
      expected:
        parsed.data.expectedResolutionChapterOrder === undefined
          ? existing.expected_resolution_chapter_order
          : parsed.data.expectedResolutionChapterOrder,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE hooks
         SET seed_chapter_id = ?, description = ?, status = ?,
             expected_resolution_chapter_order = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.seedChapterId,
        next.description,
        next.status,
        next.expected,
        now,
        id,
      );
    bumpBook(sqlite, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM hooks WHERE id = ?")
      .get(id) as HookRow;
    return c.json(toHook(row));
  });

  r.delete("/hooks/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM hooks WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "hook");
    sqlite.prepare("DELETE FROM hooks WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Relationships ───────────────

  r.get("/books/:id/relationships", (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const rows = sqlite
      .prepare(
        "SELECT * FROM relationships WHERE book_id = ? ORDER BY created_at DESC",
      )
      .all(id) as RelationshipRow[];
    return c.json(rows.map(toRelationship));
  });

  r.post("/books/:id/relationships", async (c) => {
    const id = Number(c.req.param("id"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createRelationshipInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    if (parsed.data.fromCharacterId === parsed.data.toCharacterId) {
      return badRequest(c, "from and to must differ");
    }
    // both characters must belong to this book
    const both = sqlite
      .prepare(
        `SELECT COUNT(*) c FROM characters
         WHERE book_id = ? AND id IN (?, ?)`,
      )
      .get(id, parsed.data.fromCharacterId, parsed.data.toCharacterId) as {
      c: number;
    };
    if (both.c !== 2) {
      return badRequest(c, "both characters must belong to this book");
    }
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO relationships
         (book_id, from_character_id, to_character_id, type, tension, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.data.fromCharacterId,
        parsed.data.toCharacterId,
        parsed.data.type,
        parsed.data.tension ?? 0,
        parsed.data.notes ?? null,
        now,
        now,
      );
    bumpBook(sqlite, id);
    const row = sqlite
      .prepare("SELECT * FROM relationships WHERE id = ?")
      .get(info.lastInsertRowid) as RelationshipRow;
    return c.json(toRelationship(row), 201);
  });

  r.patch("/relationships/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateRelationshipInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM relationships WHERE id = ?")
      .get(id) as RelationshipRow | undefined;
    if (!existing) return notFound(c, "relationship");
    const next = {
      type: parsed.data.type ?? existing.type,
      tension: parsed.data.tension ?? existing.tension,
      notes:
        parsed.data.notes === undefined ? existing.notes : parsed.data.notes,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE relationships SET type = ?, tension = ?, notes = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.type, next.tension, next.notes, now, id);
    bumpBook(sqlite, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM relationships WHERE id = ?")
      .get(id) as RelationshipRow;
    return c.json(toRelationship(row));
  });

  r.delete("/relationships/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM relationships WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "relationship");
    sqlite.prepare("DELETE FROM relationships WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Character knowledge ───────────────

  r.get("/characters/:id/knowledge", (c) => {
    const id = Number(c.req.param("id"));
    const character = sqlite
      .prepare("SELECT id FROM characters WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!character) return notFound(c, "character");
    const rows = sqlite
      .prepare(
        "SELECT * FROM character_knowledge WHERE character_id = ? ORDER BY created_at ASC",
      )
      .all(id) as CharacterKnowledgeRow[];
    return c.json(rows.map(toCharacterKnowledge));
  });

  r.post("/characters/:id/knowledge", async (c) => {
    const id = Number(c.req.param("id"));
    const character = sqlite
      .prepare("SELECT book_id FROM characters WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!character) return notFound(c, "character");
    const body = await c.req.json().catch(() => null);
    const parsed = createCharacterKnowledgeInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO character_knowledge (character_id, fact, learned_in_chapter_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.data.fact,
        parsed.data.learnedInChapterId ?? null,
        now,
      );
    bumpBook(sqlite, character.book_id);
    const row = sqlite
      .prepare("SELECT * FROM character_knowledge WHERE id = ?")
      .get(info.lastInsertRowid) as CharacterKnowledgeRow;
    return c.json(toCharacterKnowledge(row), 201);
  });

  r.delete("/character-knowledge/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare(
        `SELECT k.id, c.book_id
         FROM character_knowledge k
         JOIN characters c ON c.id = k.character_id
         WHERE k.id = ?`,
      )
      .get(id) as { id: number; book_id: number } | undefined;
    if (!existing) return notFound(c, "knowledge");
    sqlite.prepare("DELETE FROM character_knowledge WHERE id = ?").run(id);
    bumpBook(sqlite, existing.book_id);
    return c.body(null, 204);
  });

  // ─────────────── Entity aliases (ADR 0003 slice 2) ───────────────
  // Author-managed fallback for names the fact extractor can't normalize
  // (stubborn case forms, nicknames). Resolved names collapse facts to one
  // stable entity id.

  const ALIAS_TYPES = new Set(["character", "location", "item"]);
  const aliasTableFor = (t: string): string =>
    t === "character" ? "characters" : t === "location" ? "locations" : "items";

  function entityExists(
    sqlite2: DatabaseType,
    bookId: number,
    type: string,
    entityId: number,
  ): boolean {
    const row = sqlite2
      .prepare(
        `SELECT id FROM ${aliasTableFor(type)} WHERE id = ? AND book_id = ?`,
      )
      .get(entityId, bookId) as { id: number } | undefined;
    return Boolean(row);
  }

  r.get("/books/:id/entities/:type/:entityId/aliases", (c) => {
    const id = Number(c.req.param("id"));
    const type = c.req.param("type");
    const entityId = Number(c.req.param("entityId"));
    if (!ALIAS_TYPES.has(type)) return badRequest(c, "invalid entity type");
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    return c.json(
      listEntityAliases(
        sqlite,
        id,
        type as "character" | "location" | "item",
        entityId,
      ),
    );
  });

  r.post("/books/:id/entities/:type/:entityId/aliases", async (c) => {
    const id = Number(c.req.param("id"));
    const type = c.req.param("type");
    const entityId = Number(c.req.param("entityId"));
    if (!ALIAS_TYPES.has(type)) return badRequest(c, "invalid entity type");
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    if (!entityExists(sqlite, id, type, entityId))
      return notFound(c, "entity");
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({ alias: z.string().min(1).max(160) })
      .safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const res = addEntityAlias(
      sqlite,
      id,
      type as "character" | "location" | "item",
      entityId,
      parsed.data.alias,
    );
    if (!res.ok) {
      return badRequest(
        c,
        res.conflict !== undefined
          ? `alias already maps to entity ${res.conflict}`
          : "invalid alias",
      );
    }
    bumpBook(sqlite, id);
    return c.json(
      listEntityAliases(
        sqlite,
        id,
        type as "character" | "location" | "item",
        entityId,
      ),
      201,
    );
  });

  r.delete("/books/:id/aliases/:aliasId", (c) => {
    const id = Number(c.req.param("id"));
    const aliasId = Number(c.req.param("aliasId"));
    if (!bookExists(sqlite, id)) return notFound(c, "book");
    if (!deleteEntityAlias(sqlite, id, aliasId)) return notFound(c, "alias");
    bumpBook(sqlite, id);
    return c.body(null, 204);
  });

  return r;
}
