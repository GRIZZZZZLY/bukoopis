import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createStyleProfileInputSchema,
  updateStyleProfileInputSchema,
  uploadReferenceCorpusInputSchema,
  runExtractInputSchema,
  createStyleBlendInputSchema,
  styleFingerprintSchema,
  fatigueWordsSchema,
  blendConfigSchema,
  type StyleProfile,
  type StyleProfileKind,
  type BlendConfig,
  type ReferenceCorpus,
  type ReferenceFormat,
} from "@book-forge/shared";
import {
  parseReference,
  detectFormat,
  detectFatigueWords,
  runStyleExtractor,
  runStyleBlender,
  type BlendParent,
} from "@book-forge/style-engine";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { logUsage } from "../utils/usageLogger.js";
import { insertReferenceCorpus } from "../utils/style-corpus.js";
import type { BookRow, ChapterRow } from "../db/rows.js";

interface StyleProfileRow {
  id: number;
  name: string;
  language: string;
  description: string | null;
  kind: string;
  blend_config_json: string | null;
  fingerprint_json: string | null;
  fatigue_words_json: string | null;
  last_extracted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CorpusRow {
  id: number;
  profile_id: number;
  filename: string;
  format: string;
  language: string;
  raw_text: string;
  char_count: number;
  scene_count: number;
  created_at: string;
}

function toProfile(
  sqlite: DatabaseType,
  r: StyleProfileRow,
): StyleProfile {
  const stats = sqlite
    .prepare(
      "SELECT COUNT(*) as count, COALESCE(SUM(char_count),0) as total FROM reference_corpora WHERE profile_id = ?",
    )
    .get(r.id) as { count: number; total: number };

  let fingerprint = null;
  if (r.fingerprint_json) {
    try {
      fingerprint = styleFingerprintSchema.parse(JSON.parse(r.fingerprint_json));
    } catch {
      fingerprint = null;
    }
  }
  let fatigueWords = null;
  if (r.fatigue_words_json) {
    try {
      fatigueWords = fatigueWordsSchema.parse(JSON.parse(r.fatigue_words_json));
    } catch {
      fatigueWords = null;
    }
  }
  let blendConfig: BlendConfig | null = null;
  if (r.blend_config_json) {
    try {
      blendConfig = blendConfigSchema.parse(JSON.parse(r.blend_config_json));
    } catch {
      blendConfig = null;
    }
  }
  return {
    id: r.id,
    name: r.name,
    language: r.language,
    description: r.description,
    kind: (r.kind === "blend" ? "blend" : "extracted") as StyleProfileKind,
    blendConfig,
    fingerprint,
    fatigueWords,
    corporaCount: stats.count,
    totalChars: stats.total,
    lastExtractedAt: r.last_extracted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toCorpus(r: CorpusRow): ReferenceCorpus {
  return {
    id: r.id,
    profileId: r.profile_id,
    filename: r.filename,
    format: r.format as ReferenceFormat,
    language: r.language,
    charCount: r.char_count,
    sceneCount: r.scene_count,
    createdAt: r.created_at,
  };
}

/**
 * How much corpus the extractor model actually reads. Small on purpose: the
 * numbers it used to be asked for are now measured from the full corpus, so the
 * sample only has to be representative of the voice, not exhaustive. 12 x 1500
 * chars is roughly 5k tokens against ~30k for the 30 x 4000 it used to get.
 */
const DEFAULT_SAMPLE_SIZE = 12;
const SAMPLE_SCENE_CHARS = 1500;

export function createStyleRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();

  // ─────────── Profile CRUD ───────────

  r.get("/style-profiles", (c) => {
    const rows = sqlite
      .prepare("SELECT * FROM style_profiles ORDER BY created_at DESC")
      .all() as StyleProfileRow[];
    return c.json(rows.map((row) => toProfile(sqlite, row)));
  });

  r.post("/style-profiles", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createStyleProfileInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO style_profiles (name, language, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.name,
        parsed.data.language ?? "ru",
        parsed.data.description ?? null,
        now,
        now,
      );
    const row = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(info.lastInsertRowid) as StyleProfileRow;
    return c.json(toProfile(sqlite, row), 201);
  });

  r.get("/style-profiles/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow | undefined;
    if (!row) return notFound(c, "style_profile");
    return c.json(toProfile(sqlite, row));
  });

  r.patch("/style-profiles/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateStyleProfileInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow | undefined;
    if (!existing) return notFound(c, "style_profile");
    const next = {
      name: parsed.data.name ?? existing.name,
      description:
        parsed.data.description === undefined
          ? existing.description
          : parsed.data.description,
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE style_profiles SET name = ?, description = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.name, next.description, now, id);
    const row = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow;
    return c.json(toProfile(sqlite, row));
  });

  r.delete("/style-profiles/:id", (c) => {
    const id = Number(c.req.param("id"));
    // В14 ревью 2026-09-19: `books.style_profile_id` объявлен без ON DELETE,
    // поэтому удаление привязанного профиля падало нарушением внешнего ключа
    // и уходило автору как 500 «internal_error». Книга просто остаётся без
    // стиля — это её нормальное состояние, а не отказ.
    const removed = sqlite.transaction(() => {
      sqlite
        .prepare("UPDATE books SET style_profile_id = NULL WHERE style_profile_id = ?")
        .run(id);
      return sqlite.prepare("DELETE FROM style_profiles WHERE id = ?").run(id).changes;
    })();
    if (removed === 0) return notFound(c, "style_profile");
    return c.body(null, 204);
  });

  // ─────────── Corpus management ───────────

  r.get("/style-profiles/:id/corpora", (c) => {
    const id = Number(c.req.param("id"));
    const profile = sqlite
      .prepare("SELECT id FROM style_profiles WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!profile) return notFound(c, "style_profile");
    const rows = sqlite
      .prepare(
        "SELECT id, profile_id, filename, format, language, '' as raw_text, char_count, scene_count, created_at FROM reference_corpora WHERE profile_id = ? ORDER BY created_at DESC",
      )
      .all(id) as CorpusRow[];
    return c.json(rows.map(toCorpus));
  });

  r.post("/style-profiles/:id/corpora", async (c) => {
    const id = Number(c.req.param("id"));
    const profile = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow | undefined;
    if (!profile) return notFound(c, "style_profile");
    const body = await c.req.json().catch(() => null);
    const parsed = uploadReferenceCorpusInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const fmt = detectFormat(parsed.data.filename);
    if (!fmt) return badRequest(c, "unsupported file format (allowed: txt/md/fb2/epub)");

    let raw: string | Buffer;
    if (parsed.data.encoding === "base64") {
      raw = Buffer.from(parsed.data.content, "base64");
    } else {
      raw = parsed.data.content;
    }
    let parsedRef;
    try {
      parsedRef = await parseReference(parsed.data.filename, raw);
    } catch (e) {
      return badRequest(
        c,
        `parser failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (parsedRef.text.length < 200) {
      return badRequest(c, "parsed text is too short (<200 chars)");
    }

    const corpusId = insertReferenceCorpus(
      sqlite,
      { id, language: profile.language },
      parsed.data.filename,
      parsedRef,
    );
    const row = sqlite
      .prepare(
        "SELECT id, profile_id, filename, format, language, '' as raw_text, char_count, scene_count, created_at FROM reference_corpora WHERE id = ?",
      )
      .get(corpusId) as CorpusRow;
    return c.json(toCorpus(row), 201);
  });

  r.delete("/style-profiles/:profileId/corpora/:corpusId", (c) => {
    const corpusId = Number(c.req.param("corpusId"));
    const profileId = Number(c.req.param("profileId"));
    const existing = sqlite
      .prepare(
        "SELECT id FROM reference_corpora WHERE id = ? AND profile_id = ?",
      )
      .get(corpusId, profileId) as { id: number } | undefined;
    if (!existing) return notFound(c, "reference_corpus");
    sqlite.prepare("DELETE FROM reference_corpora WHERE id = ?").run(corpusId);
    sqlite
      .prepare("UPDATE style_profiles SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), profileId);
    return c.body(null, 204);
  });

  // ─────────── Style Extractor ───────────

  r.post("/style-profiles/:id/extract", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = runExtractInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const profile = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow | undefined;
    if (!profile) return notFound(c, "style_profile");

    // Two different populations, deliberately.
    //
    // Statistics are measured over the WHOLE corpus — that costs nothing and is
    // strictly more accurate than any sample. The model sees only a small
    // sample, because all it has to do is characterise the voice; feeding it
    // the whole corpus buys no accuracy now that the numbers come from code.
    //
    // Sample order is a hash of the scene id rather than random(), so
    // re-extracting an unchanged corpus reproduces the same fingerprint.
    const sampleSize = parsed.data.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    const pickScenes = sqlite.prepare(
      `SELECT s.text FROM reference_scenes s
       JOIN reference_corpora c ON c.id = s.corpus_id
       WHERE c.profile_id = ?
       ORDER BY ((s.id * 2654435761) % 4294967291), s.id
       LIMIT ?`,
    );
    const scenes = pickScenes.all(id, sampleSize) as Array<{ text: string }>;
    const metricsScenes = (
      sqlite
        .prepare(
          `SELECT s.text FROM reference_scenes s
           JOIN reference_corpora c ON c.id = s.corpus_id
           WHERE c.profile_id = ?`,
        )
        .all(id) as Array<{ text: string }>
    ).map((s) => s.text);
    if (scenes.length < 5) {
      return badRequest(
        c,
        `insufficient corpus: need at least 5 scenes, have ${scenes.length}`,
      );
    }

    const sceneTexts = scenes.map((s) => s.text);

    // Fatigue is deterministic, so it also runs over the whole corpus.
    const fatigue = detectFatigueWords(metricsScenes, profile.language);

    let fingerprint;
    try {
      fingerprint = await runStyleExtractor({
        language: profile.language,
        authorName: profile.name,
        scenes: sceneTexts.map((t) => t.slice(0, SAMPLE_SCENE_CHARS)),
        metricsScenes,
        model: parsed.data.model,
        onUsage: (usage) =>
          logUsage(sqlite, {
            route: "style.extract",
            model: usage.modelId,
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
            },
          }),
      });
    } catch (e) {
      return c.json(
        {
          error: "extractor_failed",
          details: { message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE style_profiles
         SET fingerprint_json = ?, fatigue_words_json = ?,
             last_extracted_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(fingerprint),
        JSON.stringify(fatigue),
        now,
        now,
        id,
      );
    const row = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(id) as StyleProfileRow;
    return c.json(toProfile(sqlite, row));
  });

  // ─────────── Style Blender ───────────

  // Creates a NEW profile whose fingerprint is synthesized from several
  // extracted ones. The result is an ordinary profile: a book points at it the
  // same way it points at an extracted style, and writer/critics never learn
  // that a blend happened.
  r.post("/style-profiles/blend", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createStyleBlendInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const sourceIds = parsed.data.sources.map((s) => s.profileId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      return badRequest(c, "duplicate source profile in blend");
    }

    const parents: BlendParent[] = [];
    for (const source of parsed.data.sources) {
      const row = sqlite
        .prepare("SELECT * FROM style_profiles WHERE id = ?")
        .get(source.profileId) as StyleProfileRow | undefined;
      if (!row) return notFound(c, `style_profile:${source.profileId}`);
      if (!row.fingerprint_json) {
        return badRequest(
          c,
          `source profile ${source.profileId} ("${row.name}") has no fingerprint — run extract first`,
        );
      }
      let fingerprint;
      try {
        fingerprint = styleFingerprintSchema.parse(
          JSON.parse(row.fingerprint_json),
        );
      } catch {
        return badRequest(
          c,
          `source profile ${source.profileId} ("${row.name}") has a corrupt fingerprint`,
        );
      }
      parents.push({
        name: row.name,
        weight: source.weight,
        emphasis: source.emphasis ?? null,
        fingerprint,
      });
    }

    // Language is taken from the heaviest source; blending across languages is
    // not something the writer could act on anyway.
    const language =
      [...parsed.data.sources]
        .map((s, i) => ({ weight: s.weight, lang: parents[i]!.fingerprint.language }))
        .sort((a, b) => b.weight - a.weight)[0]?.lang ?? "ru";

    let fingerprint;
    try {
      fingerprint = await runStyleBlender({
        language,
        blendName: parsed.data.name,
        parents,
        instructions: parsed.data.instructions ?? null,
        ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
        onUsage: (usage) =>
          logUsage(sqlite, {
            route: "style.blend",
            model: usage.modelId,
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
            },
          }),
      });
    } catch (e) {
      return c.json(
        {
          error: "blender_failed",
          details: { message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }

    // Fatigue lists are unioned, not blended: a word that tires the reader in
    // one source still tires them in the mix.
    const fatigue = mergeParentFatigue(sqlite, sourceIds);

    const blendConfig: BlendConfig = {
      sources: parsed.data.sources,
      instructions: parsed.data.instructions ?? null,
    };
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO style_profiles
         (name, language, description, kind, blend_config_json,
          fingerprint_json, fatigue_words_json, last_extracted_at,
          created_at, updated_at)
         VALUES (?, ?, ?, 'blend', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.data.name,
        language,
        parsed.data.description ?? null,
        JSON.stringify(blendConfig),
        JSON.stringify(fingerprint),
        JSON.stringify(fatigue),
        now,
        now,
        now,
      );
    const row = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(info.lastInsertRowid) as StyleProfileRow;
    return c.json(toProfile(sqlite, row), 201);
  });

  // ─────────── Свежесть паспорта стиля (заимствование из litrab.ai) ───────────

  const STALE_AFTER_CHAPTERS = 3;

  r.get("/books/:id/style-freshness", (c) => {
    const bookId = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(bookId) as BookRow | undefined;
    if (!book) return notFound(c, "book");
    const empty = {
      profileId: null,
      profileName: null,
      kind: null,
      lastExtractedAt: null,
      versionsSince: 0,
      chaptersSince: 0,
      stale: false,
    };
    if (book.style_profile_id === null) return c.json(empty);
    const profile = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(book.style_profile_id) as StyleProfileRow | undefined;
    if (!profile) return c.json(empty);
    // Отсчёт — от последнего извлечения; пока его не было, сравнивать нечем.
    const since = profile.last_extracted_at ?? "0000-00-00T00:00:00.000Z";
    const counts = sqlite
      .prepare(
        `SELECT COUNT(*) AS versions, COUNT(DISTINCT v.chapter_id) AS chapters
         FROM chapter_versions v JOIN chapters ch ON ch.id = v.chapter_id
         WHERE ch.book_id = ? AND v.created_at > ?`,
      )
      .get(bookId, since) as { versions: number; chapters: number };
    return c.json({
      profileId: profile.id,
      profileName: profile.name,
      kind: profile.kind,
      lastExtractedAt: profile.last_extracted_at,
      versionsSince: counts.versions,
      chaptersSince: counts.chapters,
      stale:
        profile.kind === "extracted" &&
        profile.last_extracted_at !== null &&
        counts.chapters >= STALE_AFTER_CHAPTERS,
    });
  });

  // Добор последних глав в корпус. Старые корпуса остаются: статистика
  // меряется по всему корпусу, а что убрать — решает автор на странице
  // профиля. Само извлечение — прежним POST /style-profiles/:id/extract,
  // его зовёт клиент вторым шагом; второго обработчика извлечения не заводим.
  r.post("/books/:id/style/refresh-from-chapters", async (c) => {
    const bookId = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(bookId) as BookRow | undefined;
    if (!book) return notFound(c, "book");
    if (book.style_profile_id === null) return badRequest(c, "у книги нет паспорта стиля");
    const profile = sqlite
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(book.style_profile_id) as StyleProfileRow | undefined;
    if (!profile) return notFound(c, "style_profile");
    if (profile.kind !== "extracted") {
      return badRequest(c, "у смешанного профиля нет своего корпуса — пересобирайте родителей");
    }
    const rows = sqlite
      .prepare(
        `SELECT ch.id, ch.title, v.content_text
         FROM chapters ch JOIN chapter_versions v ON v.id = ch.current_version_id
         WHERE ch.book_id = ?
         ORDER BY ch.order_index DESC, ch.id DESC
         LIMIT 3`,
      )
      .all(bookId) as Array<Pick<ChapterRow, "id" | "title"> & { content_text: string }>;
    if (rows.length === 0) return badRequest(c, "у книги нет принятых глав");
    const ordered = [...rows].reverse();
    const text = ordered.map((r2) => r2.content_text).join("\n\n");
    const filename = `${book.title}-главы-${new Date().toISOString().slice(0, 10)}.txt`;
    let parsedRef;
    try {
      parsedRef = await parseReference(filename, text);
    } catch (e) {
      return badRequest(c, `parser failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (parsedRef.text.length < 200) return badRequest(c, "parsed text is too short (<200 chars)");
    const corpusId = insertReferenceCorpus(
      sqlite,
      { id: profile.id, language: profile.language },
      filename,
      parsedRef,
    );
    return c.json({ corpusId, chapters: ordered.map((r2) => ({ id: r2.id, title: r2.title })) });
  });

  return r;
}

/** Union of the parents' fatigue lists, de-duplicated, blacklist winning. */
function mergeParentFatigue(
  sqlite: DatabaseType,
  sourceIds: number[],
): { blacklist: string[]; softWarn: string[] } {
  const blacklist = new Set<string>();
  const softWarn = new Set<string>();
  for (const sid of sourceIds) {
    const row = sqlite
      .prepare("SELECT fatigue_words_json FROM style_profiles WHERE id = ?")
      .get(sid) as { fatigue_words_json: string | null } | undefined;
    if (!row?.fatigue_words_json) continue;
    try {
      const fw = fatigueWordsSchema.parse(JSON.parse(row.fatigue_words_json));
      for (const w of fw.blacklist) blacklist.add(w);
      for (const w of fw.softWarn) softWarn.add(w);
    } catch {
      /* corrupt list — skip this parent */
    }
  }
  for (const w of blacklist) softWarn.delete(w);
  return { blacklist: [...blacklist], softWarn: [...softWarn] };
}
