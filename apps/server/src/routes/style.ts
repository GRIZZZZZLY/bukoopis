import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createStyleProfileInputSchema,
  updateStyleProfileInputSchema,
  uploadReferenceCorpusInputSchema,
  runExtractInputSchema,
  styleFingerprintSchema,
  fatigueWordsSchema,
  type StyleProfile,
  type ReferenceCorpus,
  type ReferenceFormat,
} from "@book-forge/shared";
import {
  parseReference,
  detectFormat,
  detectFatigueWords,
  runStyleExtractor,
} from "@book-forge/style-engine";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { logUsage } from "../utils/usageLogger.js";

interface StyleProfileRow {
  id: number;
  name: string;
  language: string;
  description: string | null;
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
  return {
    id: r.id,
    name: r.name,
    language: r.language,
    description: r.description,
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
    const info = sqlite
      .prepare("DELETE FROM style_profiles WHERE id = ?")
      .run(id);
    if (info.changes === 0) return notFound(c, "style_profile");
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

    const now = new Date().toISOString();
    const tx = sqlite.transaction(() => {
      const info = sqlite
        .prepare(
          `INSERT INTO reference_corpora
           (profile_id, filename, format, language, raw_text, char_count, scene_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.data.filename,
          parsedRef.format,
          profile.language,
          parsedRef.text,
          parsedRef.text.length,
          parsedRef.scenes.length,
          now,
        );
      const corpusId = Number(info.lastInsertRowid);
      const insertScene = sqlite.prepare(
        `INSERT INTO reference_scenes (corpus_id, order_index, text, char_count, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < parsedRef.scenes.length; i++) {
        insertScene.run(corpusId, i, parsedRef.scenes[i]!, parsedRef.scenes[i]!.length, now);
      }
      sqlite
        .prepare("UPDATE style_profiles SET updated_at = ? WHERE id = ?")
        .run(now, id);
      return corpusId;
    });
    const corpusId = tx();
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

    // Sample scenes across all corpora — random selection.
    const sampleSize = parsed.data.sampleSize ?? 30;
    const scenes = sqlite
      .prepare(
        `SELECT s.text FROM reference_scenes s
         JOIN reference_corpora c ON c.id = s.corpus_id
         WHERE c.profile_id = ?
         ORDER BY random() LIMIT ?`,
      )
      .all(id, sampleSize) as Array<{ text: string }>;
    if (scenes.length < 5) {
      return badRequest(
        c,
        `insufficient corpus: need at least 5 scenes, have ${scenes.length}`,
      );
    }

    const sceneTexts = scenes.map((s) => s.text);

    // Always compute fatigue (deterministic, no LLM)
    const fatigue = detectFatigueWords(sceneTexts, profile.language);

    let fingerprint;
    try {
      fingerprint = await runStyleExtractor({
        language: profile.language,
        authorName: profile.name,
        scenes: sceneTexts.map((t) => t.slice(0, 4000)),
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

  return r;
}
