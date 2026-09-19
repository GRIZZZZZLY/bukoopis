import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));
vi.mock("@book-forge/agents/concept/pitches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@book-forge/agents/concept/pitches")>()),
  runPitchGenerator: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import {
  runPitchGenerator,
  type PitchDraft,
} from "@book-forge/agents/concept/pitches";
import type { BookConcept } from "@book-forge/shared";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { createStudioRepository } from "../../db/studio.js";
import { runIntake } from "../intake-run.js";

/** К3 ревью 2026-09-19: `books.concept` пишется снимком, прочитанным ДО
 *  многоминутного вызова модели. Автор в той же Мастерской генерирует питчи,
 *  утверждает замысел, правит строки — и завершившийся разбор кладёт обратно
 *  то, что прочитал в начале. Правило: перед записью перечитать и внести
 *  только своё поле. */

let t: TestApp;
let repo: ReturnType<typeof createStudioRepository>;
let bookId: number;

const deps = () => ({ sqlite: t.sqlite, hasVec: false, repo, bookId });
const file = (n: string) => ({ filename: n, content: `# ${n}\nтекст файла ${n}` });

function pitch(title: string): PitchDraft {
  return {
    workingTitle: title,
    logline: `Когда ${title} рушится, героиня выбирает, иначе теряет всё.`,
    protagonist: "Нейла, проводница каравана.",
    conflict: "Маршрут ведёт в аномалию.",
    stakes: "Караван и репутация семьи.",
    hook: "В архивах маршрута невозможная правка.",
    genre: "фантастика",
    tone: "холодный",
    audience: "adult" as const,
    strength: "Понятный конфликт.",
    risk: "Много мира до выбора.",
  };
}

/** Действие автора, случившееся, пока модель работает. */
function authorAddsPitchMidRun(): void {
  const concept = repo.loadConcept(bookId);
  repo.patchConcept(bookId, {
    ...concept,
    pitches: [...concept.pitches, { id: "author-pitch", ...pitch("Питч автора") }],
  });
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Концепт",
  });
  bookId = b.id;
  repo = createStudioRepository(t.sqlite);
  vi.mocked(runMaterialClassifier).mockReset();
  vi.mocked(runPitchGenerator).mockReset();
});
afterEach(() => t.cleanup());

describe("приём материала и концепт (К3)", () => {
  it("не стирает питчи, добавленные автором, пока шёл разбор", async () => {
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      authorAddsPitchMidRun();
      return {
        bookIdea: "Замысел из материалов автора.",
        fragments: [{ target: "world" as const, title: "Карта", body: "тело" }],
      };
    });

    const out = await runIntake(deps(), { files: [file("а.md")] });
    expect(out.ideaSet).toBe(true);

    const concept = repo.loadConcept(bookId);
    expect(concept.idea).toBe("Замысел из материалов автора.");
    expect(concept.pitches.map((p) => p.workingTitle)).toEqual(["Питч автора"]);
  });

  it("не перезаписывает замысел, который автор напечатал сам, пока шёл разбор", async () => {
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      const concept = repo.loadConcept(bookId);
      repo.patchConcept(bookId, { ...concept, idea: "Замысел, написанный автором." });
      return {
        bookIdea: "Замысел из материалов автора.",
        fragments: [{ target: "world" as const, title: "Карта", body: "тело" }],
      };
    });

    const out = await runIntake(deps(), { files: [file("а.md")] });

    expect(repo.loadConcept(bookId).idea).toBe("Замысел, написанный автором.");
    expect(out.ideaSet).toBe(false);
  });
});

describe("генерация питчей и концепт (К3)", () => {
  it("не стирает замысел, утверждённый автором, пока модель писала питчи", async () => {
    await sendJson<BookConcept>(t.app, `/api/books/${bookId}/concept`, "PATCH", {
      ...repo.loadConcept(bookId),
      idea: "Смотритель маяка находит письмо из будущего.",
    });

    vi.mocked(runPitchGenerator).mockImplementation(async () => {
      const concept = repo.loadConcept(bookId);
      repo.patchConcept(bookId, { ...concept, hook: "Крючок, который выбрал автор." });
      return { pitches: [pitch("Машинный питч")], questions: [] };
    });

    const res = await sendJson<{ concept: BookConcept }>(
      t.app,
      `/api/books/${bookId}/concept/pitches`,
      "POST",
      {},
    );

    expect(res.concept.hook).toBe("Крючок, который выбрал автор.");
    expect(res.concept.pitches.map((p) => p.workingTitle)).toEqual([
      "Машинный питч",
    ]);
    expect(repo.loadConcept(bookId).hook).toBe("Крючок, который выбрал автор.");
  });
});
