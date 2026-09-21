import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  RouterProvider,
  createMemoryRouter,
} from "react-router-dom";
import type { BookConcept } from "@book-forge/shared";

/**
 * Тест-страж «ноль → глава 1» (ТЗ конвейера, фаза 6).
 *
 * Считает две вещи на быстром пути автора: сколько раз он нажимает и сколько
 * раз ждёт модель. Пороги — из ТЗ: не больше 12 нажатий и не больше 4 ожиданий.
 * Страж не про красоту экрана: воронка растёт незаметно, по одному «ещё одному
 * шагу» за ветку, и заметить это можно только счётом.
 *
 * Экраны настоящие, вызовы сервера — моки. Считается то, что автор действительно
 * нажимает: каждый `click` идёт через счётчик. Ожиданием считается вызов,
 * который на живом сервере уходит в модель (`LLM_CALLS`).
 *
 * Намерено сейчас: 7 нажатий и 3 ожидания (питчи, быстрый сбор, письмо главы).
 *
 * Чего страж НЕ считает: утверждение каждого раздела после быстрого сбора —
 * это отдельные экраны этапов, и их счёт живёт в их же тестах.
 */

// `vi.mock` поднимается наверх файла, поэтому всё, что читает его фабрика,
// живёт в `vi.hoisted`: иначе журнал вызовов недоступен на момент импорта.
const { calls, fixtures } = vi.hoisted(() => {
  const pitch = {
    id: "p1",
    workingTitle: "Соляной город",
    logline: "Инженер идёт в пустыню за пропавшим городом",
    protagonist: "Нина",
    conflict: "Город не хочет быть найденным",
    stakes: "Она потеряет слух",
    hook: "Соль поёт",
    genre: "тихая фантастика",
    tone: "сдержанный",
    audience: "adult" as const,
    strength: "образ",
    risk: "медленно",
  };
  const conceptEmpty = {
    schemaVersion: 1 as const,
    idea: "Инженер тишины ищет пропавший город",
    pitches: [] as (typeof pitch)[],
    premise: {},
    audience: "adult" as const,
  };
  const conceptWithPitches = { ...conceptEmpty, pitches: [pitch] };
  const conceptLocked = {
    ...conceptWithPitches,
    selectedPitchId: pitch.id,
    lockedAt: "2026-09-21T00:00:00.000Z",
    genre: pitch.genre,
    tone: pitch.tone,
    hook: pitch.hook,
    premise: {
      logline: pitch.logline,
      protagonist: pitch.protagonist,
      conflict: pitch.conflict,
      stakes: pitch.stakes,
    },
  };
  const book = {
    id: 1,
    title: "Соляной город",
    language: "ru",
    premise: pitch.logline,
    outlineJson: JSON.stringify({
      variants: [
        {
          label: "основной",
          logline: pitch.logline,
          estimatedChapters: 1,
          chapters: [{ title: "Порог", pov: "Нина", goal: "Уйти" }],
        },
      ],
      selectedIndex: 0,
      generatedAt: "2026-09-21T00:00:00.000Z",
    }),
    styleProfileId: null,
    status: "draft",
    writerModel: "opus",
    plotModel: "sonnet",
    criticModel: "sonnet",
    writerProvider: "anthropic",
    writerLocalModel: null,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
  return {
    calls: [] as string[],
    fixtures: { pitch, conceptEmpty, conceptWithPitches, conceptLocked, book },
  };
});

/** Вызовы, которые на сервере уходят в модель: каждый — ожидание автора. */
const LLM_CALLS = new Set([
  "generatePitches",
  "blendPitch",
  "refineConceptField",
  "generateBookOutline",
  "generateAspectVariants",
  "streamQuickStart",
  "streamWriteChapter",
]);

vi.mock("@/api/client", () => {
  const handlers: Record<string, (...args: never[]) => unknown> = {
    listBooks: () => Promise.resolve([]),
    listRecommended: () => Promise.resolve([]),
    getBooksStats: () => Promise.resolve({}),
    createBook: () => Promise.resolve(fixtures.book),
    patchConcept: () => Promise.resolve(fixtures.conceptWithPitches),
    generatePitches: () =>
      Promise.resolve({
        concept: fixtures.conceptWithPitches,
        questions: [],
        newPitchIds: ["p1"],
      }),
    lockConcept: () => Promise.resolve(fixtures.conceptLocked),
    getConcept: () => Promise.resolve(fixtures.conceptLocked),
    getBook: () => Promise.resolve(fixtures.book),
    getStudioState: () =>
      Promise.resolve({ schemaVersion: 1, revision: 1, stages: {} }),
    approvePlan: () => Promise.resolve({ created: 1, updated: 0, chapters: [] }),
    // `null` — «ничего не идёт»: с объектом панель считает сбор подхваченным
    // и вместо кнопки рисует чужой прогресс.
    getQuickStartInflight: () => Promise.resolve(null),
    streamQuickStart: (
      _bookId: never,
      handlers: { onDone?: (p: { cancelled: boolean }) => void },
    ) => {
      handlers.onDone?.({ cancelled: false });
      return Promise.resolve();
    },
    getChapter: () =>
      Promise.resolve({
        id: 10,
        bookId: 1,
        orderIndex: 10,
        title: "Порог",
        status: "draft",
        currentVersionId: null,
        planJson: JSON.stringify({
          variants: [
            {
              label: "основной",
              pov: "Нина",
              emotionalGoal: "тревога",
              estimatedWords: 1200,
              beats: [{ summary: "Нина уходит" }],
            },
          ],
          selectedIndex: 0,
          generatedAt: "2026-09-21T00:00:00.000Z",
        }),
        intent: "Нина уходит из дома",
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      }),
    listVersions: () => Promise.resolve([]),
    listChapters: () => Promise.resolve([]),
    getWritingProgress: () => Promise.resolve({ days: [], streak: 0, todayWords: 0 }),
    listCharacters: () => Promise.resolve([]),
    listLocations: () => Promise.resolve([]),
    listItems: () => Promise.resolve([]),
    listHooks: () => Promise.resolve([]),
    getSceneState: () =>
      Promise.resolve({
        chapterId: 10,
        versionId: null,
        state: null,
        origin: null,
        updatedAt: null,
        carry: null,
      }),
    getCritique: () => Promise.resolve({ report: null }),
  };

  function record(name: string) {
    return (...args: never[]) => {
      calls.push(name);
      const h = handlers[name];
      return h ? h(...args) : Promise.resolve({});
    };
  }

  // `then` обязан остаться undefined: модуль и объект `api` где-то
  // дожидаются через await, а thenable-объект с функцией-заглушкой вместо
  // `then` подвешивает ожидание навсегда.
  const opaque = (prop: string | symbol) =>
    typeof prop !== "string" || prop === "then" || prop === "__esModule";

  const api = new Proxy(
    {},
    { get: (_t, prop) => (opaque(prop) ? undefined : record(prop as string)) },
  );

  // Потоковые экспорты перечислены поимённо: пространство имён мока строится
  // копированием собственных свойств, и Proxy на модуле отдавал бы их только
  // при прямом обращении — импорт получал бы undefined.
  return {
    api,
    streamQuickStart: record("streamQuickStart"),
    streamWriteChapter: record("streamWriteChapter"),
    streamCritique: record("streamCritique"),
    streamRepair: record("streamRepair"),
    streamIntake: record("streamIntake"),
  };
});

import { BooksListPage } from "@/pages/BooksListPage";
import { ConceptStage } from "@/components/studio/concept/ConceptStage";
import { QuickStartPanel } from "@/components/studio/QuickStartPanel";
import { PlanStagePage } from "@/pages/PlanStagePage";
import { ChapterPage } from "@/pages/ChapterPage";

let clicks = 0;

async function click(name: string | RegExp): Promise<void> {
  const button = await screen.findByRole("button", { name });
  clicks += 1;
  await userEvent.click(button);
}

function ConceptHarness() {
  const [concept, setConcept] = useState<BookConcept>(fixtures.conceptEmpty as BookConcept);
  return <ConceptStage bookId={1} concept={concept} onConceptChange={setConcept} />;
}

beforeEach(() => {
  calls.length = 0;
  clicks = 0;
});

describe("ноль → глава 1", () => {
  it("быстрый путь укладывается в 12 нажатий и 4 ожидания", async () => {
    // 1. Полка: «Новая книга» → задумка → «Начать».
    render(
      <MemoryRouter>
        <BooksListPage />
      </MemoryRouter>,
    );
    await click("Новая книга");
    await userEvent.type(
      screen.getByLabelText("О чём книга?"),
      "Инженер тишины ищет пропавший город",
    );
    await click("Начать");
    await waitFor(() => expect(calls).toContain("createBook"));
    cleanup();

    // 2. Замысел: питчи одной кнопкой, выбор карточки утверждает замысел.
    render(<ConceptHarness />);
    await click("Предложить питчи");
    const beforeQuickMode = clicks;
    await click("Выбрать этот");
    await waitFor(() => expect(calls).toContain("lockConcept"));
    cleanup();

    // 3. Быстрый сбор: один запуск на мир, лор, персонажей, предметы и план.
    render(<QuickStartPanel bookId={1} onFinished={() => {}} />);
    await click("Собрать всё до первой главы");
    await waitFor(() => expect(calls.join(" ")).toContain("streamQuickStart"));
    // ТЗ: быстрый режим — два нажатия. Это они: выбрать питч и запустить сбор.
    expect(clicks - beforeQuickMode).toBeLessThanOrEqual(2);
    cleanup();

    // 4. План: «Утвердить план» создаёт главы.
    render(
      <MemoryRouter initialEntries={["/books/1/studio/plot"]}>
        <Routes>
          <Route path="/books/:bookId/studio/:stageId" element={<PlanStagePage />} />
        </Routes>
      </MemoryRouter>,
    );
    await click("Утвердить план");
    await waitFor(() => expect(calls).toContain("approvePlan"));

    cleanup();

    // 5. Кабинет: «Написать главу» — последнее нажатие пути.
    // Кабинет сторожит уход со страницы через `useBlocker`, а тот живёт только
    // в data-роутере: обычный MemoryRouter здесь падает.
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: "/books/:bookId/chapters/:chapterId",
              element: <ChapterPage />,
            },
          ],
          { initialEntries: ["/books/1/chapters/10"] },
        )}
      />,
    );
    await click("Написать главу");
    await waitFor(() => expect(calls).toContain("streamWriteChapter"));

    const waits = calls.filter((c) => LLM_CALLS.has(c));
    const measured = `нажатий ${clicks}, ожиданий ${waits.length} (${waits.join(", ")})`;
    expect(clicks, measured).toBeLessThanOrEqual(12);
    expect(waits.length, measured).toBeLessThanOrEqual(4);
  });
});
