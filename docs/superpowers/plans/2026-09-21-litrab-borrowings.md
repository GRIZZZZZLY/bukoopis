# Заимствования из litrab.ai — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести в book-forge восемь приёмов Литраба: другие имена героя на экране, заметки автора вне промпта, «глазок» на карточке, «Описать» по каналу восприятия, отчёт о потерях после правки, признак устаревания паспорта стиля, чат по книге, генерация главы по беатам.

**Architecture:** Все восемь — независимые куски; одна миграция `0032_litrab_borrowings` на всю ветку (Task 1), дальше каждая задача самодостаточна. Ни одна не заводит второго экземпляра существующей логики: фильтр скрытых героев живёт в `gatherCharacterContext`, чат собирает контекст через `assembleGenerationContext`, битовая генерация — через тот же `runChapterWriter` и тот же кандидат `prose_proposals`. Ничего не утверждается без автора.

**Tech Stack:** pnpm workspaces, TypeScript strict (`noUncheckedIndexedAccess`), Hono + better-sqlite3 (сырой SQL, plain-SQL миграции), zod, React 18 + Vite + TipTap, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-21-litrab-borrowings.md`

## Global Constraints

- Миграции — рукописный SQL: `pnpm --filter @book-forge/server drizzle:new <name>` создаёт `.sql` и запись в журнале; drizzle-kit `generate` **не использовать**. После правки SQL обновить `apps/server/src/db/schema.ts` (только для типов/документации) и прогнать `pnpm migrate`.
- Пакеты общаются через `workspace:*` и `exports`; в `src/` соседнего пакета не лезть. Новый модуль в `packages/shared/src` добавляется в `packages/shared/src/index.ts`, в `packages/agents/src` — в `packages/agents/src/index.ts`.
- Новый агент = имя в `AGENT_NAMES` (`packages/llm/src/types.ts`) + строка в `DEFAULT_AGENT_BACKEND` (`packages/llm/src/router.ts`). Текстовый агент (без схемы) в `STRUCTURED_AGENT_NAMES` не входит и контракта не требует.
- Тесты маршрутов: `makeTestApp`, `send`, `sendJson` из `apps/server/src/routes/__tests__/_helpers.ts`. Модель мокается `vi.mock("@book-forge/agents", async (orig) => ({ ...(await orig()), <fn>: vi.fn() }))` ДО импорта хелперов.
- Веб-тесты: jsdom, `vi.mock("@/api/client", () => ({ api: {...} }))`, `render/screen/waitFor` из `@testing-library/react`, `userEvent` из `@testing-library/user-event`.
- Русские подписи. Слова «промпт»/«токен» на экране не появляются: «запрос к модели», «объём».
- Регулярки по русскому тексту — без `\b` (ASCII-only). Сравнение имён — только `mentionsEntityName` из `@book-forge/shared`.
- Opus не принимает `temperature`; передавать условно.
- Команды проверки из корня: `pnpm typecheck`, `pnpm test`; один файл — `pnpm --filter @book-forge/server test -- src/routes/__tests__/<file>.test.ts`, `pnpm --filter @book-forge/web test -- src/components/__tests__/<file>.test.tsx`.
- Коммиты — маленькие, `feat:`/`test:`/`refactor:`, завершать строкой `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Ветка: `feat/litrab-borrowings` от `main`.

## Карта файлов

| Файл | Ответственность |
|---|---|
| `apps/server/drizzle/0032_litrab_borrowings.sql` | все колонки и таблицы ветки |
| `apps/server/src/db/schema.ts`, `apps/server/src/db/rows.ts` | типы строк, `toBook`, `toCharacter` |
| `packages/shared/src/book.ts` | `authorNotes` в схеме книги и в PATCH |
| `packages/shared/src/entities.ts` | `entityAliasSchema`, `hiddenFromPrompts`, `promptVisibilityInputSchema` |
| `packages/shared/src/inline.ts` | команда `describe`, каналы восприятия |
| `packages/shared/src/prose-diff.ts` | `findLostMentions` |
| `packages/shared/src/proposal.ts`, `packages/shared/src/plot.ts` | `beatsDone/beatsTotal`, `mode/fromBeat` |
| `packages/shared/src/chat.ts` (новый) | схемы тредов и сообщений чата |
| `packages/agents/src/inline.ts` | инструкция «Описать» |
| `packages/agents/src/character.ts` | фильтр скрытых героев (единственный) |
| `packages/agents/src/chat.ts` (новый) | агент `book_chat` |
| `packages/agents/src/writer.ts` | промпт беата |
| `packages/llm/src/types.ts`, `packages/llm/src/router.ts` | имя и бэкенд `book_chat` |
| `apps/server/src/routes/books.ts` | PATCH `authorNotes` |
| `apps/server/src/routes/entities.ts` | `PATCH /characters/:id/prompt-visibility` |
| `apps/server/src/routes/inline.ts` | `describe` без `afterText` |
| `apps/server/src/routes/style.ts`, `apps/server/src/utils/style-corpus.ts` (новый) | свежесть стиля, добор глав в корпус |
| `apps/server/src/routes/chat.ts` (новый) | маршруты чата |
| `apps/server/src/routes/plot.ts`, `apps/server/src/routes/proposals.ts`, `apps/server/src/utils/prose-proposals.ts`, `apps/server/src/utils/proposal-cancel.ts`, `apps/server/src/utils/prosemirror.ts` | режим по беатам, `hold` |
| `apps/web/src/api/client.ts` | клиентские функции всех задач |
| `apps/web/src/components/AliasEditor.tsx` (новый), `KnowledgePanel.tsx` | другие имена, глазок |
| `apps/web/src/components/chapter/AuthorNotesPanel.tsx` (новый) | заметки автора |
| `apps/web/src/components/InlineCommandPanel.tsx` | кнопка «Описать» и каналы |
| `apps/web/src/components/chapter/ProposalPanel.tsx`, `CritiquePanel.tsx` | потери после правки, беаты |
| `apps/web/src/components/chapter/StyleFreshnessNote.tsx` (новый) | устаревание стиля |
| `apps/web/src/components/chapter/ChatPanel.tsx` (новый) | чат |
| `apps/web/src/pages/ChapterPage.tsx` | правая колонка: заметки, стиль, чат; режим по беатам |
| `CLAUDE.md` | раздел о заимствованиях |

---

### Task 1: Миграция 0032, схема, строки, общие типы

**Files:**
- Create: `apps/server/drizzle/0032_litrab_borrowings.sql` (через `drizzle:new`)
- Modify: `apps/server/drizzle/meta/_journal.json` (скрипт допишет сам)
- Modify: `apps/server/src/db/schema.ts` — `books`, `characters`, `proseProposals`, новые `chatThreads`, `chatMessages`
- Modify: `apps/server/src/db/rows.ts` — `BookRow`, `CharacterRow`, `toBook`, `toCharacter`
- Modify: `apps/server/src/utils/prose-proposals.ts` — `ProseProposalRow`, `toProposal`
- Modify: `packages/shared/src/book.ts`, `packages/shared/src/entities.ts`, `packages/shared/src/proposal.ts`
- Test: `apps/server/src/routes/__tests__/litrab-borrowings.test.ts` (новый; сюда же лягут тесты задач 3, 4, 7)

**Interfaces:**
- Produces: колонки `books.author_notes`, `characters.hidden_from_prompts`, `prose_proposals.beats_done`, `prose_proposals.beats_total`; таблицы `chat_threads`, `chat_messages`; поля `Book.authorNotes: string | null`, `Character.hiddenFromPrompts: boolean`, `ProseProposal.beatsDone: number | null`, `ProseProposal.beatsTotal: number | null`.

- [ ] **Step 1: Ветка и заготовка миграции**

```bash
git checkout -b feat/litrab-borrowings
pnpm --filter @book-forge/server drizzle:new litrab_borrowings
```

Ожидаемо: создан `apps/server/drizzle/0032_litrab_borrowings.sql` (пустой) и запись `idx: 32` в `meta/_journal.json`.

- [ ] **Step 2: SQL миграции**

Содержимое `apps/server/drizzle/0032_litrab_borrowings.sql`:

```sql
-- Заимствования из litrab.ai (docs/superpowers/specs/2026-09-21-litrab-borrowings.md).

-- Сырые заметки автора. Единственная колонка книги, которую НЕ читает ни одна
-- сборка контекста: сюда автор кладёт то, что нельзя потерять, но не нужно
-- модели. Инвариант закреплён тестом на маячок.
ALTER TABLE `books` ADD COLUMN `author_notes` text;
--> statement-breakpoint

-- «Глазок»: герой, снятый с запросов. Читается ровно в одном месте —
-- gatherCharacterContext; планировщик и проверка состава видят его как прежде.
-- Не часть профиля: ревизия карточки от переключения не растёт.
ALTER TABLE `characters` ADD COLUMN `hidden_from_prompts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Глава по беатам: сколько беатов кандидат уже содержит и сколько их в плане.
-- NULL у обоих — кандидат писался целиком.
ALTER TABLE `prose_proposals` ADD COLUMN `beats_done` integer;
--> statement-breakpoint
ALTER TABLE `prose_proposals` ADD COLUMN `beats_total` integer;
--> statement-breakpoint

-- Чат по книге. Тред привязан к главе: разговор идёт над открытым текстом.
-- Треды друг о друге не знают — решение принято вслед за Литрабом: дешевле, и
-- вчерашняя ошибка не едет дальше по книге.
CREATE TABLE IF NOT EXISTS `chat_threads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `book_id` integer NOT NULL REFERENCES `books`(`id`) ON DELETE cascade,
  `chapter_id` integer NOT NULL REFERENCES `chapters`(`id`) ON DELETE cascade,
  `title` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_threads_chapter` ON `chat_threads` (`chapter_id`, `id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` integer NOT NULL REFERENCES `chat_threads`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `chat_messages_role_check` CHECK (`role` IN ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chat_messages_thread` ON `chat_messages` (`thread_id`, `id`);
```

- [ ] **Step 3: `schema.ts`**

В `books` после `memoryStaleFromChapterOrder`:

```ts
    /** Сырые заметки автора. В промпт не уходят никогда — см. тест на маячок
     *  в litrab-borrowings.test.ts. */
    authorNotes: text("author_notes"),
```

В `characters` после `revision`:

```ts
    /** «Глазок»: 1 — герой снят с запросов к модели (gatherCharacterContext
     *  его не сканирует). Не часть профиля, ревизию не двигает. */
    hiddenFromPrompts: integer("hidden_from_prompts").notNull().default(0),
```

В `proseProposals` после `backend`:

```ts
    /** Глава по беатам: сколько беатов уже в тексте и сколько их в плане.
     *  NULL — кандидат писался целиком. */
    beatsDone: integer("beats_done"),
    beatsTotal: integer("beats_total"),
```

Новые таблицы (в конец файла, перед секцией LLM usage или после `chapterSceneStates`):

```ts
/** Чат по книге: тред привязан к главе, разговор идёт над её текстом. */
export const chatThreads = sqliteTable(
  "chat_threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_chat_threads_chapter").on(t.chapterId, t.id)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_chat_messages_thread").on(t.threadId, t.id),
    check("chat_messages_role_check", sql`${t.role} IN ('user','assistant')`),
  ],
);
```

- [ ] **Step 4: Общие типы**

`packages/shared/src/book.ts`, в `bookSchema` после `writerLocalModel`:

```ts
  /** Сырые заметки автора; в запросы к модели не уходят. */
  authorNotes: z.string().nullable(),
```

В `updateBookInputSchema` после `writerLocalModel`:

```ts
    authorNotes: z.string().max(200_000).nullable().optional(),
```

`packages/shared/src/entities.ts`, в `characterSchema` после `revision`:

```ts
  /** «Глазок»: герой снят с запросов к модели. */
  hiddenFromPrompts: z.boolean(),
```

Там же, после `updateCharacterInputSchema`:

```ts
export const promptVisibilityInputSchema = z.object({ hidden: z.boolean() });
export type PromptVisibilityInput = z.infer<typeof promptVisibilityInputSchema>;

/** Другое имя героя (прозвище, титул, вариант): по нему резолвер сводит
 *  упоминания к одному id. */
export const entityAliasSchema = z.object({
  id: z.number().int().positive(),
  alias: z.string().min(1),
  createdAt: z.string(),
});
export type EntityAlias = z.infer<typeof entityAliasSchema>;
```

`packages/shared/src/proposal.ts`, в `proseProposalSchema` после `backend`:

```ts
  /** Глава по беатам: сколько беатов уже написано и сколько их в плане.
   *  null у обоих — кандидат писался целиком. */
  beatsDone: z.number().int().nonnegative().nullable(),
  beatsTotal: z.number().int().positive().nullable(),
```

- [ ] **Step 5: Строки сервера**

`apps/server/src/db/rows.ts`: в `BookRow` после `studio_state` добавить `author_notes: string | null;`; в `CharacterRow` после `revision` — `hidden_from_prompts: number;`. В `toBook` после `writerLocalModel`: `authorNotes: r.author_notes,`. В `toCharacter` после `revision`: `hiddenFromPrompts: r.hidden_from_prompts === 1,`.

`apps/server/src/utils/prose-proposals.ts`: в `ProseProposalRow` после `backend` — `beats_done: number | null; beats_total: number | null;`; в `toProposal` после `backend: row.backend,` — `beatsDone: row.beats_done, beatsTotal: row.beats_total,`.

`apps/server/src/utils/entity-resolve.ts`: заменить локальный `export interface EntityAlias {...}` на

```ts
import type { EntityAlias } from "@book-forge/shared";
export type { EntityAlias };
```

(импорт — к остальным импортам файла).

- [ ] **Step 6: Тест миграции**

Создать `apps/server/src/routes/__tests__/litrab-borrowings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, type TestApp } from "./_helpers.js";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.cleanup());

function columns(table: string): string[] {
  return (t.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

describe("миграция 0032", () => {
  it("добавляет колонки и таблицы ветки", () => {
    expect(columns("books")).toContain("author_notes");
    expect(columns("characters")).toContain("hidden_from_prompts");
    expect(columns("prose_proposals")).toEqual(
      expect.arrayContaining(["beats_done", "beats_total"]),
    );
    expect(columns("chat_threads")).toEqual(
      expect.arrayContaining(["book_id", "chapter_id", "title"]),
    );
    expect(columns("chat_messages")).toEqual(
      expect.arrayContaining(["thread_id", "role", "content"]),
    );
  });

  it("роль сообщения ограничена CHECK", () => {
    const b = t.sqlite
      .prepare(
        "INSERT INTO books (title, language, status, created_at, updated_at) VALUES ('к', 'ru', 'draft', 'n', 'n')",
      )
      .run();
    const ch = t.sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at) VALUES (?, 10, 'г', 'draft', 'n', 'n')",
      )
      .run(b.lastInsertRowid);
    const th = t.sqlite
      .prepare(
        "INSERT INTO chat_threads (book_id, chapter_id, created_at, updated_at) VALUES (?, ?, 'n', 'n')",
      )
      .run(b.lastInsertRowid, ch.lastInsertRowid);
    expect(() =>
      t.sqlite
        .prepare(
          "INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'system', 'x', 'n')",
        )
        .run(th.lastInsertRowid),
    ).toThrow(/CHECK/);
  });
});
```

Если `INSERT INTO chapters` падает на обязательной колонке, которой нет в этом списке, — открыть `PRAGMA table_info(chapters)` и добавить её со значением по умолчанию; тест проверяет CHECK, а не форму главы.

- [ ] **Step 7: Прогон и правка фикстур**

```bash
pnpm migrate
pnpm typecheck
```

Компилятор назовёт тестовые фикстуры типов `Book`, `Character`, `ProseProposal`, которым не хватает новых полей (например, `PROPOSAL` в `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx`). В каждую добавить: `authorNotes: null` / `hiddenFromPrompts: false` / `beatsDone: null, beatsTotal: null`. Других правок не делать.

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
pnpm test
```

Ожидаемо: зелёные.

- [ ] **Step 8: Коммит**

```bash
git add apps/server/drizzle apps/server/src/db packages/shared/src apps/server/src/utils/prose-proposals.ts apps/server/src/utils/entity-resolve.ts apps/server/src/routes/__tests__/litrab-borrowings.test.ts apps/web/src
git commit -m "feat: миграция 0032 — заметки автора, глазок героя, беаты кандидата, таблицы чата

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Другие имена героя — экран

**Files:**
- Modify: `apps/web/src/api/client.ts` — три функции в объекте `api`
- Create: `apps/web/src/components/AliasEditor.tsx`
- Modify: `apps/web/src/components/KnowledgePanel.tsx` — вставка `AliasEditor` в карточку героя
- Test: `apps/web/src/components/__tests__/AliasEditor.test.tsx`

**Interfaces:**
- Consumes: `EntityAlias` из `@book-forge/shared` (Task 1); маршруты `GET/POST /api/books/:id/entities/character/:entityId/aliases`, `DELETE /api/books/:id/aliases/:aliasId` (уже есть).
- Produces: `api.listCharacterAliases(bookId, characterId): Promise<EntityAlias[]>`, `api.addCharacterAlias(bookId, characterId, alias): Promise<EntityAlias[]>`, `api.deleteAlias(bookId, aliasId): Promise<void>`.

- [ ] **Step 1: Тест компонента**

`apps/web/src/components/__tests__/AliasEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AliasEditor } from "../AliasEditor";

vi.mock("@/api/client", () => ({
  api: {
    listCharacterAliases: vi.fn(),
    addCharacterAlias: vi.fn(),
    deleteAlias: vi.fn(),
  },
}));

import { api } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.listCharacterAliases).mockReset();
  vi.mocked(api.addCharacterAlias).mockReset();
  vi.mocked(api.deleteAlias).mockReset();
});

describe("AliasEditor", () => {
  it("показывает имена и добавляет новое по Enter", async () => {
    vi.mocked(api.listCharacterAliases).mockResolvedValue([
      { id: 1, alias: "Ваше Сиятельство", createdAt: "2026-09-21T00:00:00Z" },
    ]);
    vi.mocked(api.addCharacterAlias).mockResolvedValue([
      { id: 1, alias: "Ваше Сиятельство", createdAt: "2026-09-21T00:00:00Z" },
      { id: 2, alias: "Алёша", createdAt: "2026-09-21T00:00:01Z" },
    ]);
    render(<AliasEditor bookId={7} characterId={3} />);
    expect(await screen.findByText("Ваше Сиятельство")).toBeTruthy();

    const input = screen.getByPlaceholderText(/прозвище/i);
    await userEvent.type(input, "Алёша{enter}");
    await waitFor(() =>
      expect(api.addCharacterAlias).toHaveBeenCalledWith(7, 3, "Алёша"),
    );
    expect(await screen.findByText("Алёша")).toBeTruthy();
  });

  it("имя, закреплённое за другим героем, объясняется словами", async () => {
    vi.mocked(api.listCharacterAliases).mockResolvedValue([]);
    vi.mocked(api.addCharacterAlias).mockRejectedValue(
      new Error("HTTP 400: bad_request — alias already maps to entity 9"),
    );
    render(<AliasEditor bookId={7} characterId={3} />);
    await screen.findByPlaceholderText(/прозвище/i);
    await userEvent.type(screen.getByPlaceholderText(/прозвище/i), "Нина{enter}");
    expect(
      await screen.findByText(/уже закреплено за другим героем/i),
    ).toBeTruthy();
  });

  it("крестик удаляет имя", async () => {
    vi.mocked(api.listCharacterAliases)
      .mockResolvedValueOnce([{ id: 5, alias: "Граф", createdAt: "x" }])
      .mockResolvedValueOnce([]);
    vi.mocked(api.deleteAlias).mockResolvedValue(undefined);
    render(<AliasEditor bookId={7} characterId={3} />);
    await screen.findByText("Граф");
    await userEvent.click(screen.getByRole("button", { name: /убрать имя «Граф»/i }));
    await waitFor(() => expect(api.deleteAlias).toHaveBeenCalledWith(7, 5));
    await waitFor(() => expect(screen.queryByText("Граф")).toBeNull());
  });
});
```

- [ ] **Step 2: Запустить — должен упасть**

```bash
pnpm --filter @book-forge/web test -- src/components/__tests__/AliasEditor.test.tsx
```

Ожидаемо: FAIL — модуль `../AliasEditor` не найден.

- [ ] **Step 3: Клиент**

В `apps/web/src/api/client.ts` добавить `EntityAlias` в импорт типов из `@book-forge/shared` и в объект `api` после `deleteCharacter`:

```ts
  listCharacterAliases: (bookId: number, characterId: number) =>
    req<EntityAlias[]>(`/api/books/${bookId}/entities/character/${characterId}/aliases`),
  addCharacterAlias: (bookId: number, characterId: number, alias: string) =>
    req<EntityAlias[]>(`/api/books/${bookId}/entities/character/${characterId}/aliases`, {
      method: "POST",
      body: JSON.stringify({ alias }),
    }),
  deleteAlias: (bookId: number, aliasId: number) =>
    req<void>(`/api/books/${bookId}/aliases/${aliasId}`, { method: "DELETE" }),
```

- [ ] **Step 4: Компонент**

`apps/web/src/components/AliasEditor.tsx`:

```tsx
import { useEffect, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { api } from "@/api/client";
import type { EntityAlias } from "@book-forge/shared";

interface Props {
  bookId: number;
  characterId: number;
}

/** Другие имена героя: прозвища, титулы, варианты. По ним резолвер сводит
 *  «Ваше Сиятельство» и «Алексей» к одному id — иначе события и факты,
 *  извлечённые под вторым именем, отвергаются как «героя нет в составе». */
export function AliasEditor({ bookId, characterId }: Props) {
  const [list, setList] = useState<EntityAlias[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dropped = false;
    setList(null);
    api
      .listCharacterAliases(bookId, characterId)
      .then((l) => {
        if (!dropped) setList(l);
      })
      .catch((e) => {
        if (!dropped) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dropped = true;
    };
  }, [bookId, characterId]);

  async function add(): Promise<void> {
    const alias = value.trim();
    if (!alias || busy) return;
    setBusy(true);
    setError(null);
    try {
      setList(await api.addCharacterAlias(bookId, characterId, alias));
      setValue("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /already maps/.test(msg)
          ? "Это имя уже закреплено за другим героем."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(alias: EntityAlias): Promise<void> {
    setError(null);
    try {
      await api.deleteAlias(bookId, alias.id);
      setList(await api.listCharacterAliases(bookId, characterId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="text-xs text-[var(--color-muted-foreground)]">Другие имена</div>
      <div className="flex flex-wrap gap-1 items-center">
        {(list ?? []).map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs"
          >
            {a.alias}
            <button
              type="button"
              aria-label={`Убрать имя «${a.alias}»`}
              onClick={() => void remove(a)}
              className="opacity-60 hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          className="border border-[var(--color-input)] rounded-md px-2 py-0.5 text-xs min-w-[12rem]"
          placeholder="Прозвище, титул, вариант имени — Enter"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={busy || list === null}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Вставить в карточку героя**

В `apps/web/src/components/KnowledgePanel.tsx` добавить импорт `import { AliasEditor } from "@/components/AliasEditor";` и в `CharactersTab`, в `<li>` карточки, сразу после строки `{c.profile.lie && <div>Самообман: {c.profile.lie}</div>}`:

```tsx
              <AliasEditor bookId={bookId} characterId={c.id} />
```

- [ ] **Step 6: Прогон**

```bash
pnpm --filter @book-forge/web test -- src/components/__tests__/AliasEditor.test.tsx
pnpm typecheck
```

Ожидаемо: PASS.

- [ ] **Step 7: Коммит**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/AliasEditor.tsx apps/web/src/components/KnowledgePanel.tsx apps/web/src/components/__tests__/AliasEditor.test.tsx
git commit -m "feat: другие имена героя на карточке — экран над entity_aliases

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Заметки автора вне промпта

**Files:**
- Modify: `apps/server/src/routes/books.ts` — `PATCH /:id`
- Create: `apps/web/src/components/chapter/AuthorNotesPanel.tsx`
- Modify: `apps/web/src/pages/ChapterPage.tsx` — правая колонка
- Test: `apps/server/src/routes/__tests__/litrab-borrowings.test.ts` (дополнить), `apps/web/src/components/chapter/__tests__/AuthorNotesPanel.test.tsx`

**Interfaces:**
- Consumes: `Book.authorNotes`, `updateBookInputSchema.authorNotes` (Task 1), `useDebouncedSave` (`apps/web/src/lib/useDebouncedSave.ts`: возвращает `{ mark, flushNow, setBaseline, lastSavedAt, saving }`).
- Produces: `PATCH /api/books/:id { authorNotes }`; компонент `AuthorNotesPanel({ bookId, initialNotes, delayMs? })`.

- [ ] **Step 1: Серверные тесты**

Дописать в `litrab-borrowings.test.ts` (импорты `send`, `sendJson` добавить в строку импорта хелперов; `assembleGenerationContext` из `../../utils/generation-context.js`; `loadStudioContext, studioContextToPrompt` из `../../utils/studio-context.js`; типы `BookRow, ChapterRow` из `../../db/rows.js`):

```ts
describe("заметки автора", () => {
  const SENTINEL = "ЗАМЕТКА-МАЯЧОК-7731";

  async function bookWithNotes(): Promise<{ bookId: number; chapterId: number }> {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "Книга",
      premise: "Премиса",
    });
    const patched = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${b.id}`,
      "PATCH",
      { authorNotes: `План на завтра. ${SENTINEL}` },
    );
    expect(patched.authorNotes).toContain(SENTINEL);
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${b.id}/chapters`,
      "POST",
      { title: "Глава 1" },
    );
    return { bookId: b.id, chapterId: ch.id };
  }

  it("сохраняются и очищаются через PATCH", async () => {
    const { bookId } = await bookWithNotes();
    const got = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${bookId}`,
      "GET",
    );
    expect(got.authorNotes).toContain(SENTINEL);
    const cleared = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${bookId}`,
      "PATCH",
      { authorNotes: null },
    );
    expect(cleared.authorNotes).toBeNull();
  });

  it("не попадают ни в одну сборку контекста", async () => {
    const { bookId, chapterId } = await bookWithNotes();
    const book = t.sqlite.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow;
    const chapter = t.sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(chapterId) as ChapterRow;
    const assembled = await assembleGenerationContext(t.sqlite, {
      book,
      chapter,
      hasVec: false,
      scanTexts: ["текст"],
      retrievalQuery: "текст",
      povName: null,
      label: "test",
    });
    expect(JSON.stringify(assembled)).not.toContain(SENTINEL);
    expect(studioContextToPrompt(loadStudioContext(t.sqlite, bookId)) ?? "").not.toContain(
      SENTINEL,
    );
  });

  it("уходят в полную выгрузку книги", async () => {
    const { bookId } = await bookWithNotes();
    const res = await send(t.app, `/api/books/${bookId}/export.json`, "GET");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SENTINEL);
  });
});
```

- [ ] **Step 2: Запустить — первый тест падает**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
```

Ожидаемо: «сохраняются и очищаются» FAIL (`authorNotes` остаётся `null`: PATCH поле игнорирует). Выгрузка проходит уже сейчас — она зовёт `toBook`.

- [ ] **Step 3: PATCH книги**

В `apps/server/src/routes/books.ts`, обработчик `r.patch("/:id", …)`: в объект `next` добавить

```ts
      authorNotes:
        parsed.data.authorNotes === undefined
          ? existing.author_notes
          : parsed.data.authorNotes,
```

и заменить UPDATE на

```ts
    sqlite
      .prepare(
        `UPDATE books
         SET title=?, premise=?, status=?, style_profile_id=?,
             writer_model=?, plot_model=?, critic_model=?,
             writer_provider=?, writer_local_model=?, author_notes=?,
             updated_at=?
         WHERE id=?`,
      )
      .run(
        next.title,
        next.premise,
        next.status,
        next.styleProfileId,
        next.writerModel,
        next.plotModel,
        next.criticModel,
        next.writerProvider,
        next.writerLocalModel,
        next.authorNotes,
        now,
        id,
      );
```

(порядок аргументов после `writerLocalModel` — новый `authorNotes`, затем прежние `now, id`).

- [ ] **Step 4: Прогон серверных тестов**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
```

Ожидаемо: PASS все.

- [ ] **Step 5: Тест панели**

`apps/web/src/components/chapter/__tests__/AuthorNotesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorNotesPanel } from "../AuthorNotesPanel";

vi.mock("@/api/client", () => ({
  api: { updateBook: vi.fn() },
}));

import { api } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.updateBook).mockReset();
  vi.mocked(api.updateBook).mockResolvedValue({} as never);
});

describe("AuthorNotesPanel", () => {
  it("показывает начальный текст и подпись о промпте", () => {
    render(<AuthorNotesPanel bookId={3} initialNotes="зонт у скамейки" delayMs={10} />);
    expect(screen.getByDisplayValue("зонт у скамейки")).toBeTruthy();
    expect(screen.getByText(/в запросы к модели не уходит/i)).toBeTruthy();
  });

  it("сохраняет набранное с задержкой", async () => {
    render(<AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10} />);
    await userEvent.type(screen.getByRole("textbox"), "не забыть письмо");
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, {
        authorNotes: "не забыть письмо",
      }),
    );
  });

  it("пустое поле сохраняется как null", async () => {
    render(<AuthorNotesPanel bookId={3} initialNotes="x" delayMs={10} />);
    await userEvent.clear(screen.getByRole("textbox"));
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, { authorNotes: null }),
    );
  });
});
```

- [ ] **Step 6: Запустить — падает (модуля нет)**

```bash
pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/AuthorNotesPanel.test.tsx
```

- [ ] **Step 7: Панель**

`apps/web/src/components/chapter/AuthorNotesPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useDebouncedSave } from "@/lib/useDebouncedSave";

interface Props {
  bookId: number;
  initialNotes: string | null;
  /** Пауза автосохранения; тесты ставят маленькую. */
  delayMs?: number;
}

/** Сырые заметки автора — единственное поле книги, которое в запросы к
 *  модели не уходит никогда (инвариант закреплён тестом на маячок). Сюда
 *  кладут поэпизодный план, ссылки, «не забыть»: держать можно сколько
 *  угодно, объём запросов от этого не растёт. */
export function AuthorNotesPanel({ bookId, initialNotes, delayMs = 1000 }: Props) {
  const [text, setText] = useState(initialNotes ?? "");
  const { mark, setBaseline, saving, lastSavedAt } = useDebouncedSave<string>(
    async (value) => {
      await api.updateBook(bookId, { authorNotes: value.trim() ? value : null });
    },
    { delayMs },
  );

  useEffect(() => {
    setBaseline(initialNotes ?? "");
    setText(initialNotes ?? "");
  }, [bookId, initialNotes, setBaseline]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        В запросы к модели не уходит. Поэпизодный план, ссылки, «не забыть».
      </p>
      <textarea
        className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-h-[10rem] font-sans"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          mark(e.target.value);
        }}
        aria-label="Заметки автора"
      />
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {saving ? "Сохраняется…" : lastSavedAt ? "Сохранено" : ""}
      </div>
    </div>
  );
}
```

Если `setBaseline` в `useDebouncedSave` не стабилен по ссылке (не обёрнут в `useCallback`), убрать его из зависимостей эффекта и оставить `[bookId, initialNotes]` с комментарием — иначе эффект зациклится.

- [ ] **Step 8: В правую колонку главы**

`apps/web/src/pages/ChapterPage.tsx`: импорт `import { AuthorNotesPanel } from "@/components/chapter/AuthorNotesPanel";`. В `<aside className="cri-rail …">`, после блока `<PanelBoundary title="Состояние сцены">…</PanelBoundary>`:

```tsx
            <PanelBoundary title="Заметки автора">
              <AuthorNotesPanel
                bookId={Number(bookId)}
                initialNotes={book?.authorNotes ?? null}
              />
            </PanelBoundary>
```

- [ ] **Step 9: Прогон**

```bash
pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/AuthorNotesPanel.test.tsx
pnpm typecheck
```

- [ ] **Step 10: Коммит**

```bash
git add apps/server/src/routes/books.ts apps/server/src/routes/__tests__/litrab-borrowings.test.ts apps/web/src/components/chapter/AuthorNotesPanel.tsx apps/web/src/components/chapter/__tests__/AuthorNotesPanel.test.tsx apps/web/src/pages/ChapterPage.tsx
git commit -m "feat: заметки автора — поле книги, которое не уходит в запросы к модели

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: «Глазок» — герой вне запросов

**Files:**
- Modify: `packages/agents/src/character.ts` — интерфейс `CharacterRow`, SQL скана в `gatherCharacterContext`
- Modify: `apps/server/src/routes/entities.ts` — `PATCH /characters/:id/prompt-visibility`
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/components/KnowledgePanel.tsx`
- Test: `apps/server/src/routes/__tests__/litrab-borrowings.test.ts` (дополнить)

**Interfaces:**
- Consumes: `promptVisibilityInputSchema`, `Character.hiddenFromPrompts` (Task 1); `gatherCharacterContext(sqlite, bookId, texts, alwaysIncludeIds, readers)` из `@book-forge/agents`.
- Produces: `PATCH /api/characters/:id/prompt-visibility { hidden: boolean } → Character`; `api.setCharacterPromptVisibility(id, hidden): Promise<Character>`.

- [ ] **Step 1: Серверный тест**

В `litrab-borrowings.test.ts` (добавить импорт `gatherCharacterContext` из `@book-forge/agents`):

```ts
describe("глазок героя", () => {
  async function twoCharacters(): Promise<{ bookId: number; nina: number; vort: number }> {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    const nina = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/characters`, "POST", {
      canonicalName: "Нина",
      profile: { description: "инженер" },
    });
    const vort = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/characters`, "POST", {
      canonicalName: "Ворт",
      profile: { description: "механик" },
    });
    return { bookId: b.id, nina: nina.id, vort: vort.id };
  }

  it("переключается без роста ревизии и отдаётся в карточке", async () => {
    const { vort } = await twoCharacters();
    const hidden = await sendJson<{ hiddenFromPrompts: boolean; revision: number }>(
      t.app,
      `/api/characters/${vort}/prompt-visibility`,
      "PATCH",
      { hidden: true },
    );
    expect(hidden.hiddenFromPrompts).toBe(true);
    expect(hidden.revision).toBe(0);
    const res = await send(t.app, `/api/characters/${vort}/prompt-visibility`, "PATCH", {
      hidden: "да",
    });
    expect(res.status).toBe(400);
    expect((await send(t.app, `/api/characters/99999/prompt-visibility`, "PATCH", { hidden: true })).status).toBe(404);
  });

  it("скрытый герой не сканируется, но POV из плана берётся всегда", async () => {
    const { bookId, vort } = await twoCharacters();
    await send(t.app, `/api/characters/${vort}/prompt-visibility`, "PATCH", { hidden: true });
    const scanned = gatherCharacterContext(t.sqlite, bookId, ["Нина и Ворт спорят у мотора"], [], null);
    expect(scanned.characters.map((c) => c.character.canonicalName)).toEqual(["Нина"]);
    const withPov = gatherCharacterContext(t.sqlite, bookId, ["Нина и Ворт спорят"], [vort], null);
    expect(withPov.characters.map((c) => c.character.canonicalName).sort()).toEqual(["Ворт", "Нина"]);
  });
});
```

- [ ] **Step 2: Запустить — падает (404 на маршруте, скан видит обоих)**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
```

- [ ] **Step 3: Фильтр в агенте**

`packages/agents/src/character.ts`: в локальный `interface CharacterRow` добавить `hidden_from_prompts: number;`. В `gatherCharacterContext` заменить

```ts
  const allCharacters = sqlite
    .prepare("SELECT * FROM characters WHERE book_id = ?")
    .all(bookId) as CharacterRow[];
```

на

```ts
  // «Глазок» (заимствование из litrab.ai): герой, снятый автором с запросов,
  // в скан участников не попадает. Это ЕДИНСТВЕННОЕ место фильтра — все роли
  // (Писатель, критики, правка, inline, замысел сцены) идут через эту функцию.
  // `alwaysIncludeIds` фильтр обходит: POV назван в плане автором явно.
  const allCharacters = sqlite
    .prepare("SELECT * FROM characters WHERE book_id = ? AND hidden_from_prompts = 0")
    .all(bookId) as CharacterRow[];
```

Проверка `allCharacters.length === 0` ниже должна учитывать `alwaysIncludeIds`: заменить

```ts
  if (allCharacters.length === 0) {
```

на

```ts
  if (allCharacters.length === 0 && alwaysIncludeIds.length === 0) {
```

- [ ] **Step 4: Маршрут**

`apps/server/src/routes/entities.ts`: в импорт из `@book-forge/shared` добавить `promptVisibilityInputSchema`. После обработчика `r.patch("/characters/:id", …)` и перед `r.delete("/characters/:id", …)`:

```ts
  // «Глазок»: не правка профиля — ревизия не растёт, истории нет.
  r.patch("/characters/:id/prompt-visibility", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = promptVisibilityInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM characters WHERE id = ?")
      .get(id) as CharacterRow | undefined;
    if (!existing) return notFound(c, "character");
    sqlite
      .prepare("UPDATE characters SET hidden_from_prompts = ?, updated_at = ? WHERE id = ?")
      .run(parsed.data.hidden ? 1 : 0, new Date().toISOString(), id);
    bumpBook(sqlite, existing.book_id);
    const row = sqlite.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow;
    return c.json(toCharacter(row));
  });
```

- [ ] **Step 5: Прогон серверных тестов**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
pnpm --filter @book-forge/agents test
```

Ожидаемо: PASS. Если тесты `packages/agents` сеют строки `characters` без `hidden_from_prompts` — они идут через миграции и получат DEFAULT 0; правок не нужно.

- [ ] **Step 6: Клиент и кнопка**

`apps/web/src/api/client.ts`, в `api` после `updateCharacter`:

```ts
  setCharacterPromptVisibility: (id: number, hidden: boolean) =>
    req<Character>(`/api/characters/${id}/prompt-visibility`, {
      method: "PATCH",
      body: JSON.stringify({ hidden }),
    }),
```

`apps/web/src/components/KnowledgePanel.tsx`: импорт иконок `import { Trash2, ChevronDown, Eye, EyeOff } from "lucide-react";`. В `CharactersTab` добавить функцию рядом с `onDelete`:

```tsx
  async function onToggleHidden(c: Character) {
    try {
      const next = await api.setCharacterPromptVisibility(c.id, !c.hiddenFromPrompts);
      setList((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
```

В карточке заменить блок заголовка

```tsx
              <div className="flex justify-between items-center">
                <strong>{c.canonicalName}</strong>
                <DeleteButton … />
              </div>
```

на

```tsx
              <div className="flex justify-between items-center gap-2">
                <strong className={c.hiddenFromPrompts ? "opacity-60" : ""}>{c.canonicalName}</strong>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-[var(--color-muted)]"
                    aria-label={
                      c.hiddenFromPrompts
                        ? `Вернуть «${c.canonicalName}» в запросы к модели`
                        : `Скрыть «${c.canonicalName}» из запросов к модели`
                    }
                    title={c.hiddenFromPrompts ? "Скрыт из запросов к модели" : "Уходит в запросы к модели"}
                    onClick={() => void onToggleHidden(c)}
                  >
                    {c.hiddenFromPrompts ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                  <DeleteButton
                    label={`Удалить персонажа «${c.canonicalName}»`}
                    onClick={() => onDelete(c.id)}
                  />
                </div>
              </div>
              {c.hiddenFromPrompts && (
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Скрыт из запросов к модели — карточка не уходит Писателю и критикам.
                </div>
              )}
```

- [ ] **Step 7: Прогон и коммит**

```bash
pnpm typecheck
pnpm --filter @book-forge/web test
git add packages/agents/src/character.ts apps/server/src/routes/entities.ts apps/server/src/routes/__tests__/litrab-borrowings.test.ts apps/web/src/api/client.ts apps/web/src/components/KnowledgePanel.tsx
git commit -m "feat: глазок на карточке героя — снять с запросов к модели, не трогая профиль

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: «Описать» — одна деталь по каналу восприятия

**Files:**
- Modify: `packages/shared/src/inline.ts`
- Modify: `packages/agents/src/inline.ts`
- Modify: `apps/server/src/routes/inline.ts`
- Modify: `apps/web/src/api/client.ts` (`InlineCommandRequest.sense`), `apps/web/src/components/InlineCommandPanel.tsx`
- Test: `packages/agents/src/__tests__/inline-prompt.test.ts`, `apps/server/src/routes/__tests__/inline.test.ts`

**Interfaces:**
- Produces: `InlineCommand` расширен значением `"describe"`; `senseChannelSchema`, `SenseChannel = "sight"|"sound"|"smell"|"taste"|"touch"|"metaphor"`, `SENSE_CHANNEL_LABELS`; `runInlineCommandInputSchema.sense?: SenseChannel`; `RunInlineInput.sense?: SenseChannel | null`; `describeInstruction(sense): string`.

- [ ] **Step 1: Тесты промпта**

Дописать в `packages/agents/src/__tests__/inline-prompt.test.ts`:

```ts
import { describeInstruction } from "../inline.js";

describe("describe — одна деталь по каналу", () => {
  it("инструкция называет канал и требует одну деталь без переписывания", () => {
    const smell = describeInstruction("smell");
    expect(smell).toMatch(/обоняни|запах/i);
    expect(smell).toMatch(/одн(у|а) детал/i);
    expect(smell).toMatch(/не переписывай|оставь .* как есть/i);
    expect(smell).toMatch(/не добавляй .*событи/i);
  });

  it("метафора — одно бытовое сравнение, без книжной приподнятости", () => {
    const m = describeInstruction("metaphor");
    expect(m).toMatch(/сравнени|метафор/i);
    expect(m).toMatch(/бытов|предметн/i);
    expect(m).toMatch(/не больше одн/i);
  });

  it("в промпте «Описать» нет текста ПОСЛЕ фрагмента", () => {
    const prompt = buildInlineVolatilePrompt({
      ...base,
      command: "describe",
      sense: "sound",
      afterText: "ХВОСТ-КОТОРОГО-НЕ-ДОЛЖНО-БЫТЬ",
    });
    expect(prompt).not.toContain("Текст ПОСЛЕ");
    expect(prompt).not.toContain("ХВОСТ-КОТОРОГО-НЕ-ДОЛЖНО-БЫТЬ");
    expect(prompt).toContain("Выделенный фрагмент:");
    expect(prompt).toContain(describeInstruction("sound"));
  });

  it("describe без канала — ошибка, а не молчаливый канал по умолчанию", () => {
    expect(() =>
      buildInlineVolatilePrompt({ ...base, command: "describe" }),
    ).toThrow(/sense/);
  });
});
```

- [ ] **Step 2: Запустить — падает**

```bash
pnpm --filter @book-forge/agents test -- src/__tests__/inline-prompt.test.ts
```

- [ ] **Step 3: Общие типы**

`packages/shared/src/inline.ts`:

```ts
export const inlineCommandSchema = z.enum([
  "continue",
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
  "describe",
]);
```

В `INLINE_COMMAND_LABELS` добавить `describe: "Описать",`; в `INLINE_COMMANDS_REQUIRING_SELECTION` — `"describe"`. После них:

```ts
/** Канал восприятия для «Описать» (заимствование из litrab.ai): модель
 *  вплетает ОДНУ деталь ровно этого канала, остальное не трогает. */
export const senseChannelSchema = z.enum([
  "sight",
  "sound",
  "smell",
  "taste",
  "touch",
  "metaphor",
]);
export type SenseChannel = z.infer<typeof senseChannelSchema>;

export const SENSE_CHANNEL_LABELS: Record<SenseChannel, string> = {
  sight: "Зрение",
  sound: "Слух",
  smell: "Обоняние",
  taste: "Вкус",
  touch: "Осязание",
  metaphor: "Метафора",
};
```

В `runInlineCommandInputSchema` после `guidance`:

```ts
  /** Только для `describe`; маршрут отвергает `describe` без канала. */
  sense: senseChannelSchema.optional(),
```

- [ ] **Step 4: Агент**

`packages/agents/src/inline.ts`: в импорт из `@book-forge/shared` добавить `SENSE_CHANNEL_LABELS, type SenseChannel`. В `INLINE_COMMAND_INSTRUCTIONS` добавить ключ (нужен для `Record`; реальная инструкция строится функцией):

```ts
  describe: `Команда: описать — вплести одну сенсорную деталь. Канал задаётся отдельно.`,
```

После объекта инструкций:

```ts
const SENSE_HINT: Record<SenseChannel, string> = {
  sight: "зрение — что видно: свет, цвет, движение, одна конкретная вещь в поле зрения",
  sound: "слух — что слышно или, наоборот, какой звук пропал",
  smell: "обоняние — запах, привязанный к месту или человеку",
  taste: "вкус — во рту, на губах, в воздухе",
  touch: "осязание — температура, фактура, вес, давление на кожу",
  metaphor:
    "метафора — одно сравнение или одна метафора, бытовая и предметная, без книжной приподнятости; не больше одного на фрагмент",
};

/** «Описать» — инструмент против сцены-схемы, а не для перегруза: одна
 *  деталь одного канала, фраза автора остаётся как есть. Текст ПОСЛЕ
 *  фрагмента модели не показывается — её дело насытить написанное, а не
 *  продолжить сцену. */
export function describeInstruction(sense: SenseChannel): string {
  return `Команда: описать. Канал: ${SENSE_CHANNEL_LABELS[sense].toLowerCase()} (${SENSE_HINT[sense]}).
Оставь выделенный фрагмент как есть — та же фраза, тот же порядок слов — и вплети в него или сразу за ним ОДНУ деталь этого канала. Одну, не три. Деталь конкретная, привязанная к этому месту и этому герою, не из набора штампов жанра.
Не переписывай остальное. Не добавляй событий, реплик и новых персонажей. Не объясняй ощущение и не называй чувство героя словом.
Длина: исходный фрагмент плюс не больше одного предложения. Верни фрагмент целиком, с вплетённой деталью.`;
}
```

В `RunInlineInput` добавить `sense?: SenseChannel | null;`. В `buildInlineVolatilePrompt` заменить тело на:

```ts
export function buildInlineVolatilePrompt(input: RunInlineInput): string {
  const parts: string[] = [`Текст ДО редактируемого места:\n${input.beforeText}`];
  parts.push(
    input.selectionText
      ? `Выделенный фрагмент:\n${input.selectionText}`
      : "(Selection пустой — режим продолжения)",
  );
  // «Описать» текста ПОСЛЕ не видит намеренно: иначе модель начинает
  // продолжать сцену вместо того, чтобы насытить написанное.
  if (input.command !== "describe") {
    parts.push(`Текст ПОСЛЕ:\n${input.afterText}`);
  }
  if (input.guidance && input.guidance.trim()) {
    parts.push(`Дополнительные указания автора:\n${input.guidance}`);
  }
  if (input.command === "describe") {
    if (!input.sense) throw new Error('command "describe" requires sense');
    parts.push(describeInstruction(input.sense));
  } else {
    parts.push(INLINE_COMMAND_INSTRUCTIONS[input.command]);
  }
  return parts.join("\n\n");
}
```

- [ ] **Step 5: Прогон тестов агента**

```bash
pnpm --filter @book-forge/agents test -- src/__tests__/inline-prompt.test.ts
```

Ожидаемо: PASS.

- [ ] **Step 6: Тесты маршрута**

Дописать в `apps/server/src/routes/__tests__/inline.test.ts` внутри `describe("inline endpoint")`:

```ts
  it("400 when describe without sense", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "describe",
      selectionText: "Старый дом встретил её темнотой.",
      beforeText: "",
      afterText: "",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("describe with sense passes validation", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "describe",
      sense: "smell",
      selectionText: "Старый дом встретил её темнотой.",
      beforeText: "Она толкнула дверь.",
      afterText: "Потом было тихо.",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("event: error");
  });
```

- [ ] **Step 7: Маршрут**

`apps/server/src/routes/inline.ts`: после проверки `INLINE_COMMANDS_REQUIRING_SELECTION` добавить

```ts
    if (parsed.data.command === "describe" && !parsed.data.sense) {
      return badRequest(c, 'command "describe" requires sense');
    }
```

В вызове `runInlineCommand({...})` заменить `afterText: parsed.data.afterText,` на

```ts
          // «Описать» текста ПОСЛЕ не видит — см. describeInstruction.
          afterText: parsed.data.command === "describe" ? "" : parsed.data.afterText,
          sense: parsed.data.sense ?? null,
```

Строка `route: \`inline.${parsed.data.command}\`` уже даёт `inline.describe` в журнале расходов.

- [ ] **Step 8: Прогон**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/inline.test.ts
```

- [ ] **Step 9: Экран**

`apps/web/src/api/client.ts`: в `InlineCommandRequest` добавить `sense?: import("@book-forge/shared").SenseChannel;`.

`apps/web/src/components/InlineCommandPanel.tsx`:
- в импорт из `@book-forge/shared` добавить `SENSE_CHANNEL_LABELS, senseChannelSchema, type SenseChannel`;
- в `ActiveSuggestion` добавить `sense: SenseChannel | null;`;
- состояние `const [senseOpen, setSenseOpen] = useState(false);`;
- сигнатура `async function runCommand(command: InlineCommand, prevGuidance?: string, sense: SenseChannel | null = null)`; в `setActive({...})` добавить `sense,`; в тело запроса `streamInlineCommand` добавить `...(sense ? { sense } : {}),`; в `regenerate()` передавать `active.sense`;
- в разметке после `<div className="flex gap-2 flex-wrap">{COMMANDS.map(...)}</div>` (сам массив `COMMANDS` не трогать — «Описать» отдельной кнопкой):

```tsx
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          size="sm"
          variant={senseOpen ? "default" : "outline"}
          onClick={() => setSenseOpen((v) => !v)}
          disabled={!editor || (active !== null && active.streaming) || !hasSelection}
          aria-expanded={senseOpen}
        >
          Описать
        </Button>
        {senseOpen &&
          senseChannelSchema.options.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="ghost"
              onClick={() => {
                setSenseOpen(false);
                void runCommand("describe", undefined, s);
              }}
              disabled={!editor || (active !== null && active.streaming) || !hasSelection}
            >
              {SENSE_CHANNEL_LABELS[s]}
            </Button>
          ))}
        {senseOpen && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Одна деталь выбранного канала; фраза остаётся вашей.
          </span>
        )}
      </div>
```

- в блоке `Команда: <strong>{INLINE_COMMAND_LABELS[active.command]}</strong>` добавить `{active.sense && <span> · {SENSE_CHANNEL_LABELS[active.sense]}</span>}`.

- [ ] **Step 10: Прогон и коммит**

```bash
pnpm typecheck
pnpm test
git add packages/shared/src/inline.ts packages/agents/src/inline.ts packages/agents/src/__tests__/inline-prompt.test.ts apps/server/src/routes/inline.ts apps/server/src/routes/__tests__/inline.test.ts apps/web/src/api/client.ts apps/web/src/components/InlineCommandPanel.tsx
git commit -m "feat: inline «Описать» — одна деталь по каналу восприятия, без текста после фрагмента

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Что потеряла правка

**Files:**
- Modify: `packages/shared/src/prose-diff.ts` — `findLostMentions`
- Modify: `apps/web/src/api/client.ts` — `RepairStreamHandlers.onDone` несёт `protectedLost`
- Modify: `apps/web/src/components/chapter/ProposalPanel.tsx` — пропсы `baseWordCount`, `protectedLost`, `characterNames`
- Modify: `apps/web/src/components/CritiquePanel.tsx` — хранит `protectedLost`, пробрасывает новые пропсы
- Modify: `apps/web/src/pages/ChapterPage.tsx` — `characterNames`, `baseWordCount`
- Test: `packages/shared/src/prose-diff.test.ts`, `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx`

**Interfaces:**
- Consumes: `ProseChange` (`prose-diff.ts`), `mentionsEntityName` (`entity-names.ts`), `ChapterWithCurrentVersion.currentVersion.wordCount`.
- Produces: `findLostMentions(changes: ProseChange[], candidateText: string, names: string[]): string[]`; пропсы `ProposalPanel`: `baseWordCount?: number | null`, `protectedLost?: string[]`, `characterNames?: string[]`; пропсы `CritiquePanel`: `baseWordCount?: number | null`, `characterNames?: string[]`.

- [ ] **Step 1: Тест shared**

Дописать в `packages/shared/src/prose-diff.test.ts`:

```ts
import { findLostMentions } from "./prose-diff.js";

describe("findLostMentions", () => {
  const names = ["Нина", "Ворт", "Агата"];
  it("называет героев из убранных абзацев, которых в кандидате больше нет", () => {
    const changes = [
      { id: "c0", kind: "replace" as const, baseFrom: 0, baseTo: 1, baseText: ["Ворт молчал, глядя на Нину."], candidateText: ["Он молчал."] },
      { id: "c1", kind: "delete" as const, baseFrom: 3, baseTo: 4, baseText: ["Агата ушла."], candidateText: [] },
    ];
    const lost = findLostMentions(changes, "Он молчал.\n\nНина закрыла дверь.", names);
    expect(lost).toEqual(["Ворт", "Агата"]);
  });
  it("вставки не считаются потерями, падежи учитываются", () => {
    const changes = [
      { id: "c0", kind: "insert" as const, baseFrom: 0, baseTo: 0, baseText: [], candidateText: ["Нина вошла."] },
      { id: "c1", kind: "replace" as const, baseFrom: 1, baseTo: 2, baseText: ["Он думал о Нине."], candidateText: ["Он думал."] },
    ];
    expect(findLostMentions(changes, "Нина вошла.\n\nОн думал.", names)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить — падает**

```bash
pnpm --filter @book-forge/shared test -- src/prose-diff.test.ts
```

- [ ] **Step 3: Реализация**

В `packages/shared/src/prose-diff.ts` добавить импорт `import { mentionsEntityName } from "./entity-names.js";` и в конец файла:

```ts
/** Имена героев, встречавшиеся в убранных или заменённых абзацах базы и не
 *  встречающиеся в кандидате вовсе. Правка «убирает частное ради общего»
 *  (наблюдение авторов, цитируемых Литрабом): герой, названный по имени,
 *  становится «он», и глазами это пропускается. Вставки потерей не считаются. */
export function findLostMentions(
  changes: ProseChange[],
  candidateText: string,
  names: string[],
): string[] {
  const removed = changes
    .filter((c) => c.kind !== "insert")
    .flatMap((c) => c.baseText)
    .join("\n");
  if (removed.trim().length === 0) return [];
  return names.filter(
    (n) =>
      n.trim().length > 0 &&
      mentionsEntityName(removed, n) &&
      !mentionsEntityName(candidateText, n),
  );
}
```

```bash
pnpm --filter @book-forge/shared test -- src/prose-diff.test.ts
```

- [ ] **Step 4: Тесты панели**

Дописать в `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx` (функцию `renderPanel` расширить третьим параметром `extra: Partial<React.ComponentProps<typeof ProposalPanel>> = {}` и раскрыть `{...extra}` в `<ProposalPanel …>`):

```tsx
describe("потери после правки", () => {
  it("печатает объём и предупреждает о сокращении правки больше 10%", () => {
    renderPanel({ kind: "repair", wordCount: 80 }, undefined, { baseWordCount: 100 });
    expect(screen.getByText(/Объём: 100 → 80 слов \(−20%\)/)).toBeTruthy();
    expect(screen.getByText(/убрала больше десятой части/)).toBeTruthy();
  });

  it("на черновике главы сокращение не тревожит", () => {
    renderPanel({ kind: "write", wordCount: 80 }, undefined, { baseWordCount: 100 });
    expect(screen.queryByText(/убрала больше десятой части/)).toBeNull();
  });

  it("называет защищённое, которое не дожило, и пропавшие имена", () => {
    renderPanel({ kind: "repair", contentText: "Он молчал." }, undefined, {
      baseWordCount: 3,
      protectedLost: ["Ты ведь всё равно вернёшься"],
      characterNames: ["Нина", "Два"],
    });
    expect(screen.getByText(/Защищённое не дожило/)).toBeTruthy();
    expect(screen.getByText(/Ты ведь всё равно вернёшься/)).toBeTruthy();
    // CHANGES заменяют абзац «Два.» — имя «Два» пропало из кандидата.
    expect(screen.getByText(/исчезли имена: Два/)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Панель**

`apps/web/src/components/chapter/ProposalPanel.tsx`: импорт `findLostMentions` из `@book-forge/shared`. В `Props`:

```ts
  /** Слов в тексте, от которого считался кандидат (текущая версия главы). */
  baseWordCount?: number | null;
  /** Защищённые фрагменты, которых в тексте правки не нашлось (сервер, `done.protectedLost`). */
  protectedLost?: string[];
  /** Имена героев книги — для поиска пропавших упоминаний. */
  characterNames?: string[];
```

Деструктурировать их в параметрах. После `const paragraphs = useMemo(...)`:

```tsx
  const base = baseWordCount ?? 0;
  const volumeDelta =
    base > 0 ? Math.round(((proposal.wordCount - base) / base) * 100) : null;
  // Литраб: «просили убрать повторы, а фрагмент стал на 15% короче — модель
  // убрала что-то ещё». Порог 10%, только для правки: черновик главы объёма
  // базы не обещал.
  const shrunkTooMuch =
    proposal.kind === "repair" && base > 0 && proposal.wordCount < base * 0.9;
  const lostNames = useMemo(
    () =>
      characterNames && characterNames.length > 0
        ? findLostMentions(changes, proposal.contentText, characterNames)
        : [],
    [changes, proposal.contentText, characterNames],
  );
```

В разметке сразу после `<p className="text-sm">Глава не изменена, пока вы не примете этот текст.</p>`:

```tsx
      {volumeDelta !== null && (
        <p className="text-sm">
          Объём: {base} → {proposal.wordCount} слов (
          {volumeDelta >= 0 ? "+" : "−"}
          {Math.abs(volumeDelta)}%)
        </p>
      )}
      {shrunkTooMuch && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Правка убрала больше десятой части текста — проверьте, что пропало.
        </p>
      )}
      {protectedLost && protectedLost.length > 0 && (
        <div className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Защищённое не дожило:
          <ul style={{ marginLeft: 16 }}>
            {protectedLost.map((f) => (
              <li key={f}>«{f}»</li>
            ))}
          </ul>
        </div>
      )}
      {lostNames.length > 0 && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Из правленных абзацев исчезли имена: {lostNames.join(", ")}
        </p>
      )}
```

```bash
pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/ProposalPanel.test.tsx
```

- [ ] **Step 6: Пробросить с сервера до панели**

`apps/web/src/api/client.ts`, `RepairStreamHandlers.onDone` payload — добавить `protectedLost?: string[];` (сервер уже кладёт поле в `done`; обработчик передаёт `data` целиком).

`apps/web/src/components/CritiquePanel.tsx`: в `Props` добавить `baseWordCount?: number | null; characterNames?: string[];`, деструктурировать. Состояние `const [repairProtectedLost, setRepairProtectedLost] = useState<string[]>([]);`. В `onRepair()` в начале сброс `setRepairProtectedLost([]);`, в `onDone` после `setRepairProposal(payload.proposal);` — `setRepairProtectedLost(payload.protectedLost ?? []);`. В `<ProposalPanel proposal={repairProposal} …>` добавить `baseWordCount={baseWordCount ?? null} protectedLost={repairProtectedLost} characterNames={characterNames ?? []}`.

`apps/web/src/pages/ChapterPage.tsx`: состояние `const [characterNames, setCharacterNames] = useState<string[]>([]);`. В эффекте, где `Promise.all([api.listCharacters(bid), api.listLocations(bid), api.listItems(bid)])` — в ветке результата добавить `setCharacterNames(chars.map((c) => c.canonicalName));` (имя переменной с героями взять из этого места). В `<ProposalPanel proposal={proposal} …>` добавить `baseWordCount={chapter?.currentVersion?.wordCount ?? null} characterNames={characterNames}`; в `<CritiquePanel …>` (оба места — рельса и мобильный Sheet) добавить `baseWordCount={chapter.currentVersion?.wordCount ?? null} characterNames={characterNames}`.

- [ ] **Step 7: Прогон и коммит**

```bash
pnpm typecheck
pnpm --filter @book-forge/web test
git add packages/shared/src/prose-diff.ts packages/shared/src/prose-diff.test.ts apps/web/src
git commit -m "feat: отчёт о потерях после правки — объём, защищённое, пропавшие имена

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Паспорт стиля устаревает

**Files:**
- Create: `apps/server/src/utils/style-corpus.ts` — `insertReferenceCorpus`
- Modify: `apps/server/src/routes/style.ts` — загрузка корпуса через хелпер; `GET /books/:id/style-freshness`; `POST /books/:id/style/refresh-from-chapters`
- Modify: `packages/shared/src/style.ts` — `styleFreshnessSchema`
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/chapter/StyleFreshnessNote.tsx`
- Modify: `apps/web/src/pages/ChapterPage.tsx`
- Test: `apps/server/src/routes/__tests__/litrab-borrowings.test.ts` (дополнить), `apps/web/src/components/chapter/__tests__/StyleFreshnessNote.test.tsx`

**Interfaces:**
- Consumes: `parseReference(filename, raw): Promise<ParsedReference { format, text, scenes }>` из `@book-forge/style-engine`; `StyleProfileRow`, `BookRow`; `api.runStyleExtract(profileId, body)` (уже есть).
- Produces: `insertReferenceCorpus(sqlite, profile: { id: number; language: string }, filename: string, parsed: { format: string; text: string; scenes: string[] }): number`; `GET /api/books/:id/style-freshness → StyleFreshness`; `POST /api/books/:id/style/refresh-from-chapters → { corpusId: number; chapters: Array<{ id: number; title: string }> }`; `api.getStyleFreshness(bookId)`, `api.refreshStyleFromChapters(bookId)`.

- [ ] **Step 1: Общий тип**

`packages/shared/src/style.ts`, после `styleProfileSchema`:

```ts
/** Свежесть паспорта стиля относительно рукописи (заимствование из litrab.ai:
 *  портрет, собранный на третьей главе, к двадцатой тянет автора назад). */
export const styleFreshnessSchema = z.object({
  profileId: z.number().int().positive().nullable(),
  profileName: z.string().nullable(),
  kind: styleProfileKindSchema.nullable(),
  lastExtractedAt: z.string().nullable(),
  /** Версий глав книги, созданных после последнего извлечения. */
  versionsSince: z.number().int().nonnegative(),
  /** Сколько разных глав среди них. */
  chaptersSince: z.number().int().nonnegative(),
  /** Порог — три главы; блендам не считается (у них нет своего корпуса). */
  stale: z.boolean(),
});
export type StyleFreshness = z.infer<typeof styleFreshnessSchema>;
```

- [ ] **Step 2: Серверные тесты**

В `litrab-borrowings.test.ts`:

```ts
describe("свежесть паспорта стиля", () => {
  const LONG = "Ключ не поворачивался. Ну конечно. Дверь он менял в апреле, руки бы оторвать. ".repeat(12);

  async function bookWithProfile(): Promise<{ bookId: number; profileId: number }> {
    const p = await sendJson<{ id: number }>(t.app, "/api/style-profiles", "POST", {
      name: "Мой",
      language: "ru",
    });
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    await send(t.app, `/api/books/${b.id}`, "PATCH", { styleProfileId: p.id });
    return { bookId: b.id, profileId: p.id };
  }

  async function chapterWithVersion(bookId: number, title: string): Promise<number> {
    const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title });
    await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: LONG }] }] },
    });
    return ch.id;
  }

  it("без профиля — profileId null и stale false", async () => {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    const f = await sendJson<{ profileId: number | null; stale: boolean }>(
      t.app, `/api/books/${b.id}/style-freshness`, "GET",
    );
    expect(f.profileId).toBeNull();
    expect(f.stale).toBe(false);
  });

  it("три главы после извлечения — stale", async () => {
    const { bookId, profileId } = await bookWithProfile();
    t.sqlite
      .prepare("UPDATE style_profiles SET last_extracted_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", profileId);
    for (const title of ["1", "2"]) await chapterWithVersion(bookId, title);
    let f = await sendJson<{ chaptersSince: number; stale: boolean }>(
      t.app, `/api/books/${bookId}/style-freshness`, "GET",
    );
    expect(f.chaptersSince).toBe(2);
    expect(f.stale).toBe(false);
    await chapterWithVersion(bookId, "3");
    f = await sendJson(t.app, `/api/books/${bookId}/style-freshness`, "GET");
    expect(f.chaptersSince).toBe(3);
    expect(f.stale).toBe(true);
  });

  it("не извлекался ни разу — не stale, сколько бы глав ни было", async () => {
    const { bookId } = await bookWithProfile();
    for (const title of ["1", "2", "3"]) await chapterWithVersion(bookId, title);
    const f = await sendJson<{ stale: boolean; lastExtractedAt: string | null }>(
      t.app, `/api/books/${bookId}/style-freshness`, "GET",
    );
    expect(f.lastExtractedAt).toBeNull();
    expect(f.stale).toBe(false);
  });

  it("добор глав кладёт корпус в профиль книги, старые корпуса не трогает", async () => {
    const { bookId, profileId } = await bookWithProfile();
    for (const title of ["1", "2", "3", "4"]) await chapterWithVersion(bookId, title);
    const before = (t.sqlite.prepare("SELECT COUNT(*) c FROM reference_corpora WHERE profile_id = ?").get(profileId) as { c: number }).c;
    const res = await sendJson<{ corpusId: number; chapters: Array<{ title: string }> }>(
      t.app, `/api/books/${bookId}/style/refresh-from-chapters`, "POST", {},
    );
    expect(res.chapters.map((c) => c.title)).toEqual(["2", "3", "4"]);
    const row = t.sqlite
      .prepare("SELECT profile_id, scene_count FROM reference_corpora WHERE id = ?")
      .get(res.corpusId) as { profile_id: number; scene_count: number };
    expect(row.profile_id).toBe(profileId);
    expect(row.scene_count).toBeGreaterThan(0);
    const after = (t.sqlite.prepare("SELECT COUNT(*) c FROM reference_corpora WHERE profile_id = ?").get(profileId) as { c: number }).c;
    expect(after).toBe(before + 1);
  });

  it("без принятых глав или без профиля — 400", async () => {
    const { bookId } = await bookWithProfile();
    expect((await send(t.app, `/api/books/${bookId}/style/refresh-from-chapters`, "POST", {})).status).toBe(400);
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    expect((await send(t.app, `/api/books/${b.id}/style/refresh-from-chapters`, "POST", {})).status).toBe(400);
  });
});
```

Если `POST /api/chapters/:id/versions` принимает тело другой формы — посмотреть `createVersion` в `apps/web/src/api/client.ts` (там точное тело) и поправить хелпер теста.

- [ ] **Step 3: Запустить — падает (404 на маршрутах)**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
```

- [ ] **Step 4: Хелпер вставки корпуса**

`apps/server/src/utils/style-corpus.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";

export interface ParsedCorpusLike {
  format: string;
  text: string;
  scenes: string[];
}

/** Один способ положить корпус в профиль — им пользуются и загрузка файла,
 *  и добор последних глав книги. Одна транзакция: корпус, сцены, отметка
 *  профиля. Возвращает id корпуса. */
export function insertReferenceCorpus(
  sqlite: DatabaseType,
  profile: { id: number; language: string },
  filename: string,
  parsed: ParsedCorpusLike,
): number {
  const now = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    const info = sqlite
      .prepare(
        `INSERT INTO reference_corpora
         (profile_id, filename, format, language, raw_text, char_count, scene_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        filename,
        parsed.format,
        profile.language,
        parsed.text,
        parsed.text.length,
        parsed.scenes.length,
        now,
      );
    const corpusId = Number(info.lastInsertRowid);
    const insertScene = sqlite.prepare(
      `INSERT INTO reference_scenes (corpus_id, order_index, text, char_count, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < parsed.scenes.length; i++) {
      const scene = parsed.scenes[i]!;
      insertScene.run(corpusId, i, scene, scene.length, now);
    }
    sqlite
      .prepare("UPDATE style_profiles SET updated_at = ? WHERE id = ?")
      .run(now, profile.id);
    return corpusId;
  });
  return tx();
}
```

В `apps/server/src/routes/style.ts`, обработчик `r.post("/style-profiles/:id/corpora", …)`: заменить блок от `const now = new Date().toISOString();` до `const corpusId = tx();` включительно одной строкой

```ts
    const corpusId = insertReferenceCorpus(
      sqlite,
      { id, language: profile.language },
      parsed.data.filename,
      parsedRef,
    );
```

и добавить импорт `import { insertReferenceCorpus } from "../utils/style-corpus.js";`.

- [ ] **Step 5: Маршруты свежести и добора**

В `apps/server/src/routes/style.ts` добавить импорты `import type { BookRow, ChapterRow } from "../db/rows.js";` (если `StyleProfileRow` объявлен в этом файле — оставить как есть) и перед `return r;`:

```ts
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
```

- [ ] **Step 6: Прогон**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/litrab-borrowings.test.ts
pnpm --filter @book-forge/server test -- src/routes/__tests__/style.test.ts
```

(второй файл — если существует; загрузка корпуса через хелпер должна остаться зелёной).

- [ ] **Step 7: Тест заметки на экране**

`apps/web/src/components/chapter/__tests__/StyleFreshnessNote.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StyleFreshnessNote } from "../StyleFreshnessNote";

vi.mock("@/api/client", () => ({
  api: {
    getStyleFreshness: vi.fn(),
    refreshStyleFromChapters: vi.fn(),
    runStyleExtract: vi.fn(),
  },
}));

import { api } from "@/api/client";

const STALE = {
  profileId: 4,
  profileName: "Мой голос",
  kind: "extracted" as const,
  lastExtractedAt: "2026-09-01T00:00:00Z",
  versionsSince: 7,
  chaptersSince: 5,
  stale: true,
};

beforeEach(() => {
  vi.mocked(api.getStyleFreshness).mockReset();
  vi.mocked(api.refreshStyleFromChapters).mockReset();
  vi.mocked(api.runStyleExtract).mockReset();
});

describe("StyleFreshnessNote", () => {
  it("молчит, пока стиль свежий", async () => {
    vi.mocked(api.getStyleFreshness).mockResolvedValue({ ...STALE, chaptersSince: 1, stale: false });
    const { container } = render(<StyleFreshnessNote bookId={1} />);
    await waitFor(() => expect(api.getStyleFreshness).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("устарел — называет число глав и пересобирает в два шага", async () => {
    vi.mocked(api.getStyleFreshness)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce({ ...STALE, chaptersSince: 0, stale: false });
    vi.mocked(api.refreshStyleFromChapters).mockResolvedValue({ corpusId: 9, chapters: [] });
    vi.mocked(api.runStyleExtract).mockResolvedValue({} as never);
    render(<StyleFreshnessNote bookId={1} />);
    expect(await screen.findByText(/собран до 5 принятых глав/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /пересобрать/i }));
    await waitFor(() => expect(api.refreshStyleFromChapters).toHaveBeenCalledWith(1));
    await waitFor(() => expect(api.runStyleExtract).toHaveBeenCalledWith(4, {}));
    await waitFor(() => expect(screen.queryByText(/собран до/)).toBeNull());
  });
});
```

- [ ] **Step 8: Клиент и компонент**

`apps/web/src/api/client.ts`, в `api` после `createStyleBlend` (тип `StyleFreshness` — в импорт из `@book-forge/shared`):

```ts
  getStyleFreshness: (bookId: number) =>
    req<StyleFreshness>(`/api/books/${bookId}/style-freshness`),
  refreshStyleFromChapters: (bookId: number) =>
    req<{ corpusId: number; chapters: Array<{ id: number; title: string }> }>(
      `/api/books/${bookId}/style/refresh-from-chapters`,
      { method: "POST", body: JSON.stringify({}) },
    ),
```

`apps/web/src/components/chapter/StyleFreshnessNote.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { StyleFreshness } from "@book-forge/shared";

interface Props {
  bookId: number;
}

/** Паспорт стиля отстаёт от рукописи (Литраб: собранный на третьей главе
 *  портрет к двадцатой тянет автора назад). Рисуется только когда после
 *  извлечения принято три и больше глав; «Пересобрать» — два шага: добор
 *  последних глав в корпус, затем прежнее извлечение. */
export function StyleFreshnessNote({ bookId }: Props) {
  const [fresh, setFresh] = useState<StyleFreshness | null>(null);
  const [phase, setPhase] = useState<"idle" | "corpus" | "extract">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFresh(await api.getStyleFreshness(bookId));
    } catch {
      setFresh(null);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rebuild(): Promise<void> {
    if (!fresh || fresh.profileId === null) return;
    setError(null);
    try {
      setPhase("corpus");
      await api.refreshStyleFromChapters(bookId);
      setPhase("extract");
      await api.runStyleExtract(fresh.profileId, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  }

  if (!fresh || !fresh.stale) return null;

  return (
    <div className="text-sm flex flex-col gap-2">
      <p>
        Стиль «{fresh.profileName}» собран до {fresh.chaptersSince} принятых глав. Голос книги
        мог уйти вперёд.
      </p>
      <Button size="sm" variant="outline" onClick={() => void rebuild()} disabled={phase !== "idle"}>
        {phase === "corpus"
          ? "Добавляю последние главы…"
          : phase === "extract"
            ? "Пересобираю паспорт…"
            : "Пересобрать по последним главам"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

Если `api.runStyleExtract` требует второй аргумент другой формы — посмотреть его сигнатуру в `client.ts` и передать пустой объект той формы.

`apps/web/src/pages/ChapterPage.tsx`: импорт и в правой колонке после «Заметки автора»:

```tsx
            <PanelBoundary title="Стиль">
              <StyleFreshnessNote bookId={Number(bookId)} />
            </PanelBoundary>
```

- [ ] **Step 9: Прогон и коммит**

```bash
pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/StyleFreshnessNote.test.tsx
pnpm typecheck
git add packages/shared/src/style.ts apps/server/src/utils/style-corpus.ts apps/server/src/routes/style.ts apps/server/src/routes/__tests__/litrab-borrowings.test.ts apps/web/src
git commit -m "feat: свежесть паспорта стиля и добор последних глав в корпус

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Чат по книге

**Files:**
- Create: `packages/shared/src/chat.ts`; Modify: `packages/shared/src/index.ts`
- Modify: `packages/llm/src/types.ts` (`AGENT_NAMES`), `packages/llm/src/router.ts` (`DEFAULT_AGENT_BACKEND`)
- Create: `packages/agents/src/chat.ts`; Modify: `packages/agents/src/index.ts`
- Create: `apps/server/src/routes/chat.ts`; Modify: `apps/server/src/app.ts`
- Modify: `apps/web/src/api/client.ts`; Create: `apps/web/src/components/chapter/ChatPanel.tsx`; Modify: `apps/web/src/pages/ChapterPage.tsx`
- Test: `packages/agents/src/__tests__/chat-prompt.test.ts`, `apps/server/src/routes/__tests__/chat.test.ts`, `apps/web/src/components/chapter/__tests__/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `assembleGenerationContext` (`AssembleContextArgs`, `AssembledContext`), `requiredOverflowMessage`, `streamText` из `@book-forge/llm` (`StreamCallOptions`, результат `{ text, modelId, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, stopReason }`), `logUsage`, `extractText` (`utils/prosemirror.ts`).
- Produces: схемы `chatThreadSchema`, `chatMessageSchema`, `createChatThreadInputSchema`, `sendChatMessageInputSchema`; агент `runBookChat(input: BookChatInput): AsyncGenerator<string, { text; modelId; tokens }, void>`; маршруты `GET/POST /api/chapters/:id/chat/threads`, `DELETE /api/chat/threads/:id`, `GET /api/chat/threads/:id/messages`, `POST /api/chat/threads/:id/messages` (SSE `chunk`/`done`/`error`/`ping`); клиент `listChatThreads`, `createChatThread`, `deleteChatThread`, `listChatMessages`, `streamChatMessage`.

- [ ] **Step 1: Общие схемы**

`packages/shared/src/chat.ts`:

```ts
import { z } from "zod";

export const chatThreadSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

export const chatMessageSchema = z.object({
  id: z.number().int().positive(),
  threadId: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const createChatThreadInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

/** Потолок одного сообщения — как у Литраба, 10 000 знаков. */
export const sendChatMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;

/** Сколько прежних сообщений треда едет в запрос. */
export const CHAT_HISTORY_LIMIT = 20;
/** Потолок текста открытой главы в запросе, в символах. */
export const CHAT_CHAPTER_TEXT_LIMIT = 40_000;
/** Название треда — первые символы первого сообщения. */
export const CHAT_TITLE_CHARS = 60;
```

В `packages/shared/src/index.ts` добавить `export * from "./chat.js";`.

- [ ] **Step 2: Имя агента и бэкенд**

`packages/llm/src/types.ts`: в `AGENT_NAMES` после `"scene_state_extractor",` — `"book_chat",`. `packages/llm/src/router.ts`: в `DEFAULT_AGENT_BACKEND` — `book_chat: "subscription",`.

```bash
pnpm --filter @book-forge/llm test
```

(тест паритета структурных контрактов не трогает текстовые агенты).

- [ ] **Step 3: Тест промпта агента**

`packages/agents/src/__tests__/chat-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildChatStableSystem,
  buildChatVolatilePrompt,
  type BookChatInput,
} from "../chat.js";

const base: BookChatInput = {
  bookTitle: "Северная",
  chapterTitle: "Глава 4",
  chapterText: "Нина закрыла дверь.",
  chapterTextTruncated: false,
  contextBlocks: ["## Персонажи в сцене\n### Нина", "## Стиль\nкоротко"],
  history: [
    { role: "user", content: "Почему Нина молчит?" },
    { role: "assistant", content: "Она не доверяет Ворту." },
  ],
  message: "А что она сделает дальше?",
  model: "sonnet",
};

describe("book_chat prompt", () => {
  it("стабильная часть несёт правила, материалы книги и текст главы", () => {
    const s = buildChatStableSystem(base);
    expect(s).toContain("## Персонажи в сцене");
    expect(s).toContain("Нина закрыла дверь.");
    expect(s).toMatch(/в материалах книги этого нет/i);
    expect(s).toMatch(/не (меняешь|правишь) .*глав/i);
    expect(s).not.toContain("А что она сделает дальше?");
  });

  it("переменная часть — история по порядку и новый вопрос последним", () => {
    const v = buildChatVolatilePrompt(base);
    const i1 = v.indexOf("Почему Нина молчит?");
    const i2 = v.indexOf("Она не доверяет Ворту.");
    const i3 = v.indexOf("А что она сделает дальше?");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it("обрезанная глава помечается словами", () => {
    const s = buildChatStableSystem({ ...base, chapterTextTruncated: true });
    expect(s).toMatch(/обрезан/i);
  });
});
```

- [ ] **Step 4: Агент**

`packages/agents/src/chat.ts`:

```ts
import { streamText, type SystemBlock, type ModelChoice } from "@book-forge/llm";

export interface BookChatInput {
  bookTitle: string;
  chapterTitle: string;
  /** Текст открытой главы — черновик, если он есть, иначе принятая версия. */
  chapterText: string;
  chapterTextTruncated: boolean;
  /** Готовые блоки сборки контекста: карточки, факты, история, стиль… */
  contextBlocks: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  model: ModelChoice;
  signal?: AbortSignal;
}

const CHAT_SYSTEM = `Ты — собеседник автора по его книге. Ты видишь материалы книги и текст открытой главы; автор обсуждает с тобой сюжет, героев и текст.

Три роли, по запросу автора:
— советчик: разобрать развилку сюжета, мотивацию героя, уточнить деталь мира;
— соавтор: набросать план сцены или сцену по инструкции автора — в стиле книги;
— редактор: найти повторы, провисание темпа, места, где герои заговорили одним голосом; каждое замечание — с цитатой из главы.

Правила:
— Опирайся только на материалы книги и текст главы. Если сведений нет, скажи прямо: «в материалах книги этого нет», и не выдумывай.
— Разбирая текст, цитируй его дословно и коротко.
— Ты не меняешь главу сам: всё, что предлагаешь, автор вставит руками. Не пиши «я заменил» или «исправлено».
— Отвечай по-русски, коротко и по делу; списки — только когда пунктов правда несколько.
— Прозу пиши только когда просят, и в голосе книги, а не усреднённым.`;

/** Стабильная половина — правила, материалы, текст главы — одинакова для
 *  всех сообщений треда, пока глава не менялась: сидит в кэш-префиксе. */
export function buildChatStableSystem(input: BookChatInput): string {
  const parts = [`Книга: «${input.bookTitle}». Открытая глава: «${input.chapterTitle}».`];
  parts.push(...input.contextBlocks.filter((b) => b.trim().length > 0));
  parts.push(
    `## Текст открытой главы${input.chapterTextTruncated ? " (обрезан по объёму; конец главы не показан)" : ""}\n${input.chapterText || "(глава пуста)"}`,
  );
  return `${CHAT_SYSTEM}\n\n---\n\n${parts.join("\n\n")}`;
}

export function buildChatVolatilePrompt(input: BookChatInput): string {
  const lines: string[] = [];
  if (input.history.length > 0) {
    lines.push("Разговор до этого места:");
    for (const m of input.history) {
      lines.push(`${m.role === "user" ? "Автор" : "Ты"}: ${m.content}`);
    }
    lines.push("");
  }
  lines.push(`Автор: ${input.message}`);
  lines.push("Ты:");
  return lines.join("\n");
}

export async function* runBookChat(input: BookChatInput): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  },
  void
> {
  const system: SystemBlock[] = [
    { type: "text", text: buildChatStableSystem(input), cache_control: { type: "ephemeral" } },
  ];
  const gen = streamText({
    agentName: "book_chat",
    model: input.model,
    system,
    prompt: buildChatVolatilePrompt(input),
    maxTokens: 4000,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  let result;
  while (true) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    yield next.value;
  }
  return {
    text: result.text,
    modelId: result.modelId,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}
```

Если `ModelChoice` не экспортируется из `@book-forge/llm`, взять его из `@book-forge/shared` (там `modelChoiceSchema`). В `packages/agents/src/index.ts` добавить `export * from "./chat.js";`.

```bash
pnpm --filter @book-forge/agents test -- src/__tests__/chat-prompt.test.ts
```

- [ ] **Step 5: Тест маршрутов**

`apps/server/src/routes/__tests__/chat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runBookChat: vi.fn(),
}));

import { runBookChat } from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runBookChatMock = vi.mocked(runBookChat);
let t: TestApp;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  runBookChatMock.mockReset();
  runBookChatMock.mockImplementation(async function* () {
    yield "Она ";
    yield "уйдёт.";
    return {
      text: "Она уйдёт.",
      modelId: "test-model",
      tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
    };
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", { title: "Глава" });
  chapterId = ch.id;
});
afterEach(() => t.cleanup());

describe("чат по книге", () => {
  it("тред создаётся, перечисляется и удаляется", async () => {
    const th = await sendJson<{ id: number; chapterId: number; title: string | null }>(
      t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {},
    );
    expect(th.chapterId).toBe(chapterId);
    expect(th.title).toBeNull();
    const list = await sendJson<Array<{ id: number }>>(t.app, `/api/chapters/${chapterId}/chat/threads`, "GET");
    expect(list.map((x) => x.id)).toEqual([th.id]);
    expect((await send(t.app, `/api/chat/threads/${th.id}`, "DELETE")).status).toBe(204);
    expect((await send(t.app, `/api/chat/threads/${th.id}/messages`, "GET")).status).toBe(404);
    expect((await send(t.app, `/api/chapters/99999/chat/threads`, "POST", {})).status).toBe(404);
  });

  it("сообщение стримится, обе реплики ложатся в тред, тред получает название", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    const res = await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", {
      content: "Что Нина сделает дальше?",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: chunk");
    expect(body).toContain("event: done");
    const msgs = await sendJson<Array<{ role: string; content: string }>>(
      t.app, `/api/chat/threads/${th.id}/messages`, "GET",
    );
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1]?.content).toBe("Она уйдёт.");
    const [thread] = await sendJson<Array<{ title: string | null }>>(
      t.app, `/api/chapters/${chapterId}/chat/threads`, "GET",
    );
    expect(thread?.title).toBe("Что Нина сделает дальше?");
    const call = runBookChatMock.mock.calls[0]?.[0];
    expect(call?.message).toBe("Что Нина сделает дальше?");
    expect(call?.history).toEqual([]);
  });

  it("история едет в следующий запрос", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Раз" });
    await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Два" });
    const second = runBookChatMock.mock.calls[1]?.[0];
    expect(second?.history.map((m) => m.content)).toEqual(["Раз", "Она уйдёт."]);
  });

  it("пустое сообщение — 400; сбой модели — event: error, ответ не сохраняется", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    expect((await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "   " })).status).toBe(400);
    runBookChatMock.mockImplementation(async function* () {
      yield "";
      throw new Error("backend down");
    });
    const res = await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Вопрос" });
    expect(await res.text()).toContain("event: error");
    const msgs = await sendJson<Array<{ role: string }>>(t.app, `/api/chat/threads/${th.id}/messages`, "GET");
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
  });
});
```

- [ ] **Step 6: Маршрут**

`apps/server/src/routes/chat.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createChatThreadInputSchema,
  sendChatMessageInputSchema,
  CHAT_HISTORY_LIMIT,
  CHAT_CHAPTER_TEXT_LIMIT,
  CHAT_TITLE_CHARS,
  type ChatMessage,
  type ChatThread,
} from "@book-forge/shared";
import { runBookChat } from "@book-forge/agents";
import type { BookRow, ChapterRow, ChapterVersionRow } from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { assembleGenerationContext } from "../utils/generation-context.js";
import { requiredOverflowMessage } from "../utils/context-compiler.js";
import { logUsage } from "../utils/usageLogger.js";

interface ThreadRow {
  id: number;
  book_id: number;
  chapter_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}
interface MessageRow {
  id: number;
  thread_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const toThread = (r: ThreadRow): ChatThread => ({
  id: r.id,
  bookId: r.book_id,
  chapterId: r.chapter_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  threadId: r.thread_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
});

/** Текст открытой главы для чата: черновик новее версии, если он есть. */
function openChapterText(
  sqlite: DatabaseType,
  ch: ChapterRow,
): { text: string; truncated: boolean } {
  const draft = sqlite
    .prepare("SELECT content_text FROM chapter_drafts WHERE chapter_id = ?")
    .get(ch.id) as { content_text: string } | undefined;
  let text = draft?.content_text ?? "";
  if (!text && ch.current_version_id !== null) {
    const v = sqlite
      .prepare("SELECT content_text FROM chapter_versions WHERE id = ?")
      .get(ch.current_version_id) as Pick<ChapterVersionRow, "content_text"> | undefined;
    text = v?.content_text ?? "";
  }
  if (text.length > CHAT_CHAPTER_TEXT_LIMIT) {
    return { text: text.slice(0, CHAT_CHAPTER_TEXT_LIMIT), truncated: true };
  }
  return { text, truncated: false };
}

export function createChatRoute(sqlite: DatabaseType, hasVec: boolean): Hono {
  const r = new Hono();

  const loadThread = (id: number): ThreadRow | undefined =>
    sqlite.prepare("SELECT * FROM chat_threads WHERE id = ?").get(id) as ThreadRow | undefined;

  r.get("/chapters/:id/chat/threads", (c) => {
    const chapterId = Number(c.req.param("id"));
    const ch = sqlite.prepare("SELECT id FROM chapters WHERE id = ?").get(chapterId);
    if (!ch) return notFound(c, "chapter");
    const rows = sqlite
      .prepare("SELECT * FROM chat_threads WHERE chapter_id = ? ORDER BY updated_at DESC, id DESC")
      .all(chapterId) as ThreadRow[];
    return c.json(rows.map(toThread));
  });

  r.post("/chapters/:id/chat/threads", async (c) => {
    const chapterId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = createChatThreadInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ch = sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        "INSERT INTO chat_threads (book_id, chapter_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(ch.book_id, ch.id, parsed.data.title ?? null, now, now);
    return c.json(toThread(loadThread(Number(info.lastInsertRowid))!), 201);
  });

  r.delete("/chat/threads/:id", (c) => {
    const id = Number(c.req.param("id"));
    const res = sqlite.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
    if (res.changes === 0) return notFound(c, "chat_thread");
    return c.body(null, 204);
  });

  r.get("/chat/threads/:id/messages", (c) => {
    const id = Number(c.req.param("id"));
    if (!loadThread(id)) return notFound(c, "chat_thread");
    const rows = sqlite
      .prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id ASC")
      .all(id) as MessageRow[];
    return c.json(rows.map(toMessage));
  });

  r.post("/chat/threads/:id/messages", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = sendChatMessageInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const thread = loadThread(id);
    if (!thread) return notFound(c, "chat_thread");
    const ch = sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(thread.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite.prepare("SELECT * FROM books WHERE id = ?").get(thread.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    const content = parsed.data.content;
    const chapter = openChapterText(sqlite, ch);

    // Та же сборка, что у Писателя и критиков: второй сборки контекста быть
    // не должно. Чат сканирует текст главы и вопрос; стилевых образцов ноль
    // (это разговор, не проза); план автора виден — автор говорит сам с собой.
    const assembled = await assembleGenerationContext(sqlite, {
      book,
      chapter: ch,
      hasVec,
      scanTexts: [chapter.text, content],
      retrievalQuery: content,
      notesQuery: content,
      povName: null,
      styleFewShot: 0,
      factsBoundary: "at_chapter",
      includeAuthorPlan: true,
      label: `chat ch#${ch.order_index}`,
    });
    if (assembled.compiled.requiredOverflow) {
      return badRequest(c, requiredOverflowMessage(assembled.compiled));
    }

    const history = (
      sqlite
        .prepare(
          `SELECT * FROM (SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?)
           ORDER BY id ASC`,
        )
        .all(id, CHAT_HISTORY_LIMIT) as MessageRow[]
    ).map((m) => ({ role: m.role, content: m.content }));

    const now = new Date().toISOString();
    sqlite
      .prepare("INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
      .run(id, content, now);
    if (thread.title === null) {
      sqlite
        .prepare("UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?")
        .run(content.slice(0, CHAT_TITLE_CHARS), now, id);
    } else {
      sqlite.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, id);
    }

    const contextBlocks = [
      assembled.bookContextBase,
      assembled.studioContext,
      assembled.previousChapters,
      assembled.sceneState,
      assembled.characterContext,
      assembled.loreContext,
      assembled.retrieval,
      assembled.notesPrompt,
    ].filter((b): b is string => typeof b === "string" && b.length > 0);

    return streamSSE(c, async (stream) => {
      let pending: Promise<void> = Promise.resolve();
      const keepalive = setInterval(() => {
        pending = pending
          .then(() => stream.writeSSE({ event: "ping", data: JSON.stringify({ at: Date.now() }) }))
          .catch(() => {});
      }, 20_000);
      try {
        const gen = runBookChat({
          bookTitle: book.title,
          chapterTitle: ch.title,
          chapterText: chapter.text,
          chapterTextTruncated: chapter.truncated,
          contextBlocks,
          history,
          message: content,
          model: book.plot_model as "sonnet" | "opus",
        });
        let full = "";
        let modelId = "";
        let tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        while (true) {
          const next = await gen.next();
          if (next.done) {
            full = next.value.text;
            modelId = next.value.modelId;
            tokens = next.value.tokens;
            break;
          }
          await stream.writeSSE({ event: "chunk", data: JSON.stringify({ text: next.value }) });
        }
        const doneAt = new Date().toISOString();
        const info = sqlite
          .prepare("INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)")
          .run(id, full, doneAt);
        sqlite.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(doneAt, id);
        logUsage(sqlite, {
          route: "chat.message",
          model: modelId,
          usage: {
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            cacheCreationInputTokens: tokens.cacheCreation,
            cacheReadInputTokens: tokens.cacheRead,
          },
          bookId: book.id,
          chapterId: ch.id,
        });
        const saved = sqlite
          .prepare("SELECT * FROM chat_messages WHERE id = ?")
          .get(Number(info.lastInsertRowid)) as MessageRow;
        await stream.writeSSE({ event: "done", data: JSON.stringify({ message: toMessage(saved) }) });
      } catch (e) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: e instanceof Error ? e.message : String(e) }),
        });
      } finally {
        clearInterval(keepalive);
        await pending.catch(() => {});
      }
    });
  });

  return r;
}
```

`apps/server/src/app.ts`: `import { createChatRoute } from "./routes/chat.js";` и рядом с остальными — `app.route("/api", createChatRoute(sqlite, hasVec));`.

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/chat.test.ts
```

- [ ] **Step 7: Клиент**

`apps/web/src/api/client.ts` (типы `ChatThread`, `ChatMessage` — в импорт из `@book-forge/shared`), в `api`:

```ts
  listChatThreads: (chapterId: number) =>
    req<ChatThread[]>(`/api/chapters/${chapterId}/chat/threads`),
  createChatThread: (chapterId: number, title?: string) =>
    req<ChatThread>(`/api/chapters/${chapterId}/chat/threads`, {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    }),
  deleteChatThread: (threadId: number) =>
    req<void>(`/api/chat/threads/${threadId}`, { method: "DELETE" }),
  listChatMessages: (threadId: number) =>
    req<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`),
```

И отдельной функцией после `streamInlineCommand`:

```ts
// ── SSE chat ──
export interface ChatStreamHandlers {
  onChunk: (text: string) => void;
  onDone: (payload: { message: ChatMessage }) => void;
  onError: (message: string) => void;
}

export async function streamChatMessage(
  threadId: number,
  content: string,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${errorSummary(text)}`);
    return;
  }
  const { sawTerminal } = await consumeSse(
    res.body,
    ({ event, data }) => {
      if (event === "chunk") handlers.onChunk((data as { text: string }).text);
      else if (event === "done") handlers.onDone(data as { message: ChatMessage });
      else if (event === "error") handlers.onError((data as { message: string }).message);
    },
    { terminalEvents: ["done", "error"] },
  );
  if (!sawTerminal) handlers.onError(SSE_BROKEN_MESSAGE);
}
```

- [ ] **Step 8: Тест панели**

`apps/web/src/components/chapter/__tests__/ChatPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../ChatPanel";

vi.mock("@/api/client", () => ({
  api: {
    listChatThreads: vi.fn(),
    createChatThread: vi.fn(),
    deleteChatThread: vi.fn(),
    listChatMessages: vi.fn(),
  },
  streamChatMessage: vi.fn(),
}));

import { api, streamChatMessage } from "@/api/client";

const THREAD = { id: 1, bookId: 1, chapterId: 2, title: "Про Нину", createdAt: "x", updatedAt: "x" };

beforeEach(() => {
  vi.mocked(api.listChatThreads).mockReset();
  vi.mocked(api.createChatThread).mockReset();
  vi.mocked(api.listChatMessages).mockReset();
  vi.mocked(streamChatMessage).mockReset();
});

describe("ChatPanel", () => {
  it("без тредов предлагает начать разговор, создаёт тред при первой отправке", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([]);
    vi.mocked(api.createChatThread).mockResolvedValue(THREAD);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);
    vi.mocked(streamChatMessage).mockImplementation(async (_id, _content, h) => {
      h.onChunk("Она ");
      h.onChunk("уйдёт.");
      h.onDone({ message: { id: 9, threadId: 1, role: "assistant", content: "Она уйдёт.", createdAt: "x" } });
    });
    render(<ChatPanel chapterId={2} />);
    expect(await screen.findByText(/разговоров пока нет/i)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "Что дальше?");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));
    await waitFor(() => expect(api.createChatThread).toHaveBeenCalledWith(2));
    await waitFor(() => expect(streamChatMessage).toHaveBeenCalledWith(1, "Что дальше?", expect.anything()));
    expect(await screen.findByText("Она уйдёт.")).toBeTruthy();
    expect(screen.getByText("Что дальше?")).toBeTruthy();
  });

  it("показывает историю выбранного треда", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.listChatMessages).mockResolvedValue([
      { id: 1, threadId: 1, role: "user", content: "Почему молчит?", createdAt: "x" },
      { id: 2, threadId: 1, role: "assistant", content: "Не доверяет.", createdAt: "x" },
    ]);
    render(<ChatPanel chapterId={2} />);
    expect(await screen.findByText("Почему молчит?")).toBeTruthy();
    expect(screen.getByText("Не доверяет.")).toBeTruthy();
  });

  it("ошибку потока печатает и оставляет вопрос в поле", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);
    vi.mocked(streamChatMessage).mockImplementation(async (_id, _c, h) => h.onError("backend down"));
    render(<ChatPanel chapterId={2} />);
    await screen.findByRole("textbox");
    await userEvent.type(screen.getByRole("textbox"), "Вопрос");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));
    expect(await screen.findByText(/backend down/)).toBeTruthy();
    expect(screen.getByDisplayValue("Вопрос")).toBeTruthy();
  });
});
```

- [ ] **Step 9: Панель**

`apps/web/src/components/chapter/ChatPanel.tsx`:

```tsx
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, streamChatMessage } from "@/api/client";
import type { ChatMessage, ChatThread } from "@book-forge/shared";

interface Props {
  chapterId: number;
}

/** Чат по книге (заимствование из litrab.ai). Видит те же материалы, что
 *  Писатель и критики, и текст открытой главы; в главу не пишет — всё, что
 *  предложит, автор вставляет руками. Треды друг о друге не знают. */
export function ChatPanel({ chapterId }: Props) {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [buffer, setBuffer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadThreads = useCallback(async () => {
    try {
      const list = await api.listChatThreads(chapterId);
      setThreads(list);
      setActiveId((cur) => (cur !== null && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setThreads([]);
    }
  }, [chapterId]);

  useEffect(() => {
    setActiveId(null);
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeId === null) {
      setMessages([]);
      return;
    }
    let dropped = false;
    api
      .listChatMessages(activeId)
      .then((m) => {
        if (!dropped) setMessages(m);
      })
      .catch((e) => {
        if (!dropped) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dropped = true;
    };
  }, [activeId]);

  async function send(): Promise<void> {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      let threadId = activeId;
      if (threadId === null) {
        const created = await api.createChatThread(chapterId);
        threadId = created.id;
        setThreads((prev) => [created, ...(prev ?? [])]);
        setActiveId(created.id);
      }
      const optimistic: ChatMessage = {
        id: -Date.now(),
        threadId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setBuffer("");
      await streamChatMessage(threadId, content, {
        onChunk: (text) => setBuffer((b) => (b ?? "") + text),
        onDone: ({ message }) => {
          setMessages((m) => [...m, message]);
          setBuffer(null);
          setInput("");
          void loadThreads();
        },
        onError: (msg) => {
          setError(msg);
          setBuffer(null);
          // Вопрос остаётся в поле: автор повторит, не набирая заново.
          setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuffer(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeThread(id: number): Promise<void> {
    if (!confirm("Удалить разговор?")) return;
    try {
      await api.deleteChatThread(id);
      if (activeId === id) setActiveId(null);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  }

  if (threads === null) return <p className="text-sm">Загрузка…</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {threads.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Разговоров пока нет — задайте вопрос, тред появится сам.
          </span>
        ) : (
          <select
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm flex-1 min-w-0"
            value={activeId ?? ""}
            onChange={(e) => setActiveId(Number(e.target.value))}
            aria-label="Разговор"
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title ?? "Без названия"}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="outline" onClick={() => setActiveId(null)} disabled={busy}>
          Новый разговор
        </Button>
        {activeId !== null && (
          <button
            type="button"
            aria-label="Удалить разговор"
            className="p-1 rounded hover:bg-[var(--color-muted)]"
            onClick={() => void removeThread(activeId)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 max-h-[40vh] overflow-auto text-sm">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "self-end max-w-[90%]" : "self-start max-w-[90%]"}
          >
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {m.role === "user" ? "Вы" : "Собеседник"}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {buffer !== null && (
          <div className="self-start max-w-[90%]">
            <div className="text-xs text-[var(--color-muted-foreground)]">Собеседник · пишет…</div>
            <div className="whitespace-pre-wrap">{buffer || "…"}</div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <textarea
        className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-h-[4rem] font-sans"
        placeholder="Спросить про сцену, героя, развилку… Ctrl+Enter — отправить"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        disabled={busy}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Видит материалы книги и текст этой главы. В главу не пишет.
        </span>
        <Button size="sm" onClick={() => void send()} disabled={busy || !input.trim()}>
          Отправить
        </Button>
      </div>
    </div>
  );
}
```

`apps/web/src/pages/ChapterPage.tsx`: импорт и в правой колонке **первым** блоком, перед «Разбор критиков»:

```tsx
            <PanelBoundary title="Чат по книге">
              <ChatPanel chapterId={id} />
            </PanelBoundary>
```

- [ ] **Step 10: Прогон и коммит**

```bash
pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/ChatPanel.test.tsx
pnpm typecheck
pnpm test
git add packages/shared/src/chat.ts packages/shared/src/index.ts packages/llm/src/types.ts packages/llm/src/router.ts packages/agents/src/chat.ts packages/agents/src/index.ts packages/agents/src/__tests__/chat-prompt.test.ts apps/server/src/routes/chat.ts apps/server/src/routes/__tests__/chat.test.ts apps/server/src/app.ts apps/web/src
git commit -m "feat: чат по книге — треды на главе, та же сборка контекста, что у Писателя

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Глава по беатам

**Files:**
- Modify: `packages/shared/src/plot.ts` — `writeChapterInputSchema`
- Modify: `packages/agents/src/writer.ts` — `WriteChapterInput.beat`, промпт беата
- Modify: `apps/server/src/utils/prosemirror.ts` — `prosePlainTextToProseMirror` (переезжает из двух копий)
- Modify: `apps/server/src/routes/plot.ts`, `apps/server/src/routes/critique.ts` — убрать локальные копии, импортировать
- Modify: `apps/server/src/utils/prose-proposals.ts` — `appendProposalProgress`, `beatsDone/beatsTotal` в `FinishProposalInput`
- Modify: `apps/server/src/utils/proposal-cancel.ts` — `requestHold`, `shouldHold`
- Modify: `apps/server/src/routes/proposals.ts` — `POST /prose-proposals/:id/hold`
- Modify: `apps/server/src/routes/plot.ts` — цикл по беатам в `POST /chapters/:id/write`
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/components/chapter/ProposalPanel.tsx`, `apps/web/src/pages/ChapterPage.tsx`
- Test: `packages/agents/src/__tests__/writer-beat-prompt.test.ts`, `apps/server/src/utils/__tests__/proposal-cancel.test.ts`, `apps/server/src/routes/__tests__/write-beats.test.ts`

**Interfaces:**
- Consumes: `runChapterWriter(input: WriteChapterInput)` (`packages/agents/src/graphs/chapter-writing.ts`, прямая обёртка над `writeChapter`), `createProposal/finishProposal/loadProposal`, `ProposalCancelRegistry`, `judgeProseCompletion`, `isConfirmedCompletion`, `countWords`.
- Produces: `writeChapterInputSchema { config?, mode: "whole"|"beats" (default whole), fromBeat? }`; `WriteChapterInput.beat?: { index: number; textSoFar: string }`; `buildWriterBeatBlock(input): string`; `appendProposalProgress(sqlite, id, { contentText, wordCount, beatsDone, beatsTotal })`; `FinishProposalInput.beatsDone?/beatsTotal?`; `ProposalCancelRegistry.requestHold(id): boolean`, `.shouldHold(id): boolean`; `POST /api/prose-proposals/:id/hold → { holding: true }`; SSE-события `beat { index, total }`, `done { …, held?: true }`; клиент `streamWriteChapter(chapterId, config, handlers, signal, options?: { mode?: "whole"|"beats"; fromBeat?: number })`, `handlers.onBeat?`, `api.holdProposal(id)`.

- [ ] **Step 1: Тест промпта беата**

`packages/agents/src/__tests__/writer-beat-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWriterVolatilePrompt, type WriteChapterInput } from "../writer.js";

const beat = (i: number, summary: string) => ({
  index: i,
  type: "rising_action" as const,
  summary,
  goal: `цель ${i}`,
  conflict: `конфликт ${i}`,
  outcome: `исход ${i}`,
});

const base: WriteChapterInput = {
  bookTitle: "К",
  bookPremise: "п",
  bookOutline: null,
  studioContext: null,
  retrievedContext: null,
  chapterTitle: "Глава 4",
  beatSheet: {
    label: "v1",
    pov: "Нина",
    emotionalGoal: "тревога",
    estimatedWords: 3000,
    beats: [beat(0, "Нина у мотора"), beat(1, "Приходит Ворт"), beat(2, "Ссора")],
    closing: { mode: "open", note: "дверь остаётся открытой" },
  },
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
  styleContext: null,
  fatigueWords: [],
};

describe("промпт беата", () => {
  it("несёт уже написанное, требует только текущий беат и не завершать главу", () => {
    const p = buildWriterVolatilePrompt({
      ...base,
      beat: { index: 1, textSoFar: "Нина стояла у мотора и молчала." },
    });
    expect(p).toContain("Нина стояла у мотора и молчала.");
    expect(p).toMatch(/ТОЛЬКО беат 2 из 3/);
    expect(p).toContain("Приходит Ворт");
    expect(p).toMatch(/не завершай главу/i);
    expect(p).toMatch(/~1000 слов/);
    expect(p).not.toContain("Напиши главу.");
  });

  it("последний беат получает финал главы, первый — пометку о начале", () => {
    const last = buildWriterVolatilePrompt({ ...base, beat: { index: 2, textSoFar: "…" } });
    expect(last).toMatch(/последний беат/i);
    expect(last).toContain("дверь остаётся открытой");
    expect(last).not.toMatch(/не завершай главу/i);
    const first = buildWriterVolatilePrompt({ ...base, beat: { index: 0, textSoFar: "" } });
    expect(first).toMatch(/глава только начинается/i);
  });

  it("без beat промпт прежний — целая глава", () => {
    const p = buildWriterVolatilePrompt(base);
    expect(p).toContain("Напиши главу.");
    expect(p).not.toMatch(/ТОЛЬКО беат/);
  });
});
```

Если `closing` в `chapterClosingSchema` имеет другую форму (`mode` из другого списка или иное имя поля заметки) — открыть `packages/shared/src/plot.ts` рядом с `chapterClosingModeSchema` и подставить валидный объект; смысл теста — строка заметки финала доходит до последнего беата.

- [ ] **Step 2: Запустить — падает**

```bash
pnpm --filter @book-forge/agents test -- src/__tests__/writer-beat-prompt.test.ts
```

- [ ] **Step 3: Промпт беата в Писателе**

`packages/agents/src/writer.ts`: в `WriteChapterInput` после `signal`:

```ts
  /** Режим «по беатам» (заимствование из litrab.ai: на длинной генерации
   *  сползают голоса, ритм и детали). Один вызов — один беат; стабильная
   *  часть промпта та же, меняется только этот блок. */
  beat?: { index: number; textSoFar: string };
```

Заменить `buildWriterVolatilePrompt` целиком:

```ts
export function buildWriterVolatilePrompt(input: WriteChapterInput): string {
  const beatsBlock = input.beatSheet.beats
    .map(
      (b) =>
        `${b.index + 1}. [${b.type}] ${b.summary}\n   Цель: ${b.goal}\n   Конфликт: ${b.conflict}\n   Исход: ${b.outcome}`,
    )
    .join("\n\n");

  const parts = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.beatSheet.pov}`,
    `Эмоциональная цель: ${input.beatSheet.emotionalGoal}`,
    `Целевой объём: ~${input.beatSheet.estimatedWords} слов`,
  ];
  if (input.sceneIntent) parts.push(input.sceneIntent);
  parts.push(`Beats:\n${beatsBlock}`);
  if (input.beatSheet.contract) {
    const contract = renderChapterContract(input.beatSheet.contract);
    if (contract) parts.push(contract);
  }
  if (input.beat) {
    parts.push(buildWriterBeatBlock(input));
    return parts.join("\n\n");
  }
  if (input.beatSheet.closing) {
    parts.push(`Финал главы: ${renderChapterClosing(input.beatSheet.closing)}`);
  }
  parts.push("Напиши главу.");
  return parts.join("\n\n");
}

/** Блок одного беата. Идёт ПОСЛЕ контракта: запрет прочитан до задания. */
export function buildWriterBeatBlock(input: WriteChapterInput): string {
  const beat = input.beat;
  if (!beat) return "";
  const beats = input.beatSheet.beats;
  const total = beats.length;
  const current = beats[beat.index];
  if (!current) throw new Error(`beat index ${beat.index} out of range (${total})`);
  const isLast = beat.index === total - 1;
  const perBeatWords = Math.max(150, Math.round(input.beatSheet.estimatedWords / total));
  const lines = [
    "Режим: глава пишется по беатам, по одному вызову на беат.",
    beat.textSoFar.trim().length > 0
      ? `Уже написано (дословно; продолжай ровно с этого места, не повторяй и не пересказывай):\n${beat.textSoFar}`
      : "Уже написано: ничего — глава только начинается.",
    `Сейчас пиши ТОЛЬКО беат ${beat.index + 1} из ${total}:\n[${current.type}] ${current.summary}\n   Цель: ${current.goal}\n   Конфликт: ${current.conflict}\n   Исход: ${current.outcome}`,
    "Остальные беаты даны для ориентира — не забегай в них и не закрывай их исходы.",
    `Объём этого куска: ~${perBeatWords} слов.`,
  ];
  if (isLast) {
    lines.push(
      `Это последний беат — здесь финал главы${input.beatSheet.closing ? `: ${renderChapterClosing(input.beatSheet.closing)}` : ". Заканчивай действием, репликой или образом, не осмыслением."}`,
    );
  } else {
    lines.push(
      "Не завершай главу: не подводи итог, не ставь финальную точку сцены, не пиши рефлексивный хвост. Закончи там, где беат кончается по смыслу — можно на полуслове действия.",
    );
  }
  lines.push("Выведи только прозу этого беата.");
  return lines.join("\n\n");
}
```

```bash
pnpm --filter @book-forge/agents test -- src/__tests__/writer-beat-prompt.test.ts
pnpm --filter @book-forge/agents test
```

- [ ] **Step 4: Схема входа**

`packages/shared/src/plot.ts`:

```ts
export const writeChapterInputSchema = z
  .object({
    config: generationConfigSchema.optional(),
    /** `beats` — по одному вызову на беат, кандидат растёт по ходу. */
    mode: z.enum(["whole", "beats"]).default("whole"),
    /** Дописать с этого беата; префикс — текст принятой версии главы. */
    fromBeat: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.fromBeat === undefined || v.mode === "beats", {
    message: "fromBeat requires mode=beats",
  });
```

- [ ] **Step 5: Реестр остановки — тест и код**

Дописать в `apps/server/src/utils/__tests__/proposal-cancel.test.ts`:

```ts
  it("удержание не прерывает сигнал и не считается отменой", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    expect(reg.requestHold(1)).toBe(true);
    expect(reg.shouldHold(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.signal(1)?.aborted).toBe(false);
    expect(reg.requestHold(2)).toBe(false);
  });
```

`apps/server/src/utils/proposal-cancel.ts`: в интерфейс

```ts
  /** Остановиться после текущего беата, СОХРАНИВ написанное. В отличие от
   *  `requestStop` сигнал не прерывается: беат дописывается. */
  requestHold: (proposalId: number) => boolean;
  shouldHold: (proposalId: number) => boolean;
```

В `runs` — `{ stopping: boolean; holding: boolean; controller: AbortController }`; `begin` ставит `holding: false`; методы:

```ts
    requestHold: (proposalId) => {
      const run = runs.get(proposalId);
      if (!run) return false;
      run.holding = true;
      return true;
    },
    shouldHold: (proposalId) => runs.get(proposalId)?.holding === true,
```

```bash
pnpm --filter @book-forge/server test -- src/utils/__tests__/proposal-cancel.test.ts
```

- [ ] **Step 6: Кандидат: прогресс и поля беатов**

`apps/server/src/utils/prosemirror.ts` — добавить (перенос из `routes/plot.ts:613` и `routes/critique.ts:107`, тела идентичны):

```ts
/** Проза с абзацами через пустую строку → документ ProseMirror. Одна копия:
 *  раньше их было две, в маршрутах Писателя и правки. */
export function prosePlainTextToProseMirror(text: string): unknown {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return {
    type: "doc",
    content:
      paragraphs.length === 0
        ? [{ type: "paragraph" }]
        : paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}
```

Сверить тело с существующей копией в `plot.ts` (строка ~613): если оно отличается (например, `\n` внутри абзаца превращается в `hardBreak`), взять тело из `plot.ts` дословно. Затем удалить обе локальные функции и импортировать из `../utils/prosemirror.js` (в `plot.ts` уже есть импорт `extractText, countWords` оттуда — дописать в него).

`apps/server/src/utils/prose-proposals.ts`: импорт `prosePlainTextToProseMirror`; в `FinishProposalInput` добавить `beatsDone?: number | null; beatsTotal?: number | null;`; в SQL `finishProposal` перед `updated_at = ?` добавить `beats_done = COALESCE(?, beats_done), beats_total = COALESCE(?, beats_total),` и в `.run(...)` перед `new Date().toISOString()` — `input.beatsDone ?? null, input.beatsTotal ?? null,`. Новая функция после `finishProposal`:

```ts
/** Дописывает кандидата по ходу битовой генерации: текст всех беатов,
 *  написанных к этому моменту. Только из `streaming` — поздний ответ после
 *  отмены не имеет права ничего записать (тот же рубеж, что у finish). */
export function appendProposalProgress(
  sqlite: DatabaseType,
  id: number,
  input: { contentText: string; wordCount: number; beatsDone: number; beatsTotal: number },
): void {
  sqlite
    .prepare(
      `UPDATE prose_proposals SET
         content_text = ?, content_json = ?, word_count = ?,
         beats_done = ?, beats_total = ?, updated_at = ?
       WHERE id = ? AND status = 'streaming'`,
    )
    .run(
      input.contentText,
      JSON.stringify(prosePlainTextToProseMirror(input.contentText)),
      input.wordCount,
      input.beatsDone,
      input.beatsTotal,
      new Date().toISOString(),
      id,
    );
}
```

- [ ] **Step 7: Маршрут `hold`**

`apps/server/src/routes/proposals.ts`, после `r.post("/prose-proposals/:id/cancel", …)`:

```ts
  // Остановка с сохранением (глава по беатам): поток дописывает текущий беат
  // и завершает кандидата `incomplete` — его можно принять. Отмена — другое:
  // она выбрасывает всё.
  r.post("/prose-proposals/:id/hold", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    if (proposal.status !== "streaming") {
      return badRequest(c, `нельзя удержать предложение в статусе ${proposal.status}`);
    }
    if (!cancels.requestHold(id)) {
      return badRequest(c, "этот запуск уже завершён или идёт не в этом процессе");
    }
    return c.json({ holding: true });
  });
```

- [ ] **Step 8: Тест маршрута записи по беатам**

`apps/server/src/routes/__tests__/write-beats.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
}));

import { runChapterWriter } from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const writerMock = vi.mocked(runChapterWriter);
let t: TestApp;
let bookId: number;
let chapterId: number;

const PLAN = {
  variants: [
    {
      label: "v1",
      pov: "Нина",
      emotionalGoal: "тревога",
      estimatedWords: 900,
      beats: [0, 1, 2].map((i) => ({
        index: i,
        type: "rising_action",
        summary: `беат ${i}`,
        goal: "g",
        conflict: "c",
        outcome: "o",
      })),
    },
  ],
  selectedIndex: 0,
  generatedAt: "2026-09-21T00:00:00.000Z",
};

function okResult(text: string) {
  return {
    text,
    modelId: "test-model",
    stopReason: "end_turn",
    tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
  };
}

beforeEach(async () => {
  t = makeTestApp();
  process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
  writerMock.mockReset();
  writerMock.mockImplementation(async function* (input) {
    const i = input.beat?.index ?? -1;
    const text = `Абзац беата ${i}.`;
    yield text;
    return okResult(text);
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Глава" });
  chapterId = ch.id;
  t.sqlite.prepare("UPDATE chapters SET plan_json = ? WHERE id = ?").run(JSON.stringify(PLAN), chapterId);
});
afterEach(() => {
  delete process.env.LLM_AGENT_BACKEND_MAP;
  return t.cleanup();
});

function events(body: string, name: string): unknown[] {
  return body
    .split("\n\n")
    .filter((f) => f.includes(`event: ${name}`))
    .map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
}

describe("глава по беатам", () => {
  it("один вызов на беат, текст копится в одном кандидате", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(writerMock).toHaveBeenCalledTimes(3);
    expect(writerMock.mock.calls.map((c) => c[0].beat?.index)).toEqual([0, 1, 2]);
    expect(writerMock.mock.calls[2]?.[0].beat?.textSoFar).toBe("Абзац беата 0.\n\nАбзац беата 1.");
    expect(events(body, "beat")).toEqual([
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 },
    ]);
    const done = events(body, "done")[0] as { proposal: { contentText: string; beatsDone: number; beatsTotal: number; status: string } };
    expect(done.proposal.contentText).toBe("Абзац беата 0.\n\nАбзац беата 1.\n\nАбзац беата 2.");
    expect(done.proposal.beatsDone).toBe(3);
    expect(done.proposal.beatsTotal).toBe(3);
    expect(done.proposal.status).toBe("ready");
  });

  it("целиком — как прежде: один вызов, beats null", async () => {
    writerMock.mockImplementation(async function* () {
      yield "Вся глава.";
      return okResult("Вся глава.");
    });
    const body = await (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {})).text();
    expect(writerMock).toHaveBeenCalledTimes(1);
    expect(writerMock.mock.calls[0]?.[0].beat).toBeUndefined();
    const done = events(body, "done")[0] as { proposal: { beatsDone: number | null } };
    expect(done.proposal.beatsDone).toBeNull();
  });

  it("удержание после беата сохраняет написанное как incomplete", async () => {
    writerMock.mockImplementation(async function* (input) {
      const i = input.beat?.index ?? -1;
      if (i === 1) {
        const row = t.sqlite
          .prepare("SELECT id FROM prose_proposals WHERE status = 'streaming' ORDER BY id DESC LIMIT 1")
          .get() as { id: number };
        const hold = await send(t.app, `/api/prose-proposals/${row.id}/hold`, "POST");
        expect(hold.status).toBe(200);
      }
      const text = `Беат ${i}.`;
      yield text;
      return okResult(text);
    });
    const body = await (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" })).text();
    expect(writerMock).toHaveBeenCalledTimes(2);
    const done = events(body, "done")[0] as {
      held?: boolean;
      proposal: { status: string; stopReason: string | null; beatsDone: number; contentText: string };
    };
    expect(done.held).toBe(true);
    expect(done.proposal.status).toBe("incomplete");
    expect(done.proposal.stopReason).toBe("held");
    expect(done.proposal.beatsDone).toBe(2);
    expect(done.proposal.contentText).toBe("Беат 0.\n\nБеат 1.");
  });

  it("дописать с беата берёт префикс из принятой версии", async () => {
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Принятое начало." }] }],
      },
    });
    const body = await (
      await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats", fromBeat: 2 })
    ).text();
    expect(writerMock).toHaveBeenCalledTimes(1);
    expect(writerMock.mock.calls[0]?.[0].beat).toEqual({ index: 2, textSoFar: "Принятое начало." });
    const done = events(body, "done")[0] as { proposal: { contentText: string; beatsDone: number } };
    expect(done.proposal.contentText).toBe("Принятое начало.\n\nАбзац беата 2.");
    expect(done.proposal.beatsDone).toBe(3);
  });

  it("fromBeat без mode=beats и за пределами плана — 400", async () => {
    expect((await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { fromBeat: 1 })).status).toBe(400);
    expect(
      (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats", fromBeat: 3 })).status,
    ).toBe(400);
  });
});
```

Если `POST /api/chapters/:id/versions` принимает тело другой формы — см. `api.createVersion` в `client.ts`.

- [ ] **Step 9: Запустить — падает**

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/write-beats.test.ts
```

- [ ] **Step 10: Цикл по беатам в маршруте**

`apps/server/src/routes/plot.ts`, обработчик `r.post("/chapters/:id/write", …)`. В импорт из `../utils/prose-proposals.js` добавить `appendProposalProgress`. После `if (!beatSheet) return badRequest(c, "selected plan variant missing");` добавить проверки режима:

```ts
    const mode = parsed.data.mode;
    const fromBeat = parsed.data.fromBeat ?? 0;
    if (mode === "beats" && fromBeat >= beatSheet.beats.length) {
      return badRequest(c, `fromBeat ${fromBeat} за пределами плана (${beatSheet.beats.length} беатов)`);
    }
    // Дописать с беата: префикс — текст принятой версии, автор его уже принял.
    let prefixText = "";
    if (mode === "beats" && fromBeat > 0) {
      if (ch.current_version_id === null) {
        return badRequest(c, "дописать с беата можно только поверх принятой версии главы");
      }
      const v = sqlite
        .prepare("SELECT content_text FROM chapter_versions WHERE id = ?")
        .get(ch.current_version_id) as { content_text: string } | undefined;
      prefixText = v?.content_text ?? "";
    }
```

Дальше в теле `streamSSE`, блок от `const gen = runChapterWriter({ … });` до конца цикла `while (true) { … }` включительно заменить на:

```ts
        const writerInput = {
          bookTitle: ctx.title,
          bookPremise: ctx.premise,
          bookOutline: ctx.outlineSelected,
          chapterTitle: ch.title,
          beatSheet: beatSheetForWriter,
          sceneIntent: sceneIntent.prompt,
          previousChaptersSummary: assembled.previousChapters,
          previousChapterTail: assembled.previousTail,
          sceneState: assembled.sceneState,
          characterContext: assembled.characterContext,
          loreContext: assembled.loreContext,
          styleContext: assembled.styleContext.prompt,
          studioContext: assembled.studioContext,
          retrievedContext: assembled.retrieval,
          fatigueWords: assembled.styleContext.fatigueBlacklist,
          config: {
            variants: 1,
            ...parsed.data.config,
            model: parsed.data.config?.model ?? ctx.writerModel,
          },
          provider: ctx.writerProvider,
          ...(ctx.writerLocalModel ? { localModelTag: ctx.writerLocalModel } : {}),
          ...(signal !== undefined ? { signal } : {}),
        };

        // Один проход Писателя: целая глава или один беат. Статистика
        // копится по всем проходам — расход главы считается разом.
        const runOnce = async (beat?: { index: number; textSoFar: string }): Promise<string> => {
          const gen = runChapterWriter(beat ? { ...writerInput, beat } : writerInput);
          let text = "";
          while (true) {
            const next = await gen.next();
            if (next.done) {
              text = next.value.text;
              modelId = next.value.modelId;
              stopReason = next.value.stopReason;
              inputTokens += next.value.tokens.input;
              outputTokens += next.value.tokens.output;
              cacheCreationTokens += next.value.tokens.cacheCreation;
              cacheReadTokens += next.value.tokens.cacheRead;
              break;
            }
            await stream.writeSSE({ event: "chunk", data: JSON.stringify({ text: next.value }) });
          }
          return text;
        };

        let held = false;
        let beatsDone: number | null = null;
        const beatsTotal = mode === "beats" ? beatSheet.beats.length : null;
        if (mode === "beats") {
          fullText = prefixText;
          for (let i = fromBeat; i < beatSheet.beats.length; i += 1) {
            await stream.writeSSE({
              event: "beat",
              data: JSON.stringify({ index: i, total: beatSheet.beats.length }),
            });
            const piece = (await runOnce({ index: i, textSoFar: fullText })).trim();
            fullText = fullText.trim().length > 0 ? `${fullText.trim()}\n\n${piece}` : piece;
            beatsDone = i + 1;
            // Кандидат растёт по ходу: падение процесса не теряет написанное.
            appendProposalProgress(sqlite, proposalId, {
              contentText: fullText,
              wordCount: countWords(fullText),
              beatsDone,
              beatsTotal: beatSheet.beats.length,
            });
            if (cancels.shouldStop(proposalId)) break;
            if (cancels.shouldHold(proposalId) && i < beatSheet.beats.length - 1) {
              held = true;
              break;
            }
          }
        } else {
          fullText = await runOnce();
        }
```

Ниже, в блоке завершения (`const verdict = judgeProseCompletion(...)` и `finishProposal(...)`) — статус и причина учитывают удержание:

```ts
        const verdict = judgeProseCompletion(stopReason, fullText);
        const confirmed = isConfirmedCompletion(stopReason);
        finishProposal(sqlite, proposalId, {
          status: held ? "incomplete" : verdict.looksComplete ? "ready" : "incomplete",
          contentText: fullText,
          contentJson: JSON.stringify(prosePlainTextToProseMirror(fullText)),
          wordCount: countWords(fullText),
          completion: confirmed && !held ? "confirmed" : "unconfirmed",
          stopReason: held ? "held" : stopReason,
          modelId,
          backend: ctx.writerProvider,
          beatsDone,
          beatsTotal,
        });
```

И в финальном `done` добавить `...(held ? { held: true } : {}),` рядом с `proposal: loadProposal(sqlite, proposalId)`. Переменные `inputTokens/outputTokens/cacheCreationTokens/cacheReadTokens/modelId/stopReason/fullText` уже объявлены выше `let`-ами — `runOnce` их наращивает, а не присваивает (кроме `modelId`/`stopReason`).

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/write-beats.test.ts
pnpm --filter @book-forge/server test -- src/routes/__tests__/plot.test.ts src/routes/__tests__/proposals.test.ts src/utils/__tests__/prose-proposals.test.ts
```

- [ ] **Step 11: Клиент**

`apps/web/src/api/client.ts`:
- в `WriterStreamHandlers` добавить `onBeat?: (e: { index: number; total: number }) => void;` и в тип `onDone` payload — `held?: boolean;`;
- сигнатура `streamWriteChapter(chapterId, config, handlers, signal?, options?: { mode?: "whole" | "beats"; fromBeat?: number })`, тело запроса `JSON.stringify({ config, ...(options?.mode ? { mode: options.mode } : {}), ...(options?.fromBeat !== undefined ? { fromBeat: options.fromBeat } : {}) })`;
- в разборе событий: `else if (event === "beat") handlers.onBeat?.(data as { index: number; total: number });`;
- в `api`: `holdProposal: (id: number) => req<{ holding: boolean }>(\`/api/prose-proposals/${id}/hold\`, { method: "POST" }),`.

- [ ] **Step 12: Панель кандидата и страница главы**

`ProposalPanel.tsx`, в `caption` после `{proposal.wordCount} слов`:

```tsx
        {proposal.beatsDone !== null && proposal.beatsTotal !== null && (
          <> · написано беатов: {proposal.beatsDone} из {proposal.beatsTotal}</>
        )}
```

и под предупреждениями:

```tsx
      {proposal.stopReason === "held" && (
        <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          Остановлено по вашей просьбе после беата {proposal.beatsDone}. Принять можно;
          дописать оставшиеся беаты — кнопкой на странице главы после принятия.
        </p>
      )}
```

`ChapterPage.tsx`:
- состояние `const [writeMode, setWriteMode] = useState<"whole" | "beats">(() => { try { return localStorage.getItem("bf-write-mode") === "beats" ? "beats" : "whole"; } catch { return "whole"; } });` и `const [beatProgress, setBeatProgress] = useState<{ index: number; total: number } | null>(null);` и `const [holding, setHolding] = useState(false);` и `const [resumeFromBeat, setResumeFromBeat] = useState<number | null>(null);`
- `onRunWriter(fromBeat?: number)`: передавать в `streamWriteChapter(id, undefined, {...}, ctrl.signal, { mode: writeMode, ...(fromBeat !== undefined ? { fromBeat } : {}) })`; в обработчиках `onBeat: (e) => setBeatProgress(e)`, в `onDone` — `setBeatProgress(null); setHolding(false);` и `if (payload.held) toast.info("Остановлено после беата", { description: "Написанное лежит в кандидате — примите его или отклоните." });`;
- функция `async function onHoldWriter() { if (runningProposalId === null) return; setHolding(true); try { await api.holdProposal(runningProposalId); } catch (e) { setHolding(false); toast.error("Не удалось остановить", { description: e instanceof Error ? e.message : String(e) }); } }`;
- рядом с кнопкой «Написать главу» переключатель:

```tsx
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={writeMode === "beats"}
                onChange={(e) => {
                  const next = e.target.checked ? "beats" : "whole";
                  setWriteMode(next);
                  try { localStorage.setItem("bf-write-mode", next); } catch { /* приватное окно */ }
                }}
                disabled={writing}
              />
              По беатам
            </label>
            {writing && beatProgress && (
              <span className="text-xs">Беат {beatProgress.index + 1} из {beatProgress.total}</span>
            )}
            {writing && writeMode === "beats" && (
              <Button size="sm" variant="outline" onClick={() => void onHoldWriter()} disabled={holding}>
                {holding ? "Дописываю беат…" : "Остановить после беата"}
              </Button>
            )}
            {!writing && resumeFromBeat !== null && (
              <Button size="sm" variant="outline" onClick={() => void onRunWriter(resumeFromBeat)}>
                Дописать с беата {resumeFromBeat + 1}
              </Button>
            )}
```

- откуда берётся `resumeFromBeat`: в эффекте загрузки главы (там, где вызывается `api.getChapter(id)` в `load()`), после получения главы:

```ts
      // Частично написанная и принятая глава: с какого беата продолжать,
      // видно по последнему принятому кандидату — без новых колонок у версии.
      try {
        const list = await api.listProposals(id);
        const partial = list.find(
          (p) =>
            p.acceptedVersionId !== null &&
            p.acceptedVersionId === fresh.currentVersionId &&
            p.beatsDone !== null &&
            p.beatsTotal !== null &&
            p.beatsDone < p.beatsTotal,
        );
        setResumeFromBeat(partial ? partial.beatsDone : null);
      } catch {
        setResumeFromBeat(null);
      }
```

(`fresh` — переменная с загруженной главой в этом эффекте; подставить её имя). Если `api.listProposals` отдаёт только неулаженных кандидатов (без `accepted`), открыть `GET /chapters/:id/proposals` в `apps/server/src/routes/proposals.ts` и убрать фильтр по статусу — принятые нужны здесь.

- [ ] **Step 13: Прогон и коммит**

```bash
pnpm typecheck
pnpm test
git add packages/shared/src/plot.ts packages/agents/src/writer.ts packages/agents/src/__tests__/writer-beat-prompt.test.ts apps/server/src apps/web/src
git commit -m "feat: глава по беатам — один вызов на беат, остановка с сохранением, дописать с беата

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Документация, ревью ветки, слияние

**Files:**
- Modify: `CLAUDE.md` — раздел «Заимствования из litrab.ai (2026-09-21)»
- Modify: `docs/superpowers/specs/2026-09-21-litrab-borrowings.md` — при расхождениях с тем, что вышло

- [ ] **Step 1: Раздел в CLAUDE.md**

После раздела «**Состояние сцены (2026-09-21…)**» добавить абзац (жирный заголовок в том же стиле), кратко и только про решения, которых нет в коде:

```markdown
**Заимствования из litrab.ai (2026-09-21):** восемь приёмов конкурента, спецификация `docs/superpowers/specs/2026-09-21-litrab-borrowings.md`, одна миграция 0032. Другие имена героя — экран над `entity_aliases` (`AliasEditor`), API был с ADR 0003. `books.author_notes` — единственное поле книги, которое НЕ читает ни одна сборка контекста; инвариант закреплён тестом на маячок в `litrab-borrowings.test.ts`, заводить читателя нельзя. «Глазок» `characters.hidden_from_prompts` фильтруется ровно в одном месте — `gatherCharacterContext`; POV из плана (`alwaysIncludeIds`) фильтр обходит, планировщик (`loadCanonCast`) и `cast_check` видят весь состав; ревизию карточки флаг не двигает. Inline «Описать» (`describe` + `sense`) вплетает одну деталь одного канала и намеренно не видит текст ПОСЛЕ фрагмента — иначе модель продолжает сцену; де-AI правило про сенсорную плотность держится тем, что деталь одна. Отчёт о потерях после правки живёт в `ProposalPanel`: дельта объёма (порог 10%, только для `repair`), `protectedLost` с сервера (раньше терялся — панель его не читала), `findLostMentions` по убранным абзацам. Свежесть стиля: `GET /books/:id/style-freshness`, порог три главы после `last_extracted_at`, блендам не считается; добор глав кладёт корпус через `insertReferenceCorpus` и НЕ удаляет старые, извлечение — прежним маршрутом со стороны клиента. Чат (`book_chat`, subscription, модель `plotModel`) — тонкий потребитель `assembleGenerationContext`, треды на главе и друг о друге не знают, в главу не пишет; `#`-упоминаний нет — потолок. Глава по беатам: `mode: "beats"` в `POST /chapters/:id/write`, один вызов на беат при той же стабильной части промпта (кэш-префикс цел), кандидат дописывается после каждого беата (`appendProposalProgress`), `hold` ≠ `cancel` — дописывает беат и сохраняет как `incomplete` со `stopReason: "held"`; «дописать с беата k» берёт префикс из принятой версии, а с какого беата — из последнего принятого кандидата (`beatsDone < beatsTotal`). `prosePlainTextToProseMirror` переехал в `utils/prosemirror.ts` из двух копий.
```

- [ ] **Step 2: Ревью ветки целиком**

Вопросы, которые пошаговые ревью не задают (память проекта 2026-09-05): цикл по беатам и `finishProposal` — один ли раз пишется `beats_done` и совпадает ли с числом вызовов при `fromBeat > 0`; `hold` пришедший на последнем беате — статус `ready`, а не `incomplete`; `describe` без выделения — 400 из общей проверки, не отдельной; `author_notes` не читает ни `export.md`, ни интейк; скрытый герой при `povName`, совпадающем с ним, — карточка есть.

```bash
git diff main...HEAD --stat
pnpm typecheck && pnpm test
```

- [ ] **Step 3: Живой прогон (ручной, при доступном бэкенде)**

На копии базы: включить «По беатам», написать главу из 3+ беатов, нажать «Остановить после беата» на втором — кандидат `incomplete`, принять, увидеть «Дописать с беата 3», дописать. В чате спросить про героя, которого в главе нет, — ответ содержит «в материалах книги этого нет». «Описать → обоняние» на одной фразе — вернулась та же фраза плюс одна деталь.

- [ ] **Step 4: Слияние**

```bash
git checkout main
git merge --no-ff feat/litrab-borrowings -m "Merge branch 'feat/litrab-borrowings'"
pnpm migrate
```

Отправка на GitHub — только по слову автора.
