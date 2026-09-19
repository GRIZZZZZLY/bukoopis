import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { CharacterProfileV2 } from "@book-forge/shared";

/** К4 ревью 2026-09-19: повторное «Добавить в канон» писало `profile_json`
 *  целиком из профиля кандидата Мастерской. Кандидат несёт пять полей
 *  (`name/role/age/background/description`), а карточка V2 — цели, ценности,
 *  принципы, профиль голоса и план автора, которые автор заполняет руками во
 *  вкладках. Всё, чего нет у кандидата, сбрасывалось в умолчания. */

let t: TestApp;
let bookId: number;

interface MaterializeResponse {
  aspectId: string;
  createdEntityIds: number[];
  candidates: Array<{
    tempId: string;
    decision: string;
    materializedEntityId?: number;
  }>;
}

interface CharacterResponse {
  id: number;
  revision: number;
  profile: CharacterProfileV2;
}

function materialize(
  candidateProfile: Record<string, unknown>,
  materializedEntityId?: number,
): Promise<MaterializeResponse> {
  return sendJson<MaterializeResponse>(
    t.app,
    `/api/books/${bookId}/aspects/aspect-1/materialize`,
    "POST",
    {
      stageId: "characters",
      aspectName: "Главные герои",
      candidates: [
        {
          tempId: "c1",
          decision: "accept",
          profile: candidateProfile,
          ...(materializedEntityId !== undefined ? { materializedEntityId } : {}),
        },
      ],
    },
  );
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Состав",
    premise: "p",
  });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("повторная материализация состава (К4)", () => {
  it("не затирает поля карточки, которых у кандидата нет", async () => {
    const first = await materialize({ name: "Анна", role: "смотритель" });
    const characterId = first.candidates[0]!.materializedEntityId!;

    // Автор дозаполняет карточку во вкладках знаний.
    const edited = await sendJson<CharacterResponse>(
      t.app,
      `/api/characters/${characterId}`,
      "PATCH",
      {
        expectedRevision: 0,
        profile: {
          name: "Анна",
          role: "смотритель",
          description: "Смотритель маяка, двадцать лет на одном месте.",
          goals: [
            { goal: "Дождаться ответа на письмо", horizon: "long", conflictsWith: null },
          ],
          contradictions: ["Боится темноты и работает ночами"],
          voiceProfile: { lineLength: "короткие реплики, много пауз" },
        },
      },
    );
    expect(edited.profile.goals).toHaveLength(1);

    // Второе «Добавить в канон»: у кандидата изменилась только роль.
    await materialize({ name: "Анна", role: "старший смотритель" }, characterId);

    const after = await sendJson<CharacterResponse>(
      t.app,
      `/api/characters/${characterId}`,
      "GET",
    );
    expect(after.profile.role).toBe("старший смотритель");
    expect(after.profile.goals).toHaveLength(1);
    expect(after.profile.goals[0]!.goal).toBe("Дождаться ответа на письмо");
    expect(after.profile.contradictions).toEqual([
      "Боится темноты и работает ночами",
    ]);
    expect(after.profile.voiceProfile.lineLength).toBe(
      "короткие реплики, много пауз",
    );
    expect(after.profile.description).toBe(
      "Смотритель маяка, двадцать лет на одном месте.",
    );
  });

  it("отказывает, когда карточка изменилась после того, как кандидат её видел", async () => {
    const first = await materialize({ name: "Борис", role: "рыбак" });
    const characterId = first.candidates[0]!.materializedEntityId!;

    await send(t.app, `/api/characters/${characterId}`, "PATCH", {
      expectedRevision: 0,
      profile: { name: "Борис", role: "рыбак", description: "Правка автора." },
    });

    // Вкладка Мастерской помнит ревизию 0 — ту, что была при первой
    // материализации. Молча переписать героя поверх правки нельзя.
    const res = await send(
      t.app,
      `/api/books/${bookId}/aspects/aspect-1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Главные герои",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            profile: { name: "Борис", role: "старый рыбак" },
            materializedEntityId: characterId,
            expectedRevision: 0,
          },
        ],
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("revision_conflict");

    const after = await sendJson<CharacterResponse>(
      t.app,
      `/api/characters/${characterId}`,
      "GET",
    );
    expect(after.profile.description).toBe("Правка автора.");
  });

  it("кандидат с полем не той формы не стирает поле карточки", async () => {
    const first = await materialize({ name: "Вера", role: "радистка" });
    const characterId = first.candidates[0]!.materializedEntityId!;

    await sendJson<CharacterResponse>(
      t.app,
      `/api/characters/${characterId}`,
      "PATCH",
      {
        expectedRevision: 0,
        profile: {
          name: "Вера",
          goals: [{ goal: "Поймать сигнал", horizon: "current", conflictsWith: null }],
        },
      },
    );

    // Классификатор интейка волен положить в профиль что угодно: схема
    // кандидата `.catchall(z.unknown())`. Такое значение уходит в `extra`, и
    // накладывать вместо него пустое умолчание схемы значило бы стирать цели.
    await materialize(
      { name: "Вера", role: "старшая радистка", goals: "поймать сигнал" },
      characterId,
    );

    const after = await sendJson<CharacterResponse>(
      t.app,
      `/api/characters/${characterId}`,
      "GET",
    );
    expect(after.profile.role).toBe("старшая радистка");
    expect(after.profile.goals).toHaveLength(1);
  });

  it("повтор того же запроса после правки карточки доходит до проверки ревизии", async () => {
    const first = await materialize({ name: "Глеб", role: "боцман" });
    const characterId = first.candidates[0]!.materializedEntityId!;

    const body = {
      stageId: "characters" as const,
      aspectName: "Главные герои",
      candidates: [
        {
          tempId: "c1",
          decision: "accept" as const,
          profile: { name: "Глеб", role: "старший боцман" },
          materializedEntityId: characterId,
          expectedRevision: 0,
        },
      ],
    };
    const ok = await send(
      t.app,
      `/api/books/${bookId}/aspects/aspect-1/materialize`,
      "POST",
      body,
    );
    expect(ok.status).toBe(200);

    // Автор правит карточку (ревизия уходит вперёд), после чего вкладка
    // повторяет ровно то же тело. Кэш ответа по ключу запроса не должен
    // прятать конфликт: тело описывает ревизию, которой уже нет.
    await send(t.app, `/api/characters/${characterId}`, "PATCH", {
      expectedRevision: 1,
      profile: { name: "Глеб", description: "Правка автора." },
    });

    const again = await send(
      t.app,
      `/api/books/${bookId}/aspects/aspect-1/materialize`,
      "POST",
      { ...body, candidates: [{ ...body.candidates[0]!, expectedRevision: 1 }] },
    );
    expect(again.status).toBe(409);
  });

  it("предмет, уже заведённый в канон, обновляется, а не дублируется", async () => {
    const first = await sendJson<MaterializeResponse>(
      t.app,
      `/api/books/${bookId}/aspects/aspect-items/materialize`,
      "POST",
      {
        stageId: "items",
        aspectName: "Предметы",
        candidates: [
          {
            tempId: "i1",
            decision: "accept",
            profile: { name: "Лампа", properties: "медная" },
          },
        ],
      },
    );
    const itemId = first.candidates[0]!.materializedEntityId!;

    await sendJson<MaterializeResponse>(
      t.app,
      `/api/books/${bookId}/aspects/aspect-items/materialize`,
      "POST",
      {
        stageId: "items",
        aspectName: "Предметы",
        candidates: [
          {
            tempId: "i1",
            decision: "accept",
            profile: { name: "Лампа", properties: "медная, с трещиной" },
            materializedEntityId: itemId,
          },
        ],
      },
    );

    const items = t.sqlite
      .prepare("SELECT COUNT(*) c FROM items WHERE book_id = ?")
      .get(bookId) as { c: number };
    expect(items.c).toBe(1);
  });
});
