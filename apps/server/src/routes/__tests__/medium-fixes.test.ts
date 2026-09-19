import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

/** Средние замечания ревью 2026-09-19: С2 (тёзки), С10 (удаление молчит),
 *  С11 (импорт дублирует главы). */

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Книга",
  });
  bookId = b.id;
});
afterEach(() => t.cleanup());

const profile = { description: "герой" };

describe("тёзки (С2)", () => {
  it("второй герой с тем же именем требует согласия автора", async () => {
    await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "Анна",
      profile,
    });
    const res = await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "анна",
      profile,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("duplicate_character_name");

    const forced = await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "анна",
      profile,
      allowDuplicateName: true,
    });
    expect(forced.status).toBe(201);
  });

  it("склонение имени — тот же герой, а не новый", async () => {
    await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "Анна",
      profile,
    });
    const res = await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "Анны",
      profile,
    });
    expect(res.status).toBe(409);
  });
});

describe("удаление героя называет потери (С10)", () => {
  it("считает события, образцы речи и отношения", async () => {
    const anna = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "Анна", profile },
    );
    const boris = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/characters`,
      "POST",
      { canonicalName: "Борис", profile },
    );
    const now = new Date().toISOString();
    t.sqlite
      .prepare(
        `INSERT INTO relationships (book_id, from_character_id, to_character_id, type, tension, created_at, updated_at)
         VALUES (?, ?, ?, 'напарник', 0, ?, ?)`,
      )
      .run(bookId, anna.id, boris.id, now, now);
    t.sqlite
      .prepare(
        `INSERT INTO character_voice_samples
           (book_id, character_id, text, situation, origin, status, created_at, updated_at)
         VALUES (?, ?, 'Так точно.', 'authority', 'author', 'accepted', ?, ?)`,
      )
      .run(bookId, anna.id, now, now);
    t.sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, kind, data_json, origin, verification,
            extractor_version, dedup_key, created_at)
         VALUES (?, ?, 'knowledge', '{"fact":"знает"}', 'manual', 'confirmed', 1, 'k1', ?)`,
      )
      .run(bookId, anna.id, now);

    const res = await send(t.app, `/api/characters/${anna.id}`, "DELETE");
    expect(res.status).toBe(200);
    const lost = (await res.json()) as {
      deletedEvents: number;
      deletedVoiceSamples: number;
      deletedRelationships: number;
    };
    expect(lost).toMatchObject({
      deletedEvents: 1,
      deletedVoiceSamples: 1,
      deletedRelationships: 1,
    });
  });
});

describe("повторный импорт (С11)", () => {
  it("не плодит те же главы второй раз", async () => {
    const content = "# Глава первая\n\nТекст первой главы.\n\n# Глава вторая\n\nТекст второй.";
    await send(t.app, `/api/books/${bookId}/import`, "POST", {
      filename: "roman.md",
      content,
    });
    const second = await sendJson<{
      created: Array<{ title: string }>;
      skipped: Array<{ title: string; reason: string }>;
    }>(t.app, `/api/books/${bookId}/import`, "POST", {
      filename: "roman.md",
      content,
    });

    expect(second.created).toHaveLength(0);
    expect(second.skipped.map((s) => s.title)).toEqual(["Глава первая", "Глава вторая"]);

    const chapters = await sendJson<Array<unknown>>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "GET",
    );
    expect(chapters).toHaveLength(2);
  });

  it("по-прежнему добавляет новые главы того же файла", async () => {
    await send(t.app, `/api/books/${bookId}/import`, "POST", {
      filename: "roman.md",
      content: "# Глава первая\n\nТекст первой главы.",
    });
    const second = await sendJson<{ created: Array<{ title: string }> }>(
      t.app,
      `/api/books/${bookId}/import`,
      "POST",
      {
        filename: "roman.md",
        content: "# Глава первая\n\nТекст первой главы.\n\n# Глава вторая\n\nТекст второй.",
      },
    );
    expect(second.created.map((ch) => ch.title)).toEqual(["Глава вторая"]);
  });
});

describe("второй разбор той же книги (С14)", () => {
  it("отклоняется, пока идёт первый", async () => {
    // Реестр прогонов живёт в памяти процесса и ключуется одной книгой.
    // Второй поток прежде забирал слот, и идущий разбор становился
    // невидимым: ни показать, ни остановить.
    let release = (): void => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      await held;
      return { fragments: [] } as never;
    });

    const first = send(t.app, `/api/books/${bookId}/intake-stream`, "POST", {
      files: [{ filename: "а.md", content: "Мир держится на соли." }],
    });
    // Ждём, пока первый прогон встанет в реестр.
    for (let i = 0; i < 50; i += 1) {
      const probe = await send(t.app, `/api/books/${bookId}/intake/inflight`, "GET");
      if (probe.status === 200) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const second = await send(t.app, `/api/books/${bookId}/intake-stream`, "POST", {
      files: [{ filename: "б.md", content: "Другой файл." }],
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("intake_in_progress");

    release();
    await first;
  });
});
