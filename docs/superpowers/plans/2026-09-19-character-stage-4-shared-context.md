# Этап 4 «Общий контекст» — план реализации

> **Для исполнителя:** ОБЯЗАТЕЛЬНАЯ ПОД-СКИЛЛ: `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans`. Шаги помечены `- [ ]` для отметок.

**Цель:** Writer, критики и Reviser собирают историю главы из одних и тех же источников с общим отпечатком, и расхождение базы между написанием и правкой видно, а не предполагается.

**Архитектура:** сначала уравнять, потом извлечь. Критика и правка переводятся на те же три функции истории, что у Writer (сводки по рубежам, хвост предыдущей главы, найденные фрагменты) — это закрывает главный дефект первой же задачей. Когда оба пути считают одно и то же, общая сборка извлекается в `apps/server/src/utils/generation-context.ts` механически, и проверка одна: два вызова дают одинаковые секции. Затем к сборке добавляется манифест источников с отпечатком (контракт в `packages/shared`), который сохраняется при написании и сверяется при критике. **Текст промпта в базу не пишется** — решение автора 2026-09-19: всё, на что указывает манифест, уже версионировано (версии глав неизменны, сводки — по отпечатку, профили и отношения — с историей ревизий этапа 2), а расхождение базы обнаруживается сравнением отпечатков, не перечитыванием старого текста.

**Технологии:** Hono, better-sqlite3 (WAL), zod 4, vitest. Новых зависимостей нет.

**Спека:** `docs/superpowers/specs/2026-09-05-character-individuality.md`, разделы 8 (8.1–8.4), 18; AC-12, AC-13, AC-14, AC-15, AC-36. Отклонение от 8.1 (хранение текста) принято автором.

## Глобальные ограничения

- Миграции — **рукописный SQL**. `drizzle:generate` запрещён. Новая: `pnpm --filter @book-forge/server drizzle:new <name>` → правка `.sql` → `schema.ts` ради типов → `pnpm migrate`.
- В коммит идут **только файлы своей задачи**. `git add -A` запрещён: в дереве чужая незакоммиченная работа в `import/` и `assets/`.
- Каждая задача заканчивается зелёными `pnpm typecheck` (все 7 пакетов) и `pnpm test`. Отчёт без обоих запусков не принимается.
- Граница сцены **исключающая**; `beforeChapterOrder` в `chapter-retrieval.ts` — включающая, передаёт `order - 1`. Не путать.
- `order_index` разрежённый (шаг 10); позиция — через `chapterPositionLookup`.
- Вся SQL границы событий — в `apps/server/src/utils/character-events.ts`. Второй экземпляр не заводить.
- Сообщение коммита оканчивается `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `apps/server/src/utils/context-compiler.ts` (править) | Обязательный слой не выпадает молча: `requiredOverflow`. |
| `apps/server/src/utils/chapter-retrieval.ts` (править) | Исключать из поиска только главы, поданные дословно. |
| `apps/server/src/utils/chapter-prose-context.ts` (править) | История критики/правки = история Writer. Срез «1200 символов» удаляется. |
| `apps/server/src/utils/generation-context.ts` (создать, задача 4) | Единственная сборка секций для всех ролей. |
| `packages/shared/src/generation-context.ts` (создать, задача 5) | Контракт манифеста и `snapshotFingerprint`. Чистые функции. |
| `apps/server/drizzle/0026_context_manifests.sql` (создать, задача 5) | Манифест и отпечаток на каждую сборку. Без текста. |
| `apps/server/src/routes/plot.ts` (править) | Writer через общую сборку; записывает манифест. |
| `apps/server/src/routes/critique.ts` (править) | Критика сверяет отпечаток и отдаёт `baseChanged`. |

---

### Задача 1: Переполнение обязательного слоя видно вызывающему (AC-14)

**Файлы:**
- Изменить: `apps/server/src/utils/context-compiler.ts`
- Тест: `apps/server/src/utils/__tests__/context-compiler.test.ts`

**Интерфейсы:**
- Производит: `CompiledContext.requiredOverflow: boolean`, `CompiledContext.requiredTokens: number`.

Сейчас `required` умеет только «всегда включить»: при переполнении `totalTokens` тихо превышает бюджет, и вызывающий не узнаёт. Раздел 8.4: если обязательный слой не помещается — уменьшить задачу или вернуть понятную ошибку; не генерировать с потерянными ограничениями.

- [ ] **Шаг 1: Падающий тест**

```ts
it("сообщает, что обязательный слой не влез, а не молчит", () => {
  const compiled = compileContext(
    [
      { id: "must", text: "я".repeat(3000), priority: 1, required: true },
      { id: "extra", text: "б".repeat(300), priority: 2 },
    ],
    { maxTokens: 100 },
  );
  expect(compiled.includedIds).toContain("must");
  expect(compiled.requiredOverflow).toBe(true);
  expect(compiled.requiredTokens).toBeGreaterThan(100);
  // Необязательное при переполнении не добавляется: места нет уже под
  // обязательное, и любой довесок только углубляет яму.
  expect(compiled.includedIds).not.toContain("extra");
  expect(compiled.dropped.map((d) => d.id)).toContain("extra");
});

it("при нормальном бюджете флаг опущен", () => {
  const compiled = compileContext(
    [{ id: "must", text: "коротко", priority: 1, required: true }],
    { maxTokens: 1000 },
  );
  expect(compiled.requiredOverflow).toBe(false);
  expect(compiled.requiredTokens).toBe(estimateTokens("коротко"));
});
```

- [ ] **Шаг 2: Убедиться в падении** — `pnpm --filter @book-forge/server test -- src/utils/__tests__/context-compiler.test.ts`; `requiredOverflow` не существует.
- [ ] **Шаг 3: Реализовать** — считать `requiredTokens` при проходе по `required`; `requiredOverflow = requiredTokens > opts.maxTokens`; при переполнении все необязательные секции — в `dropped`. `describeCompiledContext` печатает `REQUIRED OVERFLOW` первым словом, когда флаг поднят.
- [ ] **Шаг 4: Writer реагирует** — в `routes/plot.ts` после `compileContext`: при `requiredOverflow` — `badRequest` с текстом «обязательный контекст сцены (~N токенов) не помещается в бюджет (M); сократите план или состав», генерация не стартует. Тест маршрута с крошечным `MAX_WRITER_CONTEXT_TOKENS` через параметр, если он инжектируется; иначе — через мок `compileContext`.
- [ ] **Шаг 5:** `pnpm typecheck`, `pnpm test`. Коммит `fix(context): переполнение обязательного слоя видно, а не молчит`.

---

### Задача 2: Поиск по тексту не прячет деталь недавней главы (AC-12)

**Файлы:**
- Изменить: `apps/server/src/utils/chapter-retrieval.ts`, `apps/server/src/routes/plot.ts`
- Тест: `apps/server/src/utils/__tests__/chapter-retrieval.test.ts`

`excludeFromChapterOrder = currentOrder - ROLLING_WINDOW` выбрасывает фрагменты последних трёх глав «потому что окно подаёт их дословно». Не подаёт: `chapterSnippet` берёт `summary`, когда он есть; дословный текст даёт только `loadPreviousChapterTail`, и только одной главе. Деталь, которой нет в сводке, недостижима ни одним путём.

**Интерфейсы:**
- Производит: `GatherRetrievedChunksOptions.verbatimChapterOrders?: readonly number[]` — главы, чей текст подан дословно. `excludeFromChapterOrder` удаляется вместе с последним вызовом.

- [ ] **Шаг 1: Падающий тест** — книга из 6 глав; у главы 5 `summary` без слова «медальон», а в `content_text` оно есть; при поиске для главы 6 с `verbatimChapterOrders: [50]` (глава 5 подана хвостом) фрагмент главы 5 отсутствует, а с `verbatimChapterOrders: []` — присутствует. Использовать `indexChapterVersion` из `@book-forge/retrieval` для наполнения чанков, как в тестах памяти.
- [ ] **Шаг 2: Убедиться в падении.**
- [ ] **Шаг 3: Реализовать** — фильтр `verbatimChapterOrders.includes(h.chapterOrder)`; параметр `excludeFromChapterOrder` удалить.
- [ ] **Шаг 4: `routes/plot.ts`** — передавать `verbatimChapterOrders` = порядок главы, чей текст реально ушёл в `prevTail` (одна предыдущая глава с текстом), иначе `[]`.
- [ ] **Шаг 5:** типы, тесты, коммит `fix(retrieval): недавние главы больше не исключаются целиком`.

---

### Задача 3: Критика и правка видят ту же историю, что Writer (AC-36)

**Файлы:**
- Изменить: `apps/server/src/utils/chapter-prose-context.ts`, `apps/server/src/routes/critique.ts` (если бюджет там не применяется), `packages/agents/src/critics/base.ts` / `reviser.ts` — только если поле ввода надо переименовать.
- Тест: `apps/server/src/utils/__tests__/chapter-prose-context.test.ts`

**Интерфейсы:**
- `ChapterProseContext.previousChaptersSummary` теперь — результат `loadRollingChapterContext`; добавляются `previousTail: string | null` и `retrieval: string | null`. Функция `previousChaptersSummary` (срез 1200 символов) удаляется.
- `loadChapterProseContext(sqlite, book, ch, chapterText, opts: { hasVec: boolean })` — `hasVec` нужен поиску.

- [ ] **Шаг 1: Падающий тест** — глава 10 в книге из 12 с сводкой рубежа 1–7 (через `runMetaSummary` с моком `metaSummarize`): в `previousChaptersSummary` есть текст сводки и **нет** «Глава #10 «Глава 1»…» среза первой главы целиком; `previousTail` содержит конец девятой; `retrieval` не `null`, когда есть проиндексированные фрагменты.
- [ ] **Шаг 2: Убедиться в падении.**
- [ ] **Шаг 3: Реализовать** — вызовы `loadRollingChapterContext(sqlite, book.id, ch.order_index)`, `loadPreviousChapterTail(...)`, `gatherRetrievedChunks(...)` с `queryText: chapterText`, `verbatimChapterOrders` по хвосту. Собрать через `compileContext` с тем же бюджетом `MAX_WRITER_CONTEXT_TOKENS` и теми же приоритетами, что у Writer; при `requiredOverflow` — критика отвечает 400 тем же текстом, что и Writer.
- [ ] **Шаг 4:** проверить, что критики и Reviser получают новые поля там, где раньше получали срез (`critique.ts`, `proposals.ts` repair-ветка). Ничего не «улучшать» в промптах — только подача истории.
- [ ] **Шаг 5:** типы, тесты, коммит `fix(critique): критика и правка видят ту же историю, что Writer`.

---

### Задача 4: Одна сборка на всех (извлечение)

**Файлы:**
- Создать: `apps/server/src/utils/generation-context.ts`
- Изменить: `apps/server/src/routes/plot.ts`, `apps/server/src/utils/chapter-prose-context.ts`
- Тест: `apps/server/src/utils/__tests__/generation-context.test.ts`

После задачи 3 оба пути считают одно и то же разным кодом. Извлечь общее.

**Интерфейсы:**

```ts
export interface AssembledContext {
  /** Секции в порядке подачи, уже отрендеренные, до бюджета. */
  sections: ContextSection[];
  compiled: CompiledContext;
  pov: string;
  povCharacterId: number | null;
  /** Имена из запроса, которые резолвер не смог однозначно привязать
   *  (раздел 8.2). Не угадываются; отдаются наверх. */
  ambiguousNames: string[];
  characterContext: string | null;
  loreContext: string | null;
  bookContext: string;
  previousChapters: string | null;
  previousTail: string | null;
  retrieval: string | null;
  studioContext: string | null;
  styleContext: StyleContext;
  /** Ссылки на использованные источники — сырьё для манифеста задачи 5. */
  sourceRefs: Array<{ kind: string; id: number; versionId: number | null; revision: number | null }>;
}

export async function assembleGenerationContext(
  sqlite: DatabaseType,
  args: {
    book: BookRow;
    chapter: ChapterRow;
    hasVec: boolean;
    /** Беат-лист у Writer, текст главы у критики. Ищутся участники и фрагменты. */
    queryTexts: Array<string | null>;
    /** Имя POV из плана; резолвится в id. */
    povName: string | null;
    budgetTokens: number;
  },
): Promise<AssembledContext>;
```

`resolveEntity` сегодня возвращает `null` и для неизвестного, и для неоднозначного имени. Добавить в `entity-resolve.ts` функцию `resolveEntityDetailed(...)`: `{ status: "resolved", entity } | { status: "ambiguous", candidates: string[] } | { status: "unknown" }` — `resolveEntity` остаётся обёрткой. Неоднозначные — в `ambiguousNames`.

- [ ] **Шаг 1: Тесты** (на временной базе): (а) Writer-подобный вызов и критика-подобный вызов на одной базе дают одинаковые `previousChapters`, `previousTail`, `characterContext`; (б) знание из главы 8 отсутствует в сборке для главы 4; (в) два героя с одинаковым нормализованным именем → имя в `ambiguousNames`, ни одна карточка не подставлена; (г) `sourceRefs` содержит версию каждой предыдущей главы с текстом и ревизию каждого героя из `characterContext`; (д) AC-15: два вызова с тем же профилем стиля дают одинаковый `styleContext.prompt`.
- [ ] **Шаг 2: Убедиться в падении.**
- [ ] **Шаг 3: Реализовать** переносом кода из `plot.ts`; `plot.ts` и `chapter-prose-context.ts` — тонкие адаптеры. Порядок и текст секций Writer сохранить байт-в-байт; любое расхождение назвать в отчёте.
- [ ] **Шаг 4:** типы, тесты, коммит `refactor(context): одна сборка контекста для Writer, критики и Reviser`.

---

### Задача 5: Манифест и отпечаток; расхождение базы видно (AC-13)

**Файлы:**
- Создать: `packages/shared/src/generation-context.ts`, `packages/shared/src/generation-context.test.ts`, `apps/server/drizzle/0026_context_manifests.sql`, `apps/server/src/utils/__tests__/context-manifests.test.ts`
- Изменить: `packages/shared/src/index.ts`, `apps/server/drizzle/meta/_journal.json` (через `drizzle:new`), `apps/server/src/db/schema.ts`, `apps/server/src/utils/generation-context.ts`, `apps/server/src/routes/plot.ts`, `apps/server/src/routes/critique.ts`, `apps/web/src/api/client.ts` (тип ответа критики)

**Контракт (`packages/shared`):**

```ts
export const CONTEXT_PURPOSES = ["writer", "critique", "repair"] as const;
export const contextSourceRefSchema = z.object({
  kind: z.enum(["chapter_version", "character", "relationship", "style_profile",
                "outline", "meta_summary", "retrieval_chunk", "fact", "note", "event"]),
  id: z.number().int().nonnegative(),
  versionId: z.number().int().positive().nullable().default(null),
  revision: z.number().int().nonnegative().nullable().default(null),
});
export const contextManifestSchema = z.object({
  purpose: z.enum(CONTEXT_PURPOSES),
  sources: z.array(contextSourceRefSchema),
  includedSections: z.array(z.string()),
  droppedSections: z.array(z.object({ id: z.string(), tokens: z.number().int().nonnegative() })),
  budgetTokens: z.number().int().positive(),
  usedTokens: z.number().int().nonnegative(),
  promptVersion: z.string(),
});
/** Отпечаток НАБОРА ИСТОЧНИКОВ, не текста: представления ролей различаются
 *  намеренно, сравнивать их посимвольно нельзя. Совпал — база та же. */
export function snapshotFingerprint(sources: ReadonlyArray<ContextSourceRef>): string;
```

Тесты контракта: порядок источников не влияет; смена `versionId` меняет отпечаток; одинаковые `id` разных `kind` различаются.

**Таблица `context_manifests`:** `id`, `book_id` (FK cascade), `chapter_id` (FK cascade), `chapter_version_id` (FK cascade, nullable — у Writer версии ещё нет), `purpose`, `fingerprint`, `manifest_json`, `created_at`; индексы `(chapter_id, purpose, id)` и `(fingerprint)`. Текста секций **нет**.

**Поведение:**
- Writer после сборки пишет манифест с `purpose = 'writer'`; при принятии предложения (`acceptProposal`) манифест получает `chapter_version_id` созданной версии — одним UPDATE в той же транзакции. Без этого критика не найдёт, с чем сравнивать.
- Критика/repair собирают контекст, считают отпечаток, ищут манифест `writer` этой версии; ответ несёт `context: { fingerprint, baseChanged: boolean | null }` — `null`, когда сравнивать нечем (версия загружена импортом или написана до этапа 4). Не блокирует: автор мог осознанно поправить базу.

- [ ] **Шаг 1: Тесты** — контракт (3); хранилище: запись при генерации и привязка к версии при принятии; критика при неизменной базе → `baseChanged: false`; после новой принятой версии предыдущей главы → `true`; без манифеста → `null`.
- [ ] **Шаг 2: Падение.**
- [ ] **Шаг 3: Реализация**; `pnpm migrate` на рабочей базе с проверкой индексов.
- [ ] **Шаг 4:** типы, тесты, `pnpm build`. Коммит `feat(context): манифест источников и признак ушедшей базы`.

---

### Задача 6: Документация

**Файлы:** `CLAUDE.md`, `docs/architecture-overview.md`.

- [ ] Абзац «Общий контекст»: одна сборка; что означает отпечаток и почему он по источникам, а не по тексту; почему текст не хранится (отклонение от спеки, принято автором); что означает `requiredOverflow` и как на него отвечают Writer и критика; куда делся срез «1200 символов»; почему поиск больше не исключает недавние главы целиком. Коммит `docs: общий контекст`.

---

## Самопроверка

- **Покрытие:** 8.1 → задачи 4, 5 (без хранения текста — отклонение принято). 8.2 → задача 4 (`resolveEntityDetailed`, `ambiguousNames`). 8.3 → задачи 2, 3. 8.4 → задача 1. AC-12 → 2. AC-13 → 5. AC-14 → 1. AC-15 → тест (д) в задаче 4. AC-36 → 3.
- **Заглушек нет:** интерфейсы задач 1–5 названы полностью, тесты 1 приведены дословно, остальные — перечнем проверяемых утверждений.
- **Имена согласованы:** `requiredOverflow`, `verbatimChapterOrders`, `assembleGenerationContext`, `AssembledContext`, `resolveEntityDetailed`, `snapshotFingerprint`, `context_manifests`, `baseChanged`.

## Что в этап НЕ входит

- `SceneIntent`, проверка состава, критик персонажей — этап 5. Контракт главы — слайс 4.5.
- Панель знаний «авторское против извлечённого» — экран персонажа, отложено с этапа 3.
- Хранение текста промпта — отклонено; добавляется, когда появится читатель (экран «что видела модель»).
- Морфология русских склонений — резолвер по каноническим именам и алиасам, неоднозначность списком.
- Бюджет по возможностям конкретной модели — остаётся `MAX_WRITER_CONTEXT_TOKENS`, теперь общий для всех ролей.
