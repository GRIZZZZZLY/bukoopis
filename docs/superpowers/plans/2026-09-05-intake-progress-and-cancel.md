# Приём материала: прогресс по файлам и отмена — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автор видит, какой файл разбирается сейчас, куда легли уже разобранные и какие не прочитались, и может остановить разбор, не потеряв сделанного.

**Architecture:** Оркестрация приёма выносится из маршрута в переиспользуемый раннер `runIntake` с колбэком `onFile`. Существующий `POST /books/:id/intake` остаётся ровно таким же (он вызывает раннер и игнорирует прогресс) — это тестируемая и скриптуемая поверхность. Рядом появляется `POST /books/:id/intake-stream`, который шлёт событие на каждый файл и в конце то же тело, что отдаёт JSON-маршрут. Отмена — отдельный `POST /books/:id/intake/cancel` с ключом запроса; раннер сверяется с реестром отмен между файлами. Прервать вызов LLM на середине нельзя (`dispatchStructured` не принимает сигнал), поэтому отмена означает «не начинать следующий файл», и интерфейс говорит это прямо.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Node 22, zod 4.4.3, Hono + `streamSSE`, better-sqlite3, React 18, Vite 6, vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md`. Это не новая фаза, а закрытие известного долга фазы 2: одиннадцать последовательных вызовов LLM за одним блокирующим запросом, около 8–15 минут, и одна статичная строка на экране. Фаза 2 влита в `feat/de-ai-prose-layer` коммитом `c3c14dd`.

## Global Constraints

- Node 22 LTS, ESM only, TypeScript strict с `noUncheckedIndexedAccess`.
- Импорты между пакетами только через `workspace:*` и поле `exports`.
- **Миграции БД нет. Новых зависимостей нет.**
- **`POST /books/:id/intake` не меняет ни поведения, ни формы ответа.** Его одиннадцать тестов — страховочная сеть всей этой работы и должны оставаться зелёными без правок. Если тест приходится менять — остановиться и доложить.
- Отмена не прерывает текущий вызов LLM: `dispatchStructured` не принимает `AbortSignal`. Отмена = не начинать следующий файл. Любой текст интерфейса, обещающий мгновенную остановку, — дефект.
- Отменённый разбор **сохраняет то, что уже разобрано**, журналирует результат и отвечает нормальным `done` с признаком отмены. Отмена — не ошибка.
- Все строки интерфейса на русском.
- Десктоп-only.
- Веб-тесты мокают `@/api/client`; msw нет. Потоковые ответы в тестах собираются из `ReadableStream`.
- TDD: сначала падающий тест.
- Каждая задача заканчивается зелёными `pnpm typecheck` и `pnpm test` и своим коммитом.
- Команды из корня:
  - `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake.test.ts`
  - `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake-stream.test.ts`
  - `pnpm --filter @book-forge/web test -- src/components/studio/intake`
  - `pnpm typecheck` · `pnpm test`

---

## Карта файлов

**Создать**
- `apps/server/src/utils/intake-run.ts` — `runIntake`, `IntakeFileEvent`, `IntakeRunResult`.
- `apps/server/src/utils/intake-cancel.ts` — реестр отмен.
- `apps/server/src/utils/__tests__/intake-run.test.ts`, `intake-cancel.test.ts`.
- `apps/server/src/routes/__tests__/intake-stream.test.ts`.
- `apps/web/src/components/studio/intake/IntakeProgress.tsx` + тест.

**Изменить**
- `apps/server/src/routes/studio.ts` — маршрут `/intake` худеет до вызова раннера; добавляются `/intake-stream` и `/intake/cancel`.
- `apps/web/src/api/client.ts` — `intakeStream`, `cancelIntake`.
- `apps/web/src/components/studio/intake/IntakePanel.tsx` (+ тест).
- `CLAUDE.md`.

---

### Task 1: Оркестрация приёма как переиспользуемый раннер

**Files:**
- Create: `apps/server/src/utils/intake-run.ts`
- Test: `apps/server/src/utils/__tests__/intake-run.test.ts`
- Modify: `apps/server/src/routes/studio.ts` (маршрут `/intake` начинает звать раннер)

**Interfaces:**
- Produces:
  ```ts
  export interface IntakeFileEvent {
    index: number;        // 0-based
    total: number;
    filename: string;
    status: "started" | "done" | "failed";
    /** Куда легли фрагменты этого файла; только при status "done". */
    targets?: IntakeTarget[];
    /** Причина; только при status "failed". */
    message?: string;
  }
  export interface RunIntakeDeps {
    sqlite: DatabaseType;
    hasVec: boolean;
    repo: StudioRepository;
    bookId: number;
  }
  export interface RunIntakeInput {
    files: Array<{ filename: string; content?: string; contentBase64?: string }>;
    onFile?: (e: IntakeFileEvent) => void;
    shouldStop?: () => boolean;
  }
  export interface IntakeRunResult {
    summary: IntakeSummaryRow[];
    ideaSet: boolean;
    chapters: InsertedChapter[];
    failures: Array<{ filename: string; message: string }>;
    revision: number;
    cancelled: boolean;
    requestKey: string;
    /** Ответ взят из журнала, агент не вызывался. */
    replayed: boolean;
  }
  export async function runIntake(deps: RunIntakeDeps, input: RunIntakeInput): Promise<IntakeRunResult>;
  export class IntakeBookNotFoundError extends Error {}
  ```

- [ ] **Шаг 1: Закрепить текущее поведение**

Убедиться, что `apps/server/src/routes/__tests__/intake.test.ts` зелёный на нетронутом коде:

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake.test.ts`
Expected: PASS (11 тестов). Это страховочная сеть. Если красный — остановиться и доложить.

- [ ] **Шаг 2: Написать падающие тесты раннера**

Создать `apps/server/src/utils/__tests__/intake-run.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioRepository } from "../../db/studio.js";
import { runIntake, IntakeBookNotFoundError, type IntakeFileEvent } from "../intake-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let dir: string;
let sqlite: Database.Database;
let repo: ReturnType<typeof createStudioRepository>;
let bookId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intake-run-"));
  sqlite = new Database(join(dir, "t.sqlite"));
  migrate(drizzle(sqlite), {
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
  });
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO books (title, language, status, created_at, updated_at)
       VALUES ('Приём', 'ru', 'draft', ?, ?)`,
    )
    .run(now, now);
  bookId = Number(info.lastInsertRowid);
  repo = createStudioRepository(sqlite);
  vi.mocked(runMaterialClassifier).mockReset();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const deps = () => ({ sqlite, hasVec: false, repo, bookId });
const file = (n: string) => ({ filename: n, content: `# ${n}\nтекст файла ${n}` });

function worldFragment(title: string) {
  return { fragments: [{ target: "world" as const, title, body: `тело ${title}` }] };
}

describe("runIntake", () => {
  it("throws IntakeBookNotFoundError for an unknown book", async () => {
    await expect(
      runIntake({ ...deps(), bookId: 9999 }, { files: [file("а.md")] }),
    ).rejects.toBeInstanceOf(IntakeBookNotFoundError);
  });

  it("reports started and done for each file, in order, with its targets", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(worldFragment("Карта"))
      .mockResolvedValueOnce(worldFragment("Кухня"));
    const events: IntakeFileEvent[] = [];
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md")],
      onFile: (e) => events.push(e),
    });
    expect(events.map((e) => [e.index, e.filename, e.status])).toEqual([
      [0, "а.md", "started"],
      [0, "а.md", "done"],
      [1, "б.md", "started"],
      [1, "б.md", "done"],
    ]);
    expect(events.every((e) => e.total === 2)).toBe(true);
    expect(events[1]!.targets).toEqual(["world"]);
    expect(out.cancelled).toBe(false);
    expect(out.replayed).toBe(false);
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 2]]);
  });

  it("reports a failed file with its message and keeps going", async () => {
    vi.mocked(runMaterialClassifier)
      .mockRejectedValueOnce(new Error("LLM failure"))
      .mockResolvedValueOnce(worldFragment("Кухня"));
    const events: IntakeFileEvent[] = [];
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md")],
      onFile: (e) => events.push(e),
    });
    const failed = events.find((e) => e.status === "failed");
    expect(failed).toMatchObject({ index: 0, filename: "а.md", message: "LLM failure" });
    expect(out.failures).toEqual([{ filename: "а.md", message: "LLM failure" }]);
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
  });

  it("stops starting files once shouldStop says so, and keeps what was classified", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    let stop = false;
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md"), file("в.md")],
      onFile: (e) => {
        if (e.index === 0 && e.status === "done") stop = true;
      },
      shouldStop: () => stop,
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(out.cancelled).toBe(true);
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 1]]);
    const state = repo.loadStudioState(bookId);
    expect(state.stages.world?.aspects).toHaveLength(1);
  });

  it("replays a previous run for the same files without calling the agent", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const first = await runIntake(deps(), { files: [file("а.md")] });
    const events: IntakeFileEvent[] = [];
    const again = await runIntake(deps(), {
      files: [file("а.md")],
      onFile: (e) => events.push(e),
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(again.replayed).toBe(true);
    expect(events).toEqual([]);
    expect(again.summary).toEqual(first.summary);
    expect(repo.loadStudioState(bookId).stages.world?.aspects).toHaveLength(1);
  });

  it("does not journal a run that achieved nothing", async () => {
    vi.mocked(runMaterialClassifier).mockRejectedValue(new Error("нет ключа"));
    await runIntake(deps(), { files: [file("а.md")] });
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const second = await runIntake(deps(), { files: [file("а.md")] });
    expect(second.replayed).toBe(false);
    expect(second.summary.map((r) => r.target)).toEqual(["world"]);
  });
});
```

- [ ] **Шаг 3: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-run.test.ts`
Expected: FAIL — модуля `../intake-run.js` нет.

- [ ] **Шаг 4: Перенести оркестрацию в раннер**

Создать `apps/server/src/utils/intake-run.ts`. Тело переносится из обработчика `/intake` в `studio.ts` **как есть**, меняются только три вещи: источник входа (аргумент вместо разбора тела), добавляются вызовы `onFile` вокруг каждого файла и проверка `shouldStop` перед началом очередного, и в результат добавляются `cancelled`, `requestKey`, `replayed`. Ошибка «книги нет» становится `IntakeBookNotFoundError` вместо `Response`.

Обязательные свойства переноса, каждое уже закреплено тестами `/intake`:
- разбор base64 и `.docx` до классификации, с попаданием нечитаемого файла в `failures`;
- ограничение `MAX_INTAKE_FILE_CHARS`, тоже через `failures`;
- ключ идемпотентности считается по `readable`, а не по исходному телу;
- запись `studio_state` через `repo.patchStudioState` с прочитанной ревизией, конфликт — наружу;
- `insertChapters` и `patchConcept` в своих `try/catch`, их сбой становится записью в `failures`;
- журнал `import_merge` пишется только если что-то легло, и содержит фактический результат.

`onFile` вызывается синхронно; раннер не ждёт его. Исключение из `onFile` не должно ронять разбор — обернуть вызов в `try/catch` и проглотить, иначе кривой потребитель уронит чужую работу.

- [ ] **Шаг 5: `/intake` начинает звать раннер**

Обработчик `POST /books/:id/intake` в `studio.ts` сокращается до: разбор тела схемой, вызов `runIntake`, отображение `IntakeBookNotFoundError` в `notFound(c, "book")` и `StudioConflictError` в 409, и `c.json({ summary, ideaSet, chapters, failures, revision })` — **ровно те же пять полей, что и раньше**. `cancelled`, `requestKey` и `replayed` в JSON-ответ не добавляются.

- [ ] **Шаг 6: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-run.test.ts src/routes/__tests__/intake.test.ts && pnpm typecheck && pnpm test`
Expected: PASS, включая все одиннадцать тестов `/intake` без единой правки.

- [ ] **Шаг 7: Commit**

```bash
git add apps/server/src/utils/intake-run.ts apps/server/src/utils/__tests__/intake-run.test.ts apps/server/src/routes/studio.ts
git commit -m "refactor(intake): extract the run so a streaming route can share it"
```

---

### Task 2: Реестр отмен

**Files:**
- Create: `apps/server/src/utils/intake-cancel.ts`
- Test: `apps/server/src/utils/__tests__/intake-cancel.test.ts`

**Interfaces:**
- Produces: `createIntakeCancelRegistry(): IntakeCancelRegistry` со свойствами `begin(bookId: number, requestKey: string): void`, `requestStop(bookId: number, requestKey: string): boolean`, `shouldStop(bookId: number, requestKey: string): boolean`, `end(bookId: number, requestKey: string): void`, `size(): number`.

- [ ] **Шаг 1: Падающий тест**

Создать `apps/server/src/utils/__tests__/intake-cancel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createIntakeCancelRegistry } from "../intake-cancel.js";

describe("intake cancel registry", () => {
  it("a run that was never begun cannot be stopped", () => {
    const r = createIntakeCancelRegistry();
    expect(r.requestStop(1, "k")).toBe(false);
    expect(r.shouldStop(1, "k")).toBe(false);
  });

  it("marks a begun run as stopping", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    expect(r.shouldStop(1, "k")).toBe(false);
    expect(r.requestStop(1, "k")).toBe(true);
    expect(r.shouldStop(1, "k")).toBe(true);
  });

  it("keeps runs of different books and different keys apart", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.begin(2, "k");
    r.begin(1, "other");
    r.requestStop(1, "k");
    expect(r.shouldStop(1, "k")).toBe(true);
    expect(r.shouldStop(2, "k")).toBe(false);
    expect(r.shouldStop(1, "other")).toBe(false);
  });

  it("end removes the run, so a late stop finds nothing and leaks nothing", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.end(1, "k");
    expect(r.size()).toBe(0);
    expect(r.requestStop(1, "k")).toBe(false);
    expect(r.shouldStop(1, "k")).toBe(false);
  });

  it("end is safe to call twice", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.end(1, "k");
    r.end(1, "k");
    expect(r.size()).toBe(0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-cancel.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Шаг 3: Реализовать**

Создать `apps/server/src/utils/intake-cancel.ts`:

```ts
/** Кто сейчас разбирает материалы и кого попросили остановиться.
 *
 *  В памяти, а не в БД: разбор живёт внутри одного запроса, и если процесс
 *  перезапустился — останавливать уже нечего. Инструмент однопользовательский,
 *  одновременных разборов одной книги не бывает, но ключ включает и книгу, и
 *  запрос, чтобы «Остановить» не задело чужой разбор. */
export interface IntakeCancelRegistry {
  begin: (bookId: number, requestKey: string) => void;
  /** true, если такой разбор идёт и его пометили на остановку. */
  requestStop: (bookId: number, requestKey: string) => boolean;
  shouldStop: (bookId: number, requestKey: string) => boolean;
  end: (bookId: number, requestKey: string) => void;
  size: () => number;
}

export function createIntakeCancelRegistry(): IntakeCancelRegistry {
  const stopping = new Map<string, boolean>();
  const key = (bookId: number, requestKey: string): string =>
    `${bookId}␟${requestKey}`;

  return {
    begin: (bookId, requestKey) => {
      stopping.set(key(bookId, requestKey), false);
    },
    requestStop: (bookId, requestKey) => {
      const k = key(bookId, requestKey);
      if (!stopping.has(k)) return false;
      stopping.set(k, true);
      return true;
    },
    shouldStop: (bookId, requestKey) => stopping.get(key(bookId, requestKey)) === true,
    end: (bookId, requestKey) => {
      stopping.delete(key(bookId, requestKey));
    },
    size: () => stopping.size,
  };
}
```

- [ ] **Шаг 4: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-cancel.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Шаг 5: Commit**

```bash
git add apps/server/src/utils/intake-cancel.ts apps/server/src/utils/__tests__/intake-cancel.test.ts
git commit -m "feat(intake): a registry of runs that can be asked to stop"
```

---

### Task 3: Потоковый маршрут и отмена

**Files:**
- Modify: `apps/server/src/routes/studio.ts`
- Create: `apps/server/src/routes/__tests__/intake-stream.test.ts`

**Interfaces:**
- Produces HTTP:
  - `POST /api/books/:id/intake-stream`, тело как у `/intake`. Ответ — SSE. События: `file` (полезная нагрузка `IntakeFileEvent`), `begin` (`{ requestKey, total }`, шлётся один раз перед первым файлом), затем ровно одно из `done` (`{ summary, ideaSet, chapters, failures, revision, cancelled }`) или `error` (`{ error, details }`).
  - `POST /api/books/:id/intake/cancel`, тело `{ requestKey: string }`. `200 { stopping: true }` если такой разбор идёт, `404` если нет.

- [ ] **Шаг 1: Падающий тест**

Создать `apps/server/src/routes/__tests__/intake-stream.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, jsonReq, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runMaterialClassifier).mockReset();
});
afterEach(() => t.cleanup());

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Поток" });
  return r.id;
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Читает SSE-ответ целиком и разбирает его на события. */
async function readEvents(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  const out: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) continue;
    out.push({
      event: evLine.slice("event:".length).trim(),
      data: JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>,
    });
  }
  return out;
}

const file = (n: string) => ({ filename: n, content: `# ${n}\nтекст ${n}` });
const world = (title: string) => ({
  fragments: [{ target: "world" as const, title, body: `тело ${title}` }],
});

describe("POST /api/books/:id/intake-stream", () => {
  it("404 for an unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/intake-stream", "POST", { files: [file("а.md")] });
    expect(r.status).toBe(404);
  });

  it("400 for an empty file list", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/intake-stream`, "POST", { files: [] });
    expect(r.status).toBe(400);
  });

  it("emits begin, a pair of file events per file, then done", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(world("Карта"))
      .mockResolvedValueOnce(world("Кухня"));
    const id = await createBook();
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", { files: [file("а.md"), file("б.md")] }),
    );
    const events = await readEvents(res);
    expect(events[0]!.event).toBe("begin");
    expect(events[0]!.data.total).toBe(2);
    expect(typeof events[0]!.data.requestKey).toBe("string");
    expect(events.filter((e) => e.event === "file").map((e) => [e.data.index, e.data.status])).toEqual([
      [0, "started"], [0, "done"], [1, "started"], [1, "done"],
    ]);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.cancelled).toBe(false);
    expect((done.data.summary as Array<{ target: string; count: number }>).map((r) => [r.target, r.count]))
      .toEqual([["world", 2]]);
  });

  it("a failed file is reported as it happens, not only at the end", async () => {
    vi.mocked(runMaterialClassifier)
      .mockRejectedValueOnce(new Error("LLM failure"))
      .mockResolvedValueOnce(world("Кухня"));
    const id = await createBook();
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", { files: [file("а.md"), file("б.md")] }),
    );
    const events = await readEvents(res);
    const failed = events.find((e) => e.event === "file" && e.data.status === "failed");
    expect(failed?.data).toMatchObject({ filename: "а.md", message: "LLM failure" });
    // и он пришёл раньше, чем начался второй файл
    const failedAt = events.indexOf(failed!);
    const secondStarted = events.findIndex((e) => e.event === "file" && e.data.index === 1);
    expect(failedAt).toBeLessThan(secondStarted);
  });
});

describe("POST /api/books/:id/intake/cancel", () => {
  it("404 when no such run is in flight", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/intake/cancel`, "POST", { requestKey: "нет-такого" });
    expect(r.status).toBe(404);
  });

  it("stops the run after the file in flight and keeps what landed", async () => {
    const id = await createBook();
    let cancelled = false;
    // Отмена приходит, пока разбирается первый файл: раннер сверяется с
    // реестром перед следующим, поэтому второй файл не начнётся.
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      if (!cancelled) {
        cancelled = true;
        const state = await sendJson<{ requestKey: string }>(
          t.app, `/api/books/${id}/intake/inflight`, "GET",
        );
        await send(t.app, `/api/books/${id}/intake/cancel`, "POST", { requestKey: state.requestKey });
      }
      return world("Карта");
    });
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", {
        files: [file("а.md"), file("б.md"), file("в.md")],
      }),
    );
    const events = await readEvents(res);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.cancelled).toBe(true);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect((done.data.summary as Array<{ count: number }>)[0]!.count).toBe(1);
  });
});
```

Замечание к последнему тесту: он требует способа узнать `requestKey` идущего разбора изнутри теста. Проще всего — считать его из события `begin`, но тело ответа читается целиком после завершения. Поэтому маршрут `GET /books/:id/intake/inflight`, отдающий `{ requestKey }` текущего разбора книги (`404`, если разбора нет), — часть этой задачи. Он же полезен вживую: вкладка, переоткрытая во время разбора, может узнать, что разбор идёт.

- [ ] **Шаг 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake-stream.test.ts`
Expected: FAIL — маршрутов нет.

- [ ] **Шаг 3: Реализовать**

В `studio.ts`: создать реестр рядом с `repo` (`const intakeCancels = createIntakeCancelRegistry();`), добавить схему тела отмены (`z.object({ requestKey: z.string().min(1) })`) и три маршрута.

`/intake-stream` разбирает тело той же схемой, что `/intake`, проверяет существование книги до открытия потока (чтобы 404 и 400 остались обычными кодами, а не событием внутри потока), затем отдаёт `streamSSE`. Внутри: считает `requestKey` тем же способом, что раннер, `begin` в реестре, шлёт событие `begin`, зовёт `runIntake` с `onFile`, пишущим событие `file`, и `shouldStop`, спрашивающим реестр; в конце — `done` или `error`; `end` в реестре в `finally`.

Записи в поток выстраиваются в цепочку промисов, как это уже сделано в `sse-progress.ts`: `onFile` синхронный, а `writeSSE` асинхронный, и без цепочки события перемешаются.

`requestKey` нужен и маршруту, и раннеру. Чтобы не считать его дважды по-разному, экспортировать из `intake-run.ts` функцию, которая приводит входные файлы к `readable` и возвращает ключ, и звать её в обоих местах — либо, проще, дать `runIntake` необязательный колбэк `onBegin(requestKey, total)`, который маршрут использует и для реестра, и для события `begin`. Второй вариант надёжнее: ключ гарантированно один и тот же.

- [ ] **Шаг 4: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake-stream.test.ts src/routes/__tests__/intake.test.ts && pnpm typecheck && pnpm test`
Expected: PASS, тесты `/intake` без правок.

- [ ] **Шаг 5: Commit**

```bash
git add apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/intake-stream.test.ts
git commit -m "feat(intake): stream per-file progress and let the author stop it"
```

---

### Task 4: Клиент — поток и отмена

**Files:**
- Modify: `apps/web/src/api/client.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IntakeFileEvent { index: number; total: number; filename: string;
    status: "started" | "done" | "failed"; targets?: IntakeTarget[]; message?: string }
  export interface IntakeStreamHandlers {
    onBegin?: (e: { requestKey: string; total: number }) => void;
    onFile?: (e: IntakeFileEvent) => void;
  }
  intakeStream(bookId: number, files: IntakeFile[], handlers: IntakeStreamHandlers):
    Promise<IntakeResponse & { cancelled: boolean }>
  cancelIntake(bookId: number, requestKey: string): Promise<void>
  ```

- [ ] **Шаг 1: Реализовать по местной идиоме**

В `client.ts` уже есть четыре потребителя SSE через `res.body.getReader()` + `TextDecoder` (строки около 716, 790, 936, 1003). Написать `intakeStream` тем же способом: разбирать блоки, разделённые пустой строкой, звать `onBegin`/`onFile` на соответствующих событиях, вернуть полезную нагрузку `done`, бросить на `error` с тем же кодом, что и обычные маршруты.

`cancelIntake` — обычный `req` на `POST /api/books/${bookId}/intake/cancel` с телом `{ requestKey }`.

Тип `IntakeFile` (`{ filename: string; content?: string; contentBase64?: string }`) вынести и использовать и в `intake`, и в `intakeStream`, чтобы две сигнатуры не разъехались.

- [ ] **Шаг 2: Прогнать**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS (нового поведения ещё никто не зовёт).

- [ ] **Шаг 3: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "feat(web): read the intake stream and ask it to stop"
```

---

### Task 5: Живой прогресс в панели

**Files:**
- Create: `apps/web/src/components/studio/intake/IntakeProgress.tsx`
- Test: `apps/web/src/components/studio/intake/__tests__/IntakeProgress.test.tsx`
- Modify: `apps/web/src/components/studio/intake/IntakePanel.tsx` (+ его тест)
- Modify: `apps/web/src/styles/library-warm.css`

**Interfaces:**
- `IntakeProgress` props: `{ total: number; rows: IntakeProgressRow[]; stopping: boolean; onStop: () => void }`, где `IntakeProgressRow = { filename: string; status: "running" | "done" | "failed"; targets?: IntakeTarget[]; message?: string }`.

- [ ] **Шаг 1: Падающие тесты**

Создать `apps/web/src/components/studio/intake/__tests__/IntakeProgress.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeProgress } from "../IntakeProgress";

const ROWS = [
  { filename: "00_Оглавление.md", status: "done" as const, targets: ["concept" as const, "plot" as const] },
  { filename: "Связи.md", status: "failed" as const, message: "LLM failure" },
  { filename: "Карта.md", status: "running" as const },
];

describe("IntakeProgress", () => {
  it("counts the files it has finished against the total", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} onStop={vi.fn()} />);
    expect(screen.getByText(/2 из 11/)).toBeInTheDocument();
  });

  it("names each file and, for the finished ones, where the material went", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} onStop={vi.fn()} />);
    expect(screen.getByText("00_Оглавление.md")).toBeInTheDocument();
    expect(screen.getByText(/Замысел/)).toBeInTheDocument();
    expect(screen.getByText(/План книги/)).toBeInTheDocument();
  });

  it("shows a failed file's reason without hiding the rest", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} onStop={vi.fn()} />);
    expect(screen.getByText(/LLM failure/)).toBeInTheDocument();
    expect(screen.getByText("Карта.md")).toBeInTheDocument();
  });

  it("stops on request and says the current file will finish first", async () => {
    const onStop = vi.fn();
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: /Остановить/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("while stopping, the button is spent and the promise is honest", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={true} onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Останавливаем/ })).toBeDisabled();
    expect(screen.getByText(/текущий файл/i)).toBeInTheDocument();
  });
});
```

Дописать в `IntakePanel.test.tsx`:

```tsx
  it("shows live progress while the stream runs and the summary when it ends", async () => {
    let emit!: (e: { index: number; total: number; filename: string; status: string }) => void;
    m.intakeStream.mockImplementation((_id: number, _files: unknown, h: { onFile?: (e: unknown) => void }) => {
      emit = h.onFile!;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ...OK, cancelled: false }), 0);
      });
    });
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalled());
    emit({ index: 0, total: 1, filename: "Карта.md", status: "started" });
    expect(await screen.findByText("Карта.md")).toBeInTheDocument();
    await waitFor(() => screen.getByText("Материалы разобраны"));
  });

  it("asks the server to stop and reports it stopped", async () => {
    let begin!: (e: { requestKey: string; total: number }) => void;
    m.intakeStream.mockImplementation((_id: number, _f: unknown, h: { onBegin?: (e: unknown) => void }) => {
      begin = h.onBegin!;
      return new Promise((resolve) => setTimeout(() => resolve({ ...OK, cancelled: true }), 0));
    });
    m.cancelIntake.mockResolvedValue(undefined as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalled());
    begin({ requestKey: "k1", total: 1 });
    await userEvent.click(await screen.findByRole("button", { name: /Остановить/ }));
    expect(m.cancelIntake).toHaveBeenCalledWith(3, "k1");
    await waitFor(() => expect(screen.getByText(/Разбор остановлен/)).toBeInTheDocument());
  });
```

(В моке `@/api/client` добавить `intakeStream` и `cancelIntake`.)

- [ ] **Шаг 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/intake`
Expected: FAIL.

- [ ] **Шаг 3: Реализовать**

`IntakeProgress` — карточка со строкой «Разбираем материалы… N из M», списком файлов (⟳ / ✓ с названиями этапов из `INTAKE_TARGET_LABELS` / ✗ с причиной) и кнопкой «Остановить». При `stopping` кнопка становится «Останавливаем…», отключается, и рядом появляется строка вида «Текущий файл дочитаем, следующие не начнём».

`IntakePanel` переходит с `api.intake` на `api.intakeStream`: держит `requestKey`, `total`, массив строк и флаг `stopping`; `onBegin` записывает ключ, `onFile` дописывает или обновляет строку по `index`. Пока поток идёт — рендерит `IntakeProgress` вместо `DropZone`. По завершении показывает `IntakeSummary`, а если `cancelled` — с пометкой «Разбор остановлен, сохранили то, что успели».

Ошибка чтения файлов на стороне браузера остаётся как есть: она попадает в `failures` до вызова сервера.

- [ ] **Шаг 4: Стили**

В конец `library-warm.css`:

```css
.intake-progress-list { display: grid; gap: 6px; margin: 10px 0; padding: 0; list-style: none; }
.intake-progress-row { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: baseline; font-size: 13px; }
.intake-progress-row .mark { font-size: 12px; color: var(--color-text-muted); }
.intake-progress-row.is-failed .mark { color: var(--color-ink-red); }
.intake-progress-row.is-done .mark { color: var(--color-ink-green); }
.intake-progress-where { color: var(--color-text-muted); }
.intake-progress-why { color: var(--color-ink-red); }
```

- [ ] **Шаг 5: Прогнать**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Шаг 6: Commit**

```bash
git add apps/web/src/components/studio/intake apps/web/src/styles/library-warm.css
git commit -m "feat(web): show the intake file by file and let the author stop it"
```

---

### Task 6: Документация

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Шаг 1: Дописать к абзацу о приёме материала**

К существующему абзацу «Приём материала» добавить, проверив каждое утверждение по коду:

что оркестрация живёт в `runIntake` ([utils/intake-run.ts](apps/server/src/utils/intake-run.ts)) и её зовут оба маршрута — `POST /books/:id/intake` (JSON, прежняя форма ответа, удобен для скриптов) и `POST /books/:id/intake-stream` (SSE: `begin`, по паре событий `file` на каждый файл, затем `done` или `error`); что отмена — это `POST /books/:id/intake/cancel` с `requestKey` из события `begin`, проверяемый реестром в памяти между файлами; и что **прервать текущий вызов LLM нельзя** — `dispatchStructured` не принимает сигнал, поэтому отмена означает «не начинать следующий файл», а отменённый разбор сохраняет разобранное, журналируется и отвечает обычным `done` с `cancelled: true`.

- [ ] **Шаг 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record how intake reports progress and stops"
```

---

## Self-review

**Покрытие решения автора:** прогресс по файлам — Task 3 (события) и Task 5 (экран); ошибки по конкретным файлам сразу — Task 1 (`onFile` со `status: "failed"`), закреплено тестом «пришёл раньше, чем начался следующий файл»; отмена — Task 2, 3, 5, с сохранением разобранного и честной формулировкой про текущий файл.

**Что осталось за рамками намеренно.** Прогресс *внутри* одного файла (проценты от `streamAgentProgress`) не показывается: файл разбирается одним вызовом, и оценка по времени внутри него добавила бы шума больше, чем смысла — счётчик файлов информативнее. Параллельный разбор нескольких файлов не вводится: он ломает и порядок событий, и обработку частичных отказов, а выигрыш во времени съедается лимитами API. Оба стоит пересмотреть, если после живого прогона окажется, что одиннадцать файлов всё ещё слишком долго.

**Согласованность имён:** `IntakeFileEvent` объявлен в Task 1, повторён в клиенте в Task 4 и потребляется в Task 5; `requestKey` рождается в Task 1, попадает в реестр и событие `begin` в Task 3, хранится в панели в Task 5 и уходит в `cancelIntake`.

**Порядок без красных задач:** Task 1 сохраняет `/intake` дословно под его собственными одиннадцатью тестами; Task 2 автономен; Task 3 соединяет их; Task 4 добавляет клиентские методы, которых ещё никто не зовёт; Task 5 переключает панель; Task 6 — документация.

**Риск, который план принимает.** Реестр отмен живёт в памяти процесса. Перезапуск сервера во время разбора теряет возможность отменить — но и сам разбор теряется вместе с процессом, так что терять нечего. В БД его класть незачем.
