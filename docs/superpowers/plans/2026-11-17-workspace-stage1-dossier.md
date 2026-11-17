# Рабочее место по образцу Litrab, этап 1: досье и письмо без плана

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель:** автор задаёт синопсис, свободное поле «Мир» и короткое «Содержание главы», и Писатель пишет главу прямо по ним, без подробного плана из битов. Критики тоже проверяют такую главу.

**Архитектура:** какой план действует, решает одна колонка `chapters.active_plan_kind`. Один доступ `chapterPlanForGeneration` отдаёт Писателю, критикам и правке одно и то же: битовый план, содержание главы или ничего. «Мир» входит в общую сборку контекста отдельной секцией. Синопсис и мир попадают в ссылки манифеста как источник `dossier`.

**Стек:** TypeScript strict, Hono + better-sqlite3, zod, vitest, React 18.

**Проект:** `docs/superpowers/specs/2026-11-17-litrab-workspace-design.md`, пункты 1, 2, 9, 13, 17.

## Глобальные ограничения

- Миграции — только SQL руками: `pnpm --filter @book-forge/server drizzle:new <name>`, затем `schema.ts`, затем `pnpm migrate`. `drizzle:generate` не трогать.
- `books.world_notes` — TEXT, не длиннее 25 000 знаков. `chapters.intent` — не длиннее 20 000.
- `chapters.active_plan_kind` принимает только `'theses' | 'beats'` или NULL; CHECK в самой колонке.
- `books.author_notes` по-прежнему не попадает ни в одну сборку контекста. Тест `litrab-borrowings.test.ts` не трогать.
- `CONTEXT_PROMPT_VERSION` меняется с `"stage4-2"` на `"stage5-dossier"`.
- Слова интерфейса — только в `apps/web/src/lib/labels.ts`.
- Регулярки по русскому тексту — без `\b` и `lower()`.
- Тест, который закреплял старое поведение, переписывается, и это названо в тексте версии.
- Версии сохранять с концовкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ни путей к хранилищу, ни ссылок на сессии в версиях и коде.

## На что смотреть при проверке

1. **Старые главы с выбранным битовым планом.** После миграции они пишутся как раньше: колонка заполнена `'beats'` из `plan_json`. Тест в задаче 1.
2. **У главы нет ни плана, ни содержания.** «Написать главу» работает и пишет продолжение от финала прошлой главы, а не отвечает 400. Режим «по беатам» без плана отвечает 400 с понятной русской причиной. Тесты в задаче 4.
3. **Содержание главы правится, пока Писатель пишет.** Отпечаток кандидата меняется (`contextFingerprint` уже включает `intent`), и автор видит предупреждение. Тест в задаче 2.
4. **Длинный «Мир» не выталкивает карточки персонажей.** Секция «Мир» необязательная, приоритет 3: при переполнении выпадает она, а не обязательный слой. Тест в задаче 3.
5. **Отчёт критиков по главе без плана говорит об этом.** `planBasis` в отчёте и строка в панели. Тесты в задаче 5.

---

### Задача 1: колонки `world_notes` и `active_plan_kind`, правимое `intent`

**Файлы:**
- Создать: `apps/server/drizzle/NNNN_dossier.sql` (через `drizzle:new dossier`)
- Изменить: `apps/server/src/db/schema.ts` (books, chapters), `apps/server/src/db/rows.ts` (`BookRow`, `ChapterRow`, `toBook`, `toChapter`)
- Изменить: `packages/shared/src/book.ts` (`bookSchema`, `updateBookInputSchema`), `packages/shared/src/chapter.ts` (`chapterSchema`, `updateChapterInputSchema`)
- Изменить: `apps/server/src/routes/books.ts` (PATCH), `apps/server/src/routes/chapters.ts` (PATCH), `apps/server/src/routes/plot.ts` (`/plan/select`)
- Тесты: `apps/server/src/routes/__tests__/books.test.ts`, `chapters.test.ts`, `plot.test.ts`

**Интерфейсы:**
- Даёт: `BookRow.world_notes: string | null`, `Book.worldNotes: string | null`; `ChapterRow.active_plan_kind: "theses" | "beats" | null`, `Chapter.activePlanKind`; `UpdateBookInput.worldNotes?: string | null`; `UpdateChapterInput.intent?: string | null`.

- [ ] **Шаг 1. Падающие тесты.**
  - `books.test.ts` › «PATCH сохраняет worldNotes и отвергает 25 001 знак»: PATCH `{worldNotes:"Станция «Пустельга»…"}` → 200, GET отдаёт то же; `"x".repeat(25001)` → 400.
  - `chapters.test.ts` › «PATCH правит intent, пустая строка хранится как null»: `{intent:"Лис идёт к шлюзам"}` → 200 и `chapter.intent` совпадает; `{intent:""}` → 200 и `intent === null`; 20 001 знак → 400.
  - `plot.test.ts` › «выбор варианта плана ставит activePlanKind = beats»: после `POST /chapters/:id/plan/select {selectedIndex:0}` → `chapter.activePlanKind === "beats"`.
  - `plot.test.ts` › «повторная генерация плана не меняет activePlanKind»: после select и нового `POST /plan` колонка по-прежнему `"beats"`.
- [ ] **Шаг 2.** `pnpm --filter @book-forge/server test -- src/routes/__tests__/books.test.ts src/routes/__tests__/chapters.test.ts src/routes/__tests__/plot.test.ts` — новые тесты падают.
- [ ] **Шаг 3. Миграция.**
  ```sql
  ALTER TABLE books ADD COLUMN world_notes TEXT;
  ALTER TABLE chapters ADD COLUMN active_plan_kind TEXT
    CHECK (active_plan_kind IN ('theses','beats'));
  UPDATE chapters SET active_plan_kind = 'beats'
    WHERE plan_json IS NOT NULL
      AND json_valid(plan_json)
      AND json_extract(plan_json, '$.selectedIndex') IS NOT NULL;
  ```
  Схемы и строки — под новые поля. В `updateBookInputSchema`: `worldNotes: z.string().max(25000).nullable().optional()`. В `updateChapterInputSchema` (strictObject): `intent: z.string().max(20000).nullable().optional()`; пустая строка после `trim()` хранится как NULL. Маршрут `/plan/select` в том же UPDATE ставит `active_plan_kind = 'beats'`. Заодно PATCH книги двигает `books.updated_at`: на этом держится отпечаток кандидата.
- [ ] **Шаг 4.** `pnpm migrate`, затем тесты из шага 2 — проходят.
- [ ] **Шаг 5. Версия.** `feat(dossier): поле «Мир», правимое содержание главы, явный действующий план`.

### Задача 2: один доступ к плану главы

**Файлы:**
- Создать: `apps/server/src/utils/chapter-plan.ts`
- Тест: `apps/server/src/utils/__tests__/chapter-plan.test.ts`

**Интерфейсы:**
- Берёт: `ChapterRow.active_plan_kind`, `plan_json`, `intent` (задача 1).
- Даёт:
  ```ts
  export type GenerationPlan =
    | { kind: "beats"; variant: ChapterBeatSheetVariant }
    | { kind: "intent"; intent: string }
    | { kind: "none" };
  export function chapterPlanForGeneration(ch: Pick<ChapterRow, "active_plan_kind" | "plan_json" | "intent">): GenerationPlan;
  ```

- [ ] **Шаг 1. Падающие тесты** (`chapter-plan.test.ts`):
  - `active_plan_kind="beats"` и разбираемый выбранный вариант → `{kind:"beats"}` с этим вариантом;
  - `active_plan_kind="beats"`, но `plan_json` битый или `selectedIndex=null` → откат к intent, если он есть, иначе `{kind:"none"}`;
  - `active_plan_kind=null`, `intent="  Лис идёт  "` → `{kind:"intent", intent:"Лис идёт"}`;
  - `active_plan_kind="theses"` (этап 2 ещё не сделан) → ведёт себя как null;
  - всё пусто → `{kind:"none"}`.
- [ ] **Шаг 2.** Запустить файл — падает (модуля нет).
- [ ] **Шаг 3.** Реализовать. Вариант разбирать `chapterBeatSheetVariantSchema.safeParse`, а не доверять приведению типа.
- [ ] **Шаг 4.** Тесты проходят.
- [ ] **Шаг 5. Версия.** `feat(plan): единый доступ к действующему плану главы`.

### Задача 3: «Мир» в сборке и источник `dossier` в манифесте

**Файлы:**
- Изменить: `apps/server/src/utils/generation-context.ts` (секции `compileContext`, `sourceRefs`, `AssembledContext`)
- Изменить: `packages/shared/src/generation-context.ts` (`CONTEXT_SOURCE_KINDS`, `CONTEXT_PROMPT_VERSION`)
- Тест: `apps/server/src/utils/__tests__/generation-context.test.ts`

**Интерфейсы:**
- Даёт: `AssembledContext.worldContext: string | null`. Текст вида `## Мир книги (записи автора)\n<world_notes>`; `null`, если поле пустое или секция выпала из бюджета.
- Даёт: источник `{kind:"dossier", id: book.id, versionId:null, revision: hash32(JSON.stringify([premise, world_notes]))}`.

- [ ] **Шаг 1. Падающие тесты:**
  - «worldContext несёт записи автора»: книга с `world_notes="Воздух продают по счётчику"` → `assembled.worldContext` содержит эту строку;
  - «смена синопсиса меняет отпечаток»: `snapshotFingerprint(sourceRefs)` до и после `UPDATE books SET premise=…` различаются (сейчас не различаются — это и есть найденная дыра);
  - «длинный мир выпадает первым»: при `MAX_PROSE_CONTEXT_TOKENS`, уменьшенном как в соседнем тесте переполнения, и `world_notes` на 25 000 знаков → `compiled.dropped` содержит `world`, а `requiredOverflow === false`;
  - «манифест несёт версию stage5-dossier».
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3. Реализация.**
  - Секция `{ id: "world", text, priority: 3 }` рядом с `lore`.
  - `"dossier"` — в `CONTEXT_SOURCE_KINDS` и в список `bookRefs`.
  - Поднять `CONTEXT_PROMPT_VERSION`.
  - `worldContext` добавить в `bookContextBase`, когда секция вошла: так его видят критики через `chapter-prose-context.ts`.
- [ ] **Шаг 4.** Тесты файла проходят; `pnpm --filter @book-forge/shared test` проходит.
- [ ] **Шаг 5. Версия.** `feat(context): мир книги в сборке, синопсис и мир в отпечатке источников`.

### Задача 4: Писатель без плана

**Файлы:**
- Изменить: `packages/agents/src/writer.ts` (`WriteChapterInput`, `buildWriterVolatilePrompt`, `buildWriterStableSystem`)
- Изменить: `apps/server/src/routes/plot.ts` (`POST /chapters/:id/write`)
- Тесты: `packages/agents/src/__tests__/writer-prompt.test.ts`, `apps/server/src/routes/__tests__/write-proposal.test.ts`, `write-beats.test.ts`

**Интерфейсы:**
- Берёт: `chapterPlanForGeneration` (задача 2), `assembled.worldContext` (задача 3).
- Даёт: `WriteChapterInput.beatSheet: ChapterBeatSheetVariant | null`, `WriteChapterInput.chapterContent?: string | null`, `WriteChapterInput.worldContext?: string | null`.

- [ ] **Шаг 1. Падающие тесты.**
  - `writer-prompt.test.ts`:
    - «без плана, с содержанием»: `beatSheet:null, chapterContent:"Лис идёт к седьмому шлюзу"` → изменчивая часть содержит `Содержание главы (что в ней должно произойти):\nЛис идёт к седьмому шлюзу` и `Напиши главу.`, и **не** содержит `POV:`, `План событий`, `Целевой объём`;
    - «без плана и без содержания» → содержит `Содержание главы не задано: продолжи книгу от финала предыдущей главы, держи её линии и героев.`;
    - «мир в устойчивой части»: `worldContext` попадает в `buildWriterStableSystem` после карточек.
  - `write-proposal.test.ts`:
    - «пишет по содержанию главы без plan_json» → 200, событие `proposal`, `runChapterWriter` вызван с `beatSheet:null` и `chapterContent`;
    - «без плана и без содержания всё равно пишет» → 200.
    - Прежний тест на 400 `no plan available` переписывается под новое поведение; это названо в версии.
  - `write-beats.test.ts`: «по беатам без битового плана — 400» с сообщением `«По беатам» нужен подробный план главы`.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3. Реализация.**
  - Маршрут берёт `chapterPlanForGeneration(ch)` вместо прямого чтения `plan_json`.
  - Ветка `beats` — без изменений.
  - Для `intent`/`none`: `scanTexts=[intent ?? ""]`, `retrievalQuery = intent ?? ch.title`, `povName=null`.
  - Замысел сцены считается по `intent` вместо `beatBlob`, `chapterContract=null`.
  - `renderBeatForWriter` и блок по беатам не трогать.
  - `beatSheetForWriter` и подмену POV делать только для `kind:"beats"`.
- [ ] **Шаг 4.** Тесты трёх файлов проходят; `pnpm --filter @book-forge/agents test` проходит.
- [ ] **Шаг 5. Версия.** `feat(writer): глава пишется по содержанию или от финала прошлой, без подробного плана`.

### Задача 5: критики и правка по тому же доступу

**Файлы:**
- Изменить: `apps/server/src/utils/chapter-prose-context.ts`
- Изменить: `packages/shared/src/critique.ts` (`fullCritiqueReportSchema`), `apps/server/src/routes/critique.ts`
- Изменить: панель критиков в `apps/web/src/components/chapter/` (файл с `CritiquePanel`) и `apps/web/src/lib/labels.ts`
- Тесты: `apps/server/src/routes/__tests__/critique.test.ts`, `repair-context.test.ts`, тест панели критиков

**Интерфейсы:**
- Берёт: `chapterPlanForGeneration` (задача 2).
- Даёт: `ChapterProseContext.planBasis: "beats" | "intent" | "none"`, `FullCritiqueReport.planBasis?: "beats" | "intent" | "none"`; подпись `PLAN_BASIS_LABELS` в `labels.ts`:
  - `intent` → «Плана не было — проверено по содержанию главы»;
  - `none` → «Плана и содержания не было — проверено по прошлым главам и карточкам».

- [ ] **Шаг 1. Падающие тесты.**
  - `critique.test.ts`:
    - «глава с intent без плана: отчёт с planBasis=intent»; в промпт критикам уходит `Содержание главы: …`;
    - «старая глава с выбранным битовым планом: planBasis=beats и тот же контракт, что раньше».
  - `repair-context.test.ts`: правка по главе с intent видит тот же `Содержание главы: …`.
  - Тест панели: отчёт с `planBasis:"intent"` → первой строкой подпись из `PLAN_BASIS_LABELS.intent`; у отчёта без поля строки нет.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3. Реализация.**
  - `loadChapterProseContext` берёт план из `chapterPlanForGeneration`. Для `intent` отдаёт `beatSheet = "Содержание главы: <intent>"`, `chapterContract = null`, `pov = "—"`.
  - Маршрут критики пишет `planBasis` в отчёт.
  - `planBasis` в схеме необязательный: старые отчёты читаются.
- [ ] **Шаг 4.** Тесты проходят.
- [ ] **Шаг 5. Версия.** `feat(critique): критики и правка видят тот же план, что Писатель; отчёт называет основу проверки`.

### Задача 6: временные поля досье в интерфейсе и правка CLAUDE.md

Полноценное досье слева — этап 3. Здесь минимум, чтобы этап 1 был пригоден автору уже сейчас.

**Файлы:**
- Изменить: `apps/web/src/pages/SettingsStagePage.tsx`: раздел «Досье» с полями «Синопсис» (`premise`) и «Мир» (`worldNotes`), сохраняются той же кнопкой.
- Изменить: `apps/web/src/components/PlanPanel.tsx`: при пустом intent вместо отказа поле «Содержание главы» с кнопкой «Сохранить» (`api.updateChapter(id,{intent})`). При заполненном intent — «Изменить».
- Изменить: `apps/web/src/pages/ChapterPage.tsx`: кнопка «Написать главу» больше не выключается без плана. Подсказка: «Будет написано по содержанию главы» / «Содержания нет — модель продолжит от прошлой главы». Пункт «По беатам» выключен без битового плана.
- Изменить: `apps/web/src/lib/labels.ts`, `apps/web/src/api/client.ts` (типы `worldNotes`, `intent`, `activePlanKind`).
- Изменить: `CLAUDE.md`, строка про «Добавить материалы»: «два режима; по умолчанию платный приём с моделью; режим без модели пишет главы версиями и ставит задачи памяти».
- Тесты: `SettingsStagePage.test.tsx`, тест `PlanPanel`, `apps/web/src/__tests__/zero-to-chapter.guard.test.tsx`

- [ ] **Шаг 1. Падающие тесты.**
  - `SettingsStagePage.test.tsx` › «сохраняет синопсис и мир»: ввод в оба поля → `updateBook` вызван с `{premise, worldNotes}`.
  - Тест `PlanPanel` › «без содержания показывает поле и сохраняет его»: `updateChapter` вызван с `{intent:"Лис идёт к шлюзам"}`.
  - Тест `ChapterPage` › «Написать главу доступна без плана»: кнопка не `disabled` при `planJson=null`; пункт «По беатам» `disabled`.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3.** Реализовать по списку файлов.
- [ ] **Шаг 4.** Проверка:
  - `pnpm typecheck` чисто;
  - `pnpm test` проходит целиком, `zero-to-chapter.guard` тоже (подписи «Написать главу», «Утвердить план», «Собрать всё до первой главы» не менялись);
  - вручную: книга «Космо вор» (id 4), глава «Проверка» — вписать содержание, нажать «Написать главу» и увидеть кандидата.
- [ ] **Шаг 5. Версия.** `feat(web): поля досье и содержание главы; запись главы без плана`.
