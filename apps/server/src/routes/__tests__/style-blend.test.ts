import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StyleFingerprint } from "@book-forge/shared";

vi.mock("@book-forge/style-engine", async (orig) => ({
  ...(await orig<typeof import("@book-forge/style-engine")>()),
  runStyleBlender: vi.fn(),
}));

import { join } from "node:path";
import Database from "better-sqlite3";
import { runStyleBlender } from "@book-forge/style-engine";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const blenderMock = vi.mocked(runStyleBlender);

interface ProfileJson {
  id: number;
  name: string;
  kind: string;
  blendConfig: {
    sources: Array<{ profileId: number; weight: number }>;
    instructions?: string | null;
  } | null;
  fingerprint: StyleFingerprint | null;
  fatigueWords: { blacklist: string[]; softWarn: string[] } | null;
}

const FINGERPRINT: StyleFingerprint = {
  language: "ru",
  voiceSummary: "Новый синтезированный голос.",
  sentenceLengths: {
    meanWords: 11,
    medianWords: 9,
    shortShare: 0.4,
    mediumShare: 0.4,
    longShare: 0.2,
  },
  density: {
    dialogue: 0.25,
    description: 0.35,
    action: 0.25,
    introspection: 0.15,
  },
  paragraphRhythm: "Плотные короткие абзацы.",
  sceneOpenings: "С детали.",
  sceneClosings: "С паузы.",
  tense: "past",
  metaphorFamilies: ["ремесло"],
  signatureSyntax: ["парцелляция"],
  signatureTropes: ["сцена держится на одном предмете"],
  thingsToImitate: ["обрывать абзац на действии"],
  thingsToAvoid: ["зеркальные конструкции"],
};

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  blenderMock.mockReset();
  blenderMock.mockResolvedValue(FINGERPRINT);
});
afterEach(() => t.cleanup());

/**
 * Creates a profile and back-fills a fingerprint + fatigue list directly, so
 * the blend tests don't need a live extractor call.
 */
async function makeExtractedProfile(
  name: string,
  fatigue: string[],
): Promise<number> {
  const p = await sendJson<ProfileJson>(t.app, "/api/style-profiles", "POST", {
    name,
    language: "ru",
  });
  const db = new Database(join(t.dbDir, "test.sqlite"));
  try {
    db.prepare(
      `UPDATE style_profiles
       SET fingerprint_json = ?, fatigue_words_json = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify({ ...FINGERPRINT, voiceSummary: `Голос ${name}` }),
      JSON.stringify({ blacklist: fatigue, softWarn: [`мягкое-${name}`] }),
      p.id,
    );
  } finally {
    db.close();
  }
  return p.id;
}

describe("POST /style-profiles/blend", () => {
  it("creates a blend profile from two extracted parents", async () => {
    const a = await makeExtractedProfile("Первый", ["штамп-а"]);
    const b = await makeExtractedProfile("Второй", ["штамп-б"]);

    const blend = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles/blend",
      "POST",
      {
        name: "Смесь",
        sources: [
          { profileId: a, weight: 0.7, emphasis: "ритм" },
          { profileId: b, weight: 0.3, emphasis: "метафорика" },
        ],
        instructions: "Держи сухость первого, образность второго.",
      },
    );

    expect(blend.kind).toBe("blend");
    expect(blend.fingerprint?.voiceSummary).toBe(FINGERPRINT.voiceSummary);
    expect(blend.blendConfig?.sources).toHaveLength(2);
    expect(blend.blendConfig?.instructions).toContain("сухость");
  });

  it("hands the blender both parents with their weights and emphasis", async () => {
    const a = await makeExtractedProfile("Первый", []);
    const b = await makeExtractedProfile("Второй", []);

    await sendJson<ProfileJson>(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [
        { profileId: a, weight: 0.7, emphasis: "ритм" },
        { profileId: b, weight: 0.3 },
      ],
    });

    expect(blenderMock).toHaveBeenCalledTimes(1);
    const call = blenderMock.mock.calls[0]![0];
    expect(call.blendName).toBe("Смесь");
    expect(call.parents).toHaveLength(2);
    expect(call.parents[0]!.name).toBe("Первый");
    expect(call.parents[0]!.emphasis).toBe("ритм");
    expect(call.parents[1]!.weight).toBe(0.3);
  });

  it("unions the parents' fatigue lists", async () => {
    const a = await makeExtractedProfile("Первый", ["штамп-а", "общий"]);
    const b = await makeExtractedProfile("Второй", ["штамп-б", "общий"]);

    const blend = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles/blend",
      "POST",
      {
        name: "Смесь",
        sources: [
          { profileId: a, weight: 0.5 },
          { profileId: b, weight: 0.5 },
        ],
      },
    );

    const list = blend.fatigueWords?.blacklist ?? [];
    expect(list).toContain("штамп-а");
    expect(list).toContain("штамп-б");
    expect(list.filter((w) => w === "общий")).toHaveLength(1);
  });

  it("rejects a parent that has never been extracted", async () => {
    const a = await makeExtractedProfile("Первый", []);
    const bare = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "Пустой", language: "ru" },
    );

    const res = await send(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [
        { profileId: a, weight: 0.5 },
        { profileId: bare.id, weight: 0.5 },
      ],
    });

    expect(res.status).toBe(400);
    expect(blenderMock).not.toHaveBeenCalled();
  });

  it("rejects the same profile listed twice", async () => {
    const a = await makeExtractedProfile("Первый", []);

    const res = await send(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [
        { profileId: a, weight: 0.5 },
        { profileId: a, weight: 0.5 },
      ],
    });

    expect(res.status).toBe(400);
  });

  it("404s on a missing source profile", async () => {
    const a = await makeExtractedProfile("Первый", []);

    const res = await send(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [
        { profileId: a, weight: 0.5 },
        { profileId: 4242, weight: 0.5 },
      ],
    });

    expect(res.status).toBe(404);
  });

  it("requires at least two sources", async () => {
    const a = await makeExtractedProfile("Первый", []);

    const res = await send(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [{ profileId: a, weight: 1 }],
    });

    expect(res.status).toBe(400);
  });

  it("surfaces a blender failure as 500 and creates nothing", async () => {
    const a = await makeExtractedProfile("Первый", []);
    const b = await makeExtractedProfile("Второй", []);
    blenderMock.mockRejectedValueOnce(new Error("no API key"));

    const res = await send(t.app, "/api/style-profiles/blend", "POST", {
      name: "Смесь",
      sources: [
        { profileId: a, weight: 0.5 },
        { profileId: b, weight: 0.5 },
      ],
    });

    expect(res.status).toBe(500);
    const list = await sendJson<ProfileJson[]>(
      t.app,
      "/api/style-profiles",
      "GET",
    );
    expect(list.some((p) => p.kind === "blend")).toBe(false);
  });

  it("shows up as an ordinary profile a book can point at", async () => {
    const a = await makeExtractedProfile("Первый", []);
    const b = await makeExtractedProfile("Второй", []);
    const blend = await sendJson<ProfileJson>(
      t.app,
      "/api/style-profiles/blend",
      "POST",
      {
        name: "Смесь",
        sources: [
          { profileId: a, weight: 0.5 },
          { profileId: b, weight: 0.5 },
        ],
      },
    );

    const book = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "Книга",
      premise: "Премиса",
    });
    const updated = await sendJson<{ styleProfileId: number | null }>(
      t.app,
      `/api/books/${book.id}`,
      "PATCH",
      { styleProfileId: blend.id },
    );

    expect(updated.styleProfileId).toBe(blend.id);
  });
});
