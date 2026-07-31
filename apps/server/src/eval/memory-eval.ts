import type { Database as DatabaseType } from "better-sqlite3";
import type { ExtractedFact } from "@book-forge/shared";
import {
  persistExtractedFacts,
  loadActiveFacts,
  renderActiveFactsPrompt,
} from "../utils/book-facts.js";
import {
  materializeEpisodicNotes,
  loadOpenNotes,
} from "../utils/book-notes.js";
import { addEntityAlias } from "../utils/entity-resolve.js";
import { indexChapterVersion } from "@book-forge/retrieval";
import { gatherRetrievedChunks } from "../utils/chapter-retrieval.js";

/**
 * ADR 0003 slice 5 — literary evaluation harness.
 *
 * A tiny labeled "novel" packed with the cases that break naive memory:
 * multi-valued possession, a lie about a death, a dream, a resolved thread,
 * Russian case forms, a rewritten chapter. The extraction step is SCRIPTED
 * (no LLM) so the harness measures the deterministic server-side machinery —
 * supersession, assertion-mode canon gating, entity resolution, note
 * resolution, and retrieval's temporal/version/dedup filters — GIVEN correct
 * extraction. It is the regression gate before tuning embeddings/RRF/reranker.
 *
 * Runs in CI with the deterministic stub embedding provider (retrieval checks
 * lean on FTS, which is deterministic); the eval:memory script can run it with
 * the real ONNX provider for genuine semantic-recall numbers.
 */

export interface EvalCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface RecallReport {
  probes: number;
  recallAt1: number;
  recallAt3: number;
  mrr: number;
  detail: Array<{ query: string; expected: number; rank: number | null }>;
}
export interface EvalReport {
  checks: EvalCheck[];
  passed: number;
  total: number;
  /** Informational retrieval-ranking numbers (not a pass/fail gate). */
  recall?: RecallReport;
}

const NOW = "2026-07-12T00:00:00.000Z";

function fact(
  entityName: string,
  predicate: string,
  objectText: string,
  opts?: Partial<Pick<ExtractedFact, "entityType" | "assertionMode" | "supersedesFactIds">>,
): ExtractedFact {
  return {
    entityType: opts?.entityType ?? "character",
    entityName,
    predicate,
    objectText,
    confidence: 1,
    assertionMode: opts?.assertionMode ?? "narrated_as_fact",
    supersedesFactIds: opts?.supersedesFactIds ?? [],
  };
}

export async function runMemoryEval(
  sqlite: DatabaseType,
  hasVec: boolean,
): Promise<EvalReport> {
  const checks: EvalCheck[] = [];
  const check = (name: string, pass: boolean, detail = ""): void => {
    checks.push({ name, pass, detail });
  };

  // ── Seed book + canon entities ──
  const bookId = Number(
    sqlite
      .prepare(
        "INSERT INTO books (title, created_at, updated_at) VALUES ('Мини-роман', ?, ?)",
      )
      .run(NOW, NOW).lastInsertRowid,
  );
  const ivanId = Number(
    sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, 'Иван', '{}', ?, ?)`,
      )
      .run(bookId, NOW, NOW).lastInsertRowid,
  );
  sqlite
    .prepare(
      `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
       VALUES (?, 'Мария', '{}', ?, ?)`,
    )
    .run(bookId, NOW, NOW);
  // "Ивана" is a genitive form the extractor might emit; register as alias.
  addEntityAlias(sqlite, bookId, "character", ivanId, "Ивана");

  const activeAt = (order: number, objectiveOnly = true): ReturnType<typeof loadActiveFacts> =>
    loadActiveFacts(sqlite, bookId, order, { objectiveOnly });
  const findFact = (order: number, predicate: string, obj: string): boolean =>
    activeAt(order).some((f) => f.predicate === predicate && f.objectText === obj);

  // ── Ch1: Иван owns two items (multi-valued predicate, explicit later) ──
  persistExtractedFacts(sqlite, bookId, 1, 101, [
    fact("Иван", "владеет", "кольцо Эйра"),
    fact("Иван", "владеет", "меч Заката"),
  ]);
  // ── Ch2: Мария is alive (objective canon) ──
  persistExtractedFacts(sqlite, bookId, 2, 102, [
    fact("Мария", "состояние", "жива"),
  ]);

  // ── Ch3: Иван loses ONLY the ring — explicit supersede by id ──
  const ring = activeAt(3).find((f) => f.objectText === "кольцо Эйра");
  if (ring) {
    persistExtractedFacts(sqlite, bookId, 3, 103, [
      fact("Иван", "владеет", "потерял кольцо Эйра", {
        supersedesFactIds: [`fact_${ring.id}`],
      }),
    ]);
  }
  check(
    "multivalued-supersede: ring lost, sword kept",
    !!ring &&
      !findFact(4, "владеет", "кольцо Эйра") &&
      findFact(4, "владеет", "меч Заката") &&
      findFact(4, "владеет", "потерял кольцо Эйра"),
    "at ch4: ring superseded, sword untouched, loss recorded",
  );

  // ── Ch4: Иван LIES that Мария died (character statement, not canon) ──
  persistExtractedFacts(sqlite, bookId, 4, 104, [
    fact("Мария", "состояние", "умерла", {
      assertionMode: "stated_by_character",
    }),
  ]);
  const objAt6 = activeAt(6);
  const allAt6 = activeAt(6, false);
  check(
    "statement-not-canon: lie about death excluded from objective canon",
    objAt6.some((f) => f.entityName === "Мария" && f.objectText === "жива") &&
      !objAt6.some((f) => f.objectText === "умерла") &&
      allAt6.some((f) => f.objectText === "умерла"),
    "Мария still 'жива' in canon; 'умерла' stored but non-canon",
  );

  // ── Ch5: a dream — never canon ──
  persistExtractedFacts(sqlite, bookId, 5, 105, [
    fact("Иван", "видел", "город из золота", {
      assertionMode: "dream_or_vision",
    }),
  ]);
  check(
    "dream-not-canon: vision excluded from objective canon",
    !activeAt(6).some((f) => f.objectText === "город из золота"),
    "dream fact absent from objective canon at ch6",
  );

  // ── Entity resolution: fact emitted in genitive form → canonical + id ──
  persistExtractedFacts(sqlite, bookId, 5, 105, [
    fact("Ивана", "находится", "башня на севере"),
  ]);
  const genRow = sqlite
    .prepare(
      `SELECT entity_id, entity_name FROM book_facts
       WHERE book_id = ? AND predicate = 'находится' ORDER BY id DESC LIMIT 1`,
    )
    .get(bookId) as { entity_id: number | null; entity_name: string };
  check(
    "entity-resolution: genitive form resolves to canonical id",
    genRow.entity_id === ivanId && genRow.entity_name === "Иван",
    `stored entity_id=${genRow.entity_id} name=${genRow.entity_name}`,
  );

  // ── Episodic note: opened at ch1, resolved by id at ch6 ──
  materializeEpisodicNotes(
    sqlite,
    bookId,
    1,
    101,
    {
      newNotes: [
        { kind: "thread", title: "Поиск башни", body: "Иван ищет башню.", tags: [] },
      ],
      resolvedNoteIds: [],
      notes: null,
    },
    [null],
  );
  const openNote = loadOpenNotes(sqlite, bookId, 3)[0];
  if (openNote) {
    materializeEpisodicNotes(
      sqlite,
      bookId,
      6,
      106,
      { newNotes: [], resolvedNoteIds: [`note_${openNote.id}`], notes: null },
      [],
    );
  }
  check(
    "note-resolution: thread opened at ch1, closed by id at ch6",
    !!openNote &&
      loadOpenNotes(sqlite, bookId, 5).length === 1 &&
      loadOpenNotes(sqlite, bookId, 7).length === 0,
    "open at ch5, closed at ch7",
  );

  // ── Canon prompt does not leak fact ids to Writer (id-free by default) ──
  const canonPrompt = renderActiveFactsPrompt(sqlite, bookId, 6) ?? "";
  check(
    "canon-prompt-id-free: Writer facts block has no fact_ ids",
    canonPrompt.length > 0 && !canonPrompt.includes("[fact_"),
    "renderActiveFactsPrompt() omits ids unless withIds",
  );

  // ── Retrieval: index chapters with distinctive prose ──
  const seedChapter = async (order: number, text: string): Promise<void> => {
    const chId = Number(
      sqlite
        .prepare(
          "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(bookId, order, `Глава ${order}`, NOW, NOW).lastInsertRowid,
    );
    const vId = Number(
      sqlite
        .prepare(
          `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
           VALUES (?, '{}', ?, ?, ?)`,
        )
        .run(chId, text, text.split(/\s+/).length, NOW).lastInsertRowid,
    );
    sqlite
      .prepare(
        "UPDATE chapters SET current_version_id = ?, memory_version_id = ? WHERE id = ?",
      )
      .run(vId, vId, chId);
    await indexChapterVersion(sqlite, hasVec, {
      bookId,
      chapterId: chId,
      chapterOrder: order,
      versionId: vId,
      language: "ru",
      text,
    });
  };
  await seedChapter(1, "Иван нашёл кольцо Эйра в старой пещере у ручья.");
  await seedChapter(2, "Мария плыла на корабле сквозь шторм к дальнему берегу.");
  await seedChapter(3, "Дракон сжёг деревянный мост через ущелье перед закатом.");

  const q = async (
    queryText: string,
    currentOrder: number,
    extra?: { excludeFromChapterOrder?: number },
  ) =>
    (
      await gatherRetrievedChunks(sqlite, {
        bookId,
        queryText,
        currentChapterOrder: currentOrder,
        hasVec,
        ...(extra ?? {}),
      })
    ).chunks;

  const dragonHits = await q("дракон мост ущелье", 5);
  check(
    "retrieval-finds: distinctive chapter surfaces for its query",
    dragonHits.some((c) => c.chapterOrder === 3),
    `chapters=${dragonHits.map((c) => c.chapterOrder).join(",")}`,
  );

  // No future leak: writing chapter 3 must not retrieve chapter 3+ content.
  const noFuture = await q("дракон мост ущелье", 3);
  check(
    "retrieval-no-future: current + later chapters excluded",
    noFuture.every((c) => (c.chapterOrder ?? 0) < 3),
    `chapters=${noFuture.map((c) => c.chapterOrder).join(",")}`,
  );

  // Dedup: chapters inside the rolling window are excluded from retrieval.
  const deduped = await q("Иван Мария дракон", 5, {
    excludeFromChapterOrder: 2, // window covers ch2,ch3,ch4
  });
  check(
    "retrieval-dedup: window chapters excluded from retrieval",
    deduped.every((c) => (c.chapterOrder ?? 0) < 2),
    `chapters=${deduped.map((c) => c.chapterOrder).join(",")}`,
  );

  // No old-version leak: a re-committed chapter hides the superseded version.
  const chId4 = Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, 4, 'Глава 4', ?, ?)",
      )
      .run(bookId, NOW, NOW).lastInsertRowid,
  );
  const v1 = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', 'Единорог первороза танцевал на поляне.', 5, ?)`,
      )
      .run(chId4, NOW).lastInsertRowid,
  );
  sqlite
    .prepare(
      "UPDATE chapters SET current_version_id = ?, memory_version_id = ? WHERE id = ?",
    )
    .run(v1, v1, chId4);
  await indexChapterVersion(sqlite, hasVec, {
    bookId,
    chapterId: chId4,
    chapterOrder: 4,
    versionId: v1,
    language: "ru",
    text: "Единорог первороза танцевал на поляне.",
  });
  const v2 = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', 'Единорог второроза дремал под дубом.', 5, ?)`,
      )
      .run(chId4, NOW).lastInsertRowid,
  );
  // New version becomes current AND the activated memory version.
  sqlite
    .prepare(
      "UPDATE chapters SET current_version_id = ?, memory_version_id = ? WHERE id = ?",
    )
    .run(v2, v2, chId4);
  await indexChapterVersion(sqlite, hasVec, {
    bookId,
    chapterId: chId4,
    chapterOrder: 4,
    versionId: v2,
    language: "ru",
    text: "Единорог второроза дремал под дубом.",
  });
  // Assert on chunk TEXT, not chapter order: with vec on + the deterministic
  // stub provider, similarity is lexical noise that can surface chapter 4's
  // NEW version for any query. What must hold is that the superseded version's
  // actual prose ("первороза") is gone while the new prose ("второроза") is
  // present — i.e. the memory_version_id filter hides the old version.
  const oldTerm = await q("первороза", 9);
  const newTerm = await q("второроза", 9);
  const oldProseLeaked = oldTerm.some((c) => c.text.includes("первороза"));
  const newProsePresent = newTerm.some((c) => c.text.includes("второроза"));
  check(
    "retrieval-no-old-version: superseded version's prose not retrievable",
    !oldProseLeaked && newProsePresent,
    `oldLeaked=${oldProseLeaked} newPresent=${newProsePresent}`,
  );

  // Informational retrieval ranking over the seeded corpus. Small n (the
  // mini-novel only has a few distinctive chapters) — a smoke number for the
  // provider, not a benchmark. Meaningful only with real embeddings; the stub
  // is lexical noise.
  const probes = [
    { query: "дракон сжёг деревянный мост через ущелье", expected: 3 },
    { query: "нашёл кольцо Эйра в старой пещере у ручья", expected: 1 },
    { query: "плыла на корабле сквозь шторм к дальнему берегу", expected: 2 },
  ];
  const recallDetail: RecallReport["detail"] = [];
  let r1 = 0;
  let r3 = 0;
  let mrrSum = 0;
  for (const p of probes) {
    const hits = await q(p.query, 9);
    const idx = hits.findIndex((c) => c.chapterOrder === p.expected);
    const rank = idx >= 0 ? idx + 1 : null;
    recallDetail.push({ query: p.query, expected: p.expected, rank });
    if (rank === 1) r1 += 1;
    if (rank !== null && rank <= 3) r3 += 1;
    if (rank !== null) mrrSum += 1 / rank;
  }
  const recall: RecallReport = {
    probes: probes.length,
    recallAt1: r1 / probes.length,
    recallAt3: r3 / probes.length,
    mrr: mrrSum / probes.length,
    detail: recallDetail,
  };

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, recall };
}
