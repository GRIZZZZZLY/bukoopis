import type { Database as DatabaseType } from "better-sqlite3";
import { extractCanonFacts } from "@book-forge/agents";
import type { ExtractedFact, FactEntityType, ExtractedCharacterEvent } from "@book-forge/shared";
import { logUsage } from "./usageLogger.js";
import { resolveEntity, normalizeEntityName } from "./entity-resolve.js";

/**
 * Phase 3 — temporal canon facts repository.
 *
 * Facts are time-scoped: `valid_from_chapter` .. `valid_to_chapter` (NULL =
 * still true). When a new chapter restates a fact for the same
 * (entity_type, entity_name, predicate) with a different value, the prior
 * active row is closed at `chapterOrder - 1` and linked via `superseded_by`.
 */

export interface ActiveFact {
  id: number;
  entityType: FactEntityType;
  entityName: string;
  predicate: string;
  objectText: string;
  validFromChapter: number;
}

interface ActiveFactRow {
  id: number;
  entity_type: FactEntityType;
  entity_name: string;
  predicate: string;
  object_text: string;
  valid_from_chapter: number;
}

/**
 * Facts true at `atChapterOrder`:
 *   valid_from <= cursor AND (valid_to IS NULL OR valid_to >= cursor)
 */
export function loadActiveFacts(
  sqlite: DatabaseType,
  bookId: number,
  atChapterOrder: number,
  opts?: { entityNames?: string[]; objectiveOnly?: boolean },
): ActiveFact[] {
  const params: unknown[] = [bookId, atChapterOrder, atChapterOrder];
  let nameClause = "";
  if (opts?.entityNames && opts.entityNames.length > 0) {
    const ph = opts.entityNames.map(() => "?").join(",");
    nameClause = ` AND entity_name IN (${ph})`;
    params.push(...opts.entityNames);
  }
  // ADR 0003 slice 1: by default only OBJECTIVE canon is served — character
  // statements/beliefs/rumors/dreams never reach Writer as world truth.
  const modeClause =
    opts?.objectiveOnly === false
      ? ""
      : ` AND assertion_mode IN ('narrated_as_fact','directly_observed')`;
  const rows = sqlite
    .prepare(
      `SELECT id, entity_type, entity_name, predicate, object_text, valid_from_chapter
       FROM book_facts
       WHERE book_id = ?
         AND valid_from_chapter <= ?
         AND (valid_to_chapter IS NULL OR valid_to_chapter >= ?)
         AND review_status <> 'rejected'
         ${nameClause}${modeClause}
       ORDER BY entity_type ASC, entity_name ASC, valid_from_chapter ASC`,
    )
    .all(...params) as ActiveFactRow[];
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entity_type,
    entityName: r.entity_name,
    predicate: r.predicate,
    objectText: r.object_text,
    validFromChapter: r.valid_from_chapter,
  }));
}

const TYPE_LABEL: Record<FactEntityType, string> = {
  character: "Персонаж",
  location: "Локация",
  item: "Предмет",
  world: "Мир",
};

/**
 * Render active facts as a prompt block grouped by entity. Returns null when
 * there are no active facts. `entityNames` scopes to mentioned entities.
 */
export function renderActiveFactsPrompt(
  sqlite: DatabaseType,
  bookId: number,
  atChapterOrder: number,
  opts?: { entityNames?: string[]; withIds?: boolean },
): string | null {
  const facts = loadActiveFacts(sqlite, bookId, atChapterOrder, opts);
  if (facts.length === 0) return null;

  // Group by entity; carry type/name in the value so the key stays an opaque
  // uniqueness token (no delimiter to parse — entity names may contain spaces).
  const byEntity = new Map<
    string,
    { type: FactEntityType; name: string; facts: ActiveFact[] }
  >();
  for (const f of facts) {
    const key = `${f.entityType}:${f.entityName}`;
    const group =
      byEntity.get(key) ??
      { type: f.entityType, name: f.entityName, facts: [] as ActiveFact[] };
    group.facts.push(f);
    byEntity.set(key, group);
  }

  const blocks: string[] = [];
  for (const { type, name, facts: group } of byEntity.values()) {
    // withIds prefixes each fact with its stable id (fact_<id>) so the
    // extractor can supersede facts explicitly (ADR 0003). Writer/critic
    // contexts stay id-free to avoid prompt noise.
    const lines = group.map(
      (f) =>
        `- ${opts?.withIds ? `[fact_${f.id}] ` : ""}${f.predicate}: ${f.objectText} (с гл. #${f.validFromChapter})`,
    );
    blocks.push(`### ${TYPE_LABEL[type]}: ${name}\n${lines.join("\n")}`);
  }
  return `## Канон-факты (актуальны на главу #${atChapterOrder})\n${blocks.join("\n\n")}`;
}

/**
 * Persist a chapter's extracted facts with temporal supersession.
 * Same-chapter re-extraction is idempotent (rows from this chapter onward for
 * the matched (type,name,predicate) are removed before re-insert).
 */
export function persistExtractedFacts(
  sqlite: DatabaseType,
  bookId: number,
  chapterOrder: number,
  sourceVersionId: number | null,
  facts: ExtractedFact[],
): void {
  const now = new Date().toISOString();
  const insertFact = sqlite.prepare(
    `INSERT INTO book_facts
       (book_id, entity_type, entity_id, entity_name, predicate,
        object_text, valid_from_chapter, valid_to_chapter,
        source_version_id, confidence, superseded_by, assertion_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
  );
  const tx = sqlite.transaction(() => {
    // Idempotency pre-pass: drop rows for each (type,name,predicate,mode)
    // this batch touches, introduced at this chapter or later — handles
    // re-running the same chapter. Done BEFORE inserts so two same-predicate
    // facts in ONE batch (multi-valued predicates) don't delete each other.
    const cleaned = new Set<string>();
    for (const f of facts) {
      const mode = f.assertionMode ?? "narrated_as_fact";
      const name = resolveEntity(sqlite, bookId, f.entityType, f.entityName)?.canonicalName ?? f.entityName;
      const key = [f.entityType, name, f.predicate, mode].join(" ");
      if (cleaned.has(key)) continue;
      cleaned.add(key);
      sqlite
        .prepare(
          `DELETE FROM book_facts
           WHERE book_id = ? AND entity_type = ? AND entity_name = ?
             AND predicate = ? AND assertion_mode = ? AND valid_from_chapter >= ?`,
        )
        .run(bookId, f.entityType, name, f.predicate, mode, chapterOrder);
    }

    for (const f of facts) {
      const mode = f.assertionMode ?? "narrated_as_fact";
      // ADR 0003 slice 2: resolve to a stable entity id + canonical name.
      const resolved = resolveEntity(sqlite, bookId, f.entityType, f.entityName);
      const entityId = resolved?.entityId ?? null;
      const name = resolved?.canonicalName ?? f.entityName;
      const objective =
        mode === "narrated_as_fact" || mode === "directly_observed";

      // ADR 0003 slice 1: unverified claims (statements/beliefs/rumors/
      // dreams/uncertain) are stored for later use but NEVER close canon —
      // a lying character must not rewrite the world.
      if (!objective) {
        insertFact.run(
          bookId,
          f.entityType,
          entityId,
          name,
          f.predicate,
          f.objectText,
          chapterOrder,
          sourceVersionId,
          f.confidence,
          mode,
          now,
        );
        continue;
      }

      // Explicit supersede: the model named EXACTLY which active facts this
      // statement replaces (fact_<id> rendered into its prompt). Validated
      // per id: same book, still open. Unknown/foreign/closed ids are logged
      // and skipped, never guessed.
      const explicitIds = (f.supersedesFactIds ?? [])
        .map((ref) => Number(ref.slice("fact_".length)))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (explicitIds.length > 0) {
        const info = insertFact.run(
          bookId,
          f.entityType,
          entityId,
          name,
          f.predicate,
          f.objectText,
          chapterOrder,
          sourceVersionId,
          f.confidence,
          mode,
          now,
        );
        const newId = Number(info.lastInsertRowid);
        for (const id of new Set(explicitIds)) {
          const res = sqlite
            .prepare(
              `UPDATE book_facts
               SET valid_to_chapter = ?, superseded_by = ?
               WHERE id = ? AND book_id = ? AND valid_to_chapter IS NULL`,
            )
            .run(chapterOrder - 1, newId, id, bookId);
          if (res.changes === 0) {
            console.warn(
              `[canon-facts] supersedesFactId fact_${id} skipped (missing, other book, or already closed)`,
            );
          }
        }
        continue;
      }

      // Fallback (no explicit ids): same-(entity,predicate) supersession —
      // correct for single-valued predicates, which is why the extractor is
      // told to pass explicit ids for multi-valued ones. Only facts from
      // EARLIER chapters close — batch siblings of this chapter coexist.
      // Match prior by entity_id when the entity resolved (robust to name
      // drift, incl. legacy id-less rows with the same name); else by name.
      const prior = (
        entityId !== null
          ? sqlite
              .prepare(
                `SELECT id, object_text FROM book_facts
                 WHERE book_id = ? AND entity_type = ? AND predicate = ?
                   AND valid_to_chapter IS NULL AND valid_from_chapter < ?
                   AND assertion_mode IN ('narrated_as_fact','directly_observed')
                   AND (entity_id = ? OR (entity_id IS NULL AND lower(entity_name) = ?))
                 ORDER BY valid_from_chapter DESC LIMIT 1`,
              )
              .get(
                bookId,
                f.entityType,
                f.predicate,
                chapterOrder,
                entityId,
                normalizeEntityName(name),
              )
          : sqlite
              .prepare(
                `SELECT id, object_text FROM book_facts
                 WHERE book_id = ? AND entity_type = ? AND entity_name = ?
                   AND predicate = ? AND valid_to_chapter IS NULL
                   AND valid_from_chapter < ?
                   AND assertion_mode IN ('narrated_as_fact','directly_observed')
                 ORDER BY valid_from_chapter DESC LIMIT 1`,
              )
              .get(bookId, f.entityType, name, f.predicate, chapterOrder)
      ) as { id: number; object_text: string } | undefined;

      // Unchanged value → keep the open prior row, skip insert (idempotent).
      if (prior && prior.object_text === f.objectText) continue;

      const info = insertFact.run(
        bookId,
        f.entityType,
        entityId,
        name,
        f.predicate,
        f.objectText,
        chapterOrder,
        sourceVersionId,
        f.confidence,
        mode,
        now,
      );
      const newId = Number(info.lastInsertRowid);

      if (prior) {
        // Close the prior version the chapter before this one and link it.
        sqlite
          .prepare(
            `UPDATE book_facts
             SET valid_to_chapter = ?, superseded_by = ?
             WHERE id = ?`,
          )
          .run(chapterOrder - 1, newId, prior.id);
      }
    }
  });
  tx();
}

export interface FactsExtractionResult {
  factCount: number;
  /** Row missing / too short — nothing to do, treated as success. */
  skipped?: "missing" | "short";
  /** shouldPersist() said the version is no longer current — nothing was
   *  written to the active tables (ADR 0002, I3). */
  stale?: boolean;
}

export interface FactsPayload {
  facts: ExtractedFact[];
  /** Личные события героев из того же вызова (раздел 12, решение 6). */
  characterEvents: ExtractedCharacterEvent[];
  bookId: number;
  chapterId: number;
  chapterOrder: number;
  skipped?: "missing" | "short";
  /** Сколько строк ответа схема не приняла и выбросила. Раньше такая строка
   *  валила весь ответ, и это было видно хотя бы как ошибка задания; теперь
   *  остальное выживает, поэтому число надо нести дальше — молчаливая потеря
   *  хуже громкой. */
  malformedFacts: number;
  malformedEvents: number;
}

/** Схема отдаёт непринятый элемент как `null` (см. `canonFactExtractionSchema`).
 *  Здесь он отсеивается и считается — это единственная точка, где видно,
 *  сколько модель прислала мусора. */
function dropMalformed<T>(items: ReadonlyArray<T | null>): {
  kept: T[];
  dropped: number;
} {
  const kept = items.filter((x): x is T => x !== null);
  return { kept, dropped: items.length - kept.length };
}

/**
 * Throwing payload core: run the LLM extraction WITHOUT touching active
 * tables (ADR 0002, I4 — the worker stages this payload in result_json and
 * the atomic activation step materializes it via `persistExtractedFacts`).
 */
export async function extractFactsPayload(
  sqlite: DatabaseType,
  versionId: number,
): Promise<FactsPayload> {
  const v = sqlite
    .prepare(
      `SELECT id, chapter_id, content_text, word_count
       FROM chapter_versions WHERE id = ?`,
    )
    .get(versionId) as
    | {
        id: number;
        chapter_id: number;
        content_text: string;
        word_count: number;
      }
    | undefined;
  const missing: FactsPayload = {
    facts: [],
    characterEvents: [],
    bookId: 0,
    chapterId: 0,
    chapterOrder: 0,
    skipped: "missing",
    malformedFacts: 0,
    malformedEvents: 0,
  };
  if (!v) return missing;

  const ch = sqlite
    .prepare(
      "SELECT id, book_id, title, order_index FROM chapters WHERE id = ?",
    )
    .get(v.chapter_id) as
    | { id: number; book_id: number; title: string; order_index: number }
    | undefined;
  if (!ch) return missing;
  const base = {
    bookId: ch.book_id,
    chapterId: ch.id,
    chapterOrder: ch.order_index,
  };
  if (v.word_count < 80) {
    return {
      ...base,
      facts: [],
      characterEvents: [],
      skipped: "short",
      malformedFacts: 0,
      malformedEvents: 0,
    };
  }

  const bk = sqlite
    .prepare("SELECT title, critic_model FROM books WHERE id = ?")
    .get(ch.book_id) as
    | { title: string; critic_model: "sonnet" | "opus" }
    | undefined;
  if (!bk) return missing;

  const names = (table: string): string[] =>
    (
      sqlite
        .prepare(
          table === "characters"
            ? `SELECT canonical_name AS n FROM characters WHERE book_id = ?`
            : `SELECT name AS n FROM ${table} WHERE book_id = ?`,
        )
        .all(ch.book_id) as Array<{ n: string }>
    ).map((r) => r.n);

  const activeFacts = renderActiveFactsPrompt(
    sqlite,
    ch.book_id,
    Math.max(0, ch.order_index - 1),
    { withIds: true },
  );

  const result = await extractCanonFacts({
    bookTitle: bk.title,
    chapterTitle: ch.title,
    chapterOrder: ch.order_index,
    chapterText: v.content_text,
    knownEntities: {
      characters: names("characters"),
      locations: names("locations"),
      items: names("items"),
    },
    activeFacts,
    model: bk.critic_model ?? "sonnet",
    onUsage: (u) =>
      logUsage(sqlite, {
        route: "canon.facts",
        model: u.modelId,
        usage: {
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheCreationInputTokens: u.cacheCreationInputTokens,
          cacheReadInputTokens: u.cacheReadInputTokens,
        },
        bookId: ch.book_id,
        chapterId: ch.id,
        versionId,
      }),
  });

  const facts = dropMalformed(result.facts);
  const events = dropMalformed(result.characterEvents ?? []);
  if (facts.dropped > 0 || events.dropped > 0) {
    console.warn(
      `[canon-facts] v${versionId}: схема не приняла ${facts.dropped} факт(ов) и ${events.dropped} событие(й) — остальное сохранено`,
    );
  }
  return {
    ...base,
    facts: facts.kept,
    characterEvents: events.kept,
    malformedFacts: facts.dropped,
    malformedEvents: events.dropped,
  };
}

/**
 * Throwing core: payload extraction + direct persist (legacy path used by
 * the fire-and-forget wrapper and its tests). The worker stages the payload
 * instead and materializes it at activation. `opts.shouldPersist` is checked
 * after the LLM call, right before touching active tables.
 */
export async function extractFactsForVersion(
  sqlite: DatabaseType,
  versionId: number,
  opts?: { shouldPersist?: () => boolean },
): Promise<FactsExtractionResult> {
  const p = await extractFactsPayload(sqlite, versionId);
  if (p.skipped) return { factCount: 0, skipped: p.skipped };
  if (opts?.shouldPersist && !opts.shouldPersist()) {
    return { factCount: p.facts.length, stale: true };
  }
  if (p.facts.length > 0) {
    persistExtractedFacts(
      sqlite,
      p.bookId,
      p.chapterOrder,
      versionId,
      p.facts,
    );
  }
  return { factCount: p.facts.length };
}

/**
 * Fire-and-forget wrapper around `extractFactsForVersion` — never throws into
 * the caller's save flow. Legacy path; the durable memory worker calls the
 * core directly (ADR 0002).
 */
export async function triggerCanonFactExtraction(
  sqlite: DatabaseType,
  versionId: number,
): Promise<void> {
  try {
    await extractFactsForVersion(sqlite, versionId);
  } catch (e) {
    console.warn(
      "[canon-facts] extraction failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
