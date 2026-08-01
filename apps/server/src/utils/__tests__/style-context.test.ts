import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadStyleContext } from "../style-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: DatabaseType;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "bookforge-style-ctx-"));
  sqlite = new Database(join(dbDir, "test.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

const FINGERPRINT = {
  language: "ru",
  voiceSummary: "Сухой голос с внезапными длиннотами.",
  sentenceLengths: {
    meanWords: 12,
    medianWords: 10,
    shortShare: 0.3,
    mediumShare: 0.5,
    longShare: 0.2,
  },
  density: {
    dialogue: 0.3,
    description: 0.3,
    action: 0.2,
    introspection: 0.2,
  },
  paragraphRhythm: "Короткие абзацы по 2-3 предложения.",
  sceneOpenings: "С реплики.",
  sceneClosings: "Оборванным действием.",
  tense: "past" as const,
  metaphorFamilies: ["природные стихии"],
  signatureSyntax: ["инверсия в начале"],
  signatureTropes: ["сцена открывается погодой"],
  thingsToImitate: ["чередовать длину предложений"],
  thingsToAvoid: ["симметричные пары"],
};

function makeProfile(
  name: string,
  opts: {
    kind?: "extracted" | "blend";
    blendConfig?: unknown;
    sceneCount?: number;
  } = {},
): number {
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO style_profiles
       (name, language, description, kind, blend_config_json, fingerprint_json,
        fatigue_words_json, last_extracted_at, created_at, updated_at)
       VALUES (?, 'ru', NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      opts.kind ?? "extracted",
      opts.blendConfig ? JSON.stringify(opts.blendConfig) : null,
      JSON.stringify({ ...FINGERPRINT, voiceSummary: `Голос ${name}` }),
      JSON.stringify({ blacklist: [`штамп-${name}`], softWarn: [] }),
      now,
      now,
      now,
    );
  const profileId = Number(info.lastInsertRowid);

  const sceneCount = opts.sceneCount ?? 0;
  if (sceneCount > 0) {
    const corpusInfo = sqlite
      .prepare(
        `INSERT INTO reference_corpora
         (profile_id, filename, format, language, raw_text, char_count, scene_count, created_at)
         VALUES (?, ?, 'txt', 'ru', '', 0, ?, ?)`,
      )
      .run(profileId, `${name}.txt`, sceneCount, now);
    const corpusId = Number(corpusInfo.lastInsertRowid);
    const insert = sqlite.prepare(
      `INSERT INTO reference_scenes (corpus_id, order_index, text, char_count, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < sceneCount; i++) {
      const text = `Сцена ${i} профиля ${name}. Здесь довольно много слов, чтобы фрагмент выглядел как проза.`;
      insert.run(corpusId, i, text, text.length, now);
    }
  }
  return profileId;
}

describe("loadStyleContext — few-shot stability", () => {
  it("picks the same samples on every call", () => {
    const id = makeProfile("Автор", { sceneCount: 20 });

    const first = loadStyleContext(sqlite, id, 3).prompt;
    const second = loadStyleContext(sqlite, id, 3).prompt;
    const third = loadStyleContext(sqlite, id, 3).prompt;

    // This block sits in the Writer's cached system prefix — any per-call
    // variation silently costs a full cache miss on every generation.
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toContain("Образец 1");
  });

  it("omits the samples block when few-shot is disabled", () => {
    const id = makeProfile("Автор", { sceneCount: 20 });
    const prompt = loadStyleContext(sqlite, id, 0).prompt;
    expect(prompt).toContain("Голос: Голос Автор");
    expect(prompt).not.toContain("Образец 1");
  });

  it("does not draw only from the very start of the corpus", () => {
    const id = makeProfile("Автор", { sceneCount: 20 });
    const prompt = loadStyleContext(sqlite, id, 3).prompt ?? "";
    const isAllOpeningScenes =
      prompt.includes("Сцена 0 ") &&
      prompt.includes("Сцена 1 ") &&
      prompt.includes("Сцена 2 ");
    expect(isAllOpeningScenes).toBe(false);
  });
});

describe("loadStyleContext — blend profiles", () => {
  it("draws samples from the parents, labelled by source", () => {
    const a = makeProfile("Первый", { sceneCount: 10 });
    const b = makeProfile("Второй", { sceneCount: 10 });
    const blend = makeProfile("Смесь", {
      kind: "blend",
      sceneCount: 0,
      blendConfig: {
        sources: [
          { profileId: a, weight: 0.5 },
          { profileId: b, weight: 0.5 },
        ],
        instructions: null,
      },
    });

    const prompt = loadStyleContext(sqlite, blend, 4).prompt ?? "";

    expect(prompt).toContain("источник «Первый»");
    expect(prompt).toContain("источник «Второй»");
    expect(prompt).toContain("Образцы исходных стилей");
    expect(prompt).toContain("не переключайся между ними");
  });

  it("splits samples in proportion to the blend weights", () => {
    const a = makeProfile("Основной", { sceneCount: 10 });
    const b = makeProfile("Акцент", { sceneCount: 10 });
    const blend = makeProfile("Смесь", {
      kind: "blend",
      blendConfig: {
        sources: [
          { profileId: a, weight: 0.75 },
          { profileId: b, weight: 0.25 },
        ],
      },
    });

    const prompt = loadStyleContext(sqlite, blend, 4).prompt ?? "";
    const fromA = prompt.match(/источник «Основной»/g)?.length ?? 0;
    const fromB = prompt.match(/источник «Акцент»/g)?.length ?? 0;

    expect(fromA).toBe(3);
    expect(fromB).toBe(1);
  });

  it("still renders the blend fingerprint after a parent is deleted", () => {
    const a = makeProfile("Первый", { sceneCount: 10 });
    const blend = makeProfile("Смесь", {
      kind: "blend",
      blendConfig: {
        sources: [
          { profileId: a, weight: 0.5 },
          { profileId: 9999, weight: 0.5 },
        ],
      },
    });
    sqlite.prepare("DELETE FROM style_profiles WHERE id = ?").run(a);

    const ctx = loadStyleContext(sqlite, blend, 4);

    expect(ctx.prompt).toContain("Голос: Голос Смесь");
    expect(ctx.prompt).not.toContain("Образец 1");
  });
});
