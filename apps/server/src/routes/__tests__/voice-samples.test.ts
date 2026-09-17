import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson { id: number }
interface CharacterJson { id: number }
interface SampleJson { id: number; status: string; situation: string; text: string }

let t: TestApp;
let bookId: number;
let rin: CharacterJson;
let sarek: CharacterJson;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Голос" });
  bookId = b.id;
  rin = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST",
    { canonicalName: "Рин", profile: { description: "Инженер." } });
  sarek = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST",
    { canonicalName: "Сарек", profile: { description: "Навигатор." } });
});
afterEach(() => t.cleanup());

describe("банк образцов речи", () => {
  it("авторский образец создаётся сразу принятым", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Не надо. Я сама.",
      situation: "conflict",
      origin: "author",
    });
    expect(s.status).toBe("accepted");
    const list = await sendJson<SampleJson[]>(t.app, `/api/characters/${rin.id}/voice-samples`, "GET");
    expect(list).toHaveLength(1);
  });

  it("образец модели ждёт принятия", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Хорошо, посмотрим.",
      situation: "neutral",
      origin: "llm",
    });
    expect(s.status).toBe("proposed");
    const accepted = await sendJson<SampleJson>(t.app, `/api/voice-samples/${s.id}`, "PATCH", {
      status: "accepted",
    });
    expect(accepted.status).toBe("accepted");
  });

  it("AC-30: адресат из другой книги отклоняется", async () => {
    const other = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Чужая" });
    const alien = await sendJson<CharacterJson>(t.app, `/api/books/${other.id}/characters`, "POST",
      { canonicalName: "Чужой", profile: { description: "X" } });
    const r = await send(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Привет.",
      situation: "stranger",
      addresseeCharacterId: alien.id,
    });
    expect(r.status).toBe(400);
  });

  it("адресат из своей книги принимается", async () => {
    const r = await send(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Ты опять за своё.",
      situation: "intimate",
      addresseeCharacterId: sarek.id,
    });
    expect(r.status).toBe(201);
  });

  it("удаление возвращает 204 и убирает образец", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Х", situation: "neutral",
    });
    const del = await send(t.app, `/api/voice-samples/${s.id}`, "DELETE");
    expect(del.status).toBe(204);
    expect(await sendJson<SampleJson[]>(t.app, `/api/characters/${rin.id}/voice-samples`, "GET")).toHaveLength(0);
  });
});
