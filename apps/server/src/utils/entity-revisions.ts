import type { Database as DatabaseType } from "better-sqlite3";

/** Единственное место, где растёт ревизия персонажа или отношения.
 *  Наращивание и запись в историю идут одной транзакцией: ревизия без
 *  своей строки истории — это потерянная авторская версия (INV-06). */

export type ProfileEntityType = "character" | "relationship";
export type ProfileOrigin =
  | "author"
  | "llm"
  | "import"
  | "materialize"
  | "migration";

export class RevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("ревизия изменилась");
    this.name = "RevisionConflictError";
  }
}

export function recordProfileVersion(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    entityType: ProfileEntityType;
    entityId: number;
    revision: number;
    profileJson: string;
    origin: ProfileOrigin;
    note?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO entity_profile_versions
         (book_id, entity_type, entity_id, revision, profile_json, origin, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.bookId,
      args.entityType,
      args.entityId,
      args.revision,
      args.profileJson,
      args.origin,
      args.note ?? null,
      new Date().toISOString(),
    );
}

export function deleteProfileVersions(
  sqlite: DatabaseType,
  entityType: ProfileEntityType,
  entityId: number,
): void {
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        "DELETE FROM entity_profile_versions WHERE entity_type = ? AND entity_id = ?",
      )
      .run(entityType, entityId);
  });
  tx.immediate();
}

/** Сравнение с ожидаемой ревизией, запись, рост, история — одна транзакция.
 *  Перечитываем ревизию внутри транзакции; UPDATE охранён WHERE revision = ?.
 *  Бросает `RevisionConflictError`; вызывающий маршрут превращает её в 409. */
export function bumpEntityRevision(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    entityType: ProfileEntityType;
    entityId: number;
    expectedRevision: number;
    profileJson: string;
    origin: ProfileOrigin;
    /** Применяет остальные колонки строки; ревизию в WHERE. Возвращает true если UPDATE затронул строку. */
    applyColumns: (nextRevision: number, now: string) => boolean;
  },
): number {
  const tx = sqlite.transaction((): number => {
    // Перечитываем в транзакции для точной проверки
    const table = args.entityType === "character" ? "characters" : "relationships";
    const currentRow = sqlite
      .prepare(`SELECT revision FROM ${table} WHERE id = ?`)
      .get(args.entityId) as { revision: number } | undefined;
    const currentRevision = currentRow?.revision ?? 0;

    if (currentRevision !== args.expectedRevision) {
      throw new RevisionConflictError(currentRevision);
    }
    const next = currentRevision + 1;
    const now = new Date().toISOString();
    const success = args.applyColumns(next, now);
    if (!success) {
      throw new RevisionConflictError(currentRevision);
    }
    recordProfileVersion(sqlite, {
      bookId: args.bookId,
      entityType: args.entityType,
      entityId: args.entityId,
      revision: next,
      profileJson: args.profileJson,
      origin: args.origin,
    });
    return next;
  });
  return tx.immediate();
}
