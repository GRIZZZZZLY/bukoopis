import type { Database as DatabaseType } from "better-sqlite3";
import type { FactEntityType } from "@book-forge/shared";

/**
 * ADR 0003 slice 2 — resolve a canon-fact entity name to a stable entity id.
 *
 * `book_facts.entity_id` has existed since 0012 but was never populated, so
 * facts scattered by name string — a real problem in Russian where "Иван",
 * "Ивана", "Ване" and a nickname are different strings. Resolution matches
 * (case-insensitively) the canonical table first, then author-registered
 * aliases. `world` facts have no backing table and never resolve.
 *
 * The extractor is separately told to prefer canonical names from the known
 * list; aliases cover the cases it can't normalize on its own.
 */

export interface ResolvedEntity {
  entityId: number;
  canonicalName: string;
}

export function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase();
}

/** Исход разбора имени. `ambiguous` и `unknown` для вызывающего — разные
 *  вещи: первое надо показать автору (два героя с одним именем — его
 *  решение), второе просто значит «в каноне такого нет». `resolveEntity`
 *  схлопывает оба в `null`, чего сборке контекста мало (раздел 8.2 ТЗ). */
export type EntityResolution =
  | { status: "resolved"; entity: ResolvedEntity }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unknown" };

export function resolveEntity(
  sqlite: DatabaseType,
  bookId: number,
  entityType: FactEntityType,
  name: string,
): ResolvedEntity | null {
  const r = resolveEntityDetailed(sqlite, bookId, entityType, name);
  return r.status === "resolved" ? r.entity : null;
}

export function resolveEntityDetailed(
  sqlite: DatabaseType,
  bookId: number,
  entityType: FactEntityType,
  name: string,
): EntityResolution {
  if (entityType === "world") return { status: "unknown" };
  const norm = normalizeEntityName(name);
  if (!norm) return { status: "unknown" };

  // Case-insensitive compare in JS — SQLite's built-in lower() is ASCII-only
  // and leaves Cyrillic untouched, so "Айрис" would never match "айрис".
  // Две сущности с одинаковым нормализованным именем — это неоднозначность,
  // а не «возьмём первого». Тихий выбор пришивает факт чужой сущности и
  // обнаруживается только в готовой главе (AC-04).
  const rows =
    entityType === "character"
      ? (sqlite
          .prepare(`SELECT id, canonical_name AS name FROM characters WHERE book_id = ?`)
          .all(bookId) as Array<{ id: number; name: string }>)
      : (sqlite
          .prepare(
            `SELECT id, name FROM ${entityType === "location" ? "locations" : "items"} WHERE book_id = ?`,
          )
          .all(bookId) as Array<{ id: number; name: string }>);
  const hits = rows.filter((r) => normalizeEntityName(r.name) === norm);
  if (hits.length === 1) {
    const hit = hits[0]!;
    return { status: "resolved", entity: { entityId: hit.id, canonicalName: hit.name } };
  }
  if (hits.length > 1) {
    return { status: "ambiguous", candidates: hits.map((h) => h.name) };
  }

  // Alias fallback (author-registered).
  const alias = sqlite
    .prepare(
      `SELECT entity_id FROM entity_aliases
       WHERE book_id = ? AND entity_type = ? AND alias = ?`,
    )
    .get(bookId, entityType, norm) as { entity_id: number } | undefined;
  if (!alias) return { status: "unknown" };
  const entity = canonicalNameOf(sqlite, entityType, alias.entity_id);
  return entity ? { status: "resolved", entity } : { status: "unknown" };
}

function canonicalNameOf(
  sqlite: DatabaseType,
  entityType: FactEntityType,
  entityId: number,
): ResolvedEntity | null {
  if (entityType === "character") {
    const row = sqlite
      .prepare("SELECT canonical_name n FROM characters WHERE id = ?")
      .get(entityId) as { n: string } | undefined;
    return row ? { entityId, canonicalName: row.n } : null;
  }
  const table = entityType === "location" ? "locations" : "items";
  const row = sqlite
    .prepare(`SELECT name n FROM ${table} WHERE id = ?`)
    .get(entityId) as { n: string } | undefined;
  return row ? { entityId, canonicalName: row.n } : null;
}

export interface EntityAlias {
  id: number;
  alias: string;
  createdAt: string;
}

/** Register an alias for an entity (idempotent). Returns false if the alias
 *  already maps to a DIFFERENT entity of the same type (conflict). */
export function addEntityAlias(
  sqlite: DatabaseType,
  bookId: number,
  entityType: Exclude<FactEntityType, "world">,
  entityId: number,
  alias: string,
): { ok: boolean; conflict?: number } {
  const norm = normalizeEntityName(alias);
  if (!norm) return { ok: false };
  const existing = sqlite
    .prepare(
      `SELECT entity_id FROM entity_aliases
       WHERE book_id = ? AND entity_type = ? AND alias = ?`,
    )
    .get(bookId, entityType, norm) as { entity_id: number } | undefined;
  if (existing) {
    return existing.entity_id === entityId
      ? { ok: true }
      : { ok: false, conflict: existing.entity_id };
  }
  sqlite
    .prepare(
      `INSERT INTO entity_aliases (book_id, entity_type, entity_id, alias, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, entityType, entityId, norm, new Date().toISOString());
  return { ok: true };
}

export function listEntityAliases(
  sqlite: DatabaseType,
  bookId: number,
  entityType: Exclude<FactEntityType, "world">,
  entityId: number,
): EntityAlias[] {
  return sqlite
    .prepare(
      `SELECT id, alias, created_at AS createdAt FROM entity_aliases
       WHERE book_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY alias ASC`,
    )
    .all(bookId, entityType, entityId) as EntityAlias[];
}

export function deleteEntityAlias(
  sqlite: DatabaseType,
  bookId: number,
  aliasId: number,
): boolean {
  const res = sqlite
    .prepare("DELETE FROM entity_aliases WHERE id = ? AND book_id = ?")
    .run(aliasId, bookId);
  return res.changes > 0;
}
