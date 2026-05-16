# Studio как единый UI — полное слияние BookPage

**Дата:** 2026-05-16
**Статус:** утверждён (дизайн), ожидает реализации
**Топик:** устранение дублирующего «первоначального этапа создания книги»; Studio становится единственным входом.

## Проблема

На `/books/:id/studio` карточка стадии «Главы» ведёт на старый `/books/:id` (`BookPage`).
`BookPage` содержит textarea «Замысел» (`books.premise`) — параллельное хранилище идеи,
которое **не синхронизируется** с `books.concept` (канон Studio) и Plot/Writer его не читают
(они берут `loadStudioContext` → только `concept`). Итог: дубль данных, мёртвое поле,
два конкурирующих UI для одной книги.

Корень: нет страницы стадии «Главы» в Studio — `StudioPage.tsx:127` роутит `chapters`
на старый `BookPage` как заглушку.

## Решение (зафиксированные decisions)

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Структура слитого Studio | Отдельные роуты: `/studio` дашборд, `/studio/settings`, `/studio/chapters` |
| 2 | Колонка `books.premise` | Оставить мёртвой. Без миграции, без серверных изменений |
| 3 | После создания книги | `navigate('/books/${id}/studio')` сразу |
| — | Направление | Полное слияние: `BookPage` удаляется, `/books/:id` → redirect `/studio` |

## Архитектура

### 1. Роутинг / навигация (`apps/web/src/App.tsx`)

- Удалить import `BookPage`.
- Route `/books/:bookId`: заменить `<BookPage />` на redirect-компонент
  `<Navigate to={`/books/${bookId}/studio`} replace />` (обёртка с `useParams`,
  по образцу существующего `StagePageDispatch`).
- Добавить routes:
  - `/books/:bookId/studio/settings` → `SettingsStagePage`
  - `/books/:bookId/studio/chapters` → `ChaptersStagePage`
- `/books/:bookId/studio/:stageId` (`StagePageDispatch`) **не** перехватывает
  `settings`/`chapters`: react-router-dom@7 ранжирует роуты по специфичности
  (статический сегмент > параметрический), порядок в массиве не важен. Доп.
  страховка: ранний `if (stageId === "settings" || stageId === "chapters") return null`
  в `StagePageDispatch` не требуется, но допустим как defensive-guard.

### 2. StudioPage (`apps/web/src/pages/StudioPage.tsx`)

- Убрать link «← к книге» (line 94 — ведёт на удаляемый `/books/:id`).
- Шапка дашборда: две кнопки-ссылки `⚙ Настройки` → `/books/:id/studio/settings`,
  `📚 Главы` → `/books/:id/studio/chapters`.
- Карточка стадии `chapters` (lines 119–128): `href = /books/:id/studio/chapters`
  (убрать ветку `id === "chapters" ? /books/:id`).

### 3. ChaptersStagePage (новый, `apps/web/src/pages/ChaptersStagePage.tsx`)

Извлекается из `BookPage`:
- Список глав + форма «+ Новая глава» (`api.createChapter`) + dnd-reorder.
  Перенести компоненты `SortableChapterList`, `SortableChapterItem` как есть.
- Панели: `OutlinePanel`, `KnowledgePanel`, `ImportExportPanel`, `SearchPanel`.
- Шапка: «← Studio» → `/books/:id/studio` (паттерн `MarkdownStagePage`:
  загрузка `Promise.all`, skeleton/error, alive-guard).

### 4. SettingsStagePage (новый, `apps/web/src/pages/SettingsStagePage.tsx`)

Извлекается из `BookPage`:
- Поля: title, status, styleProfile, writerModel, plotModel, criticModel,
  writerProvider, writerLocalModel.
- Прогноз стоимости (`estimatePerChapterUsd`, `PER_CHAPTER_TOKENS`, `MODEL_API_ID`).
- Кнопка «Удалить книгу» + `ConfirmDialog` (после удаления `navigate('/books')`).
- **Без** textarea «Замысел». `api.updateBook(...)` вызывается **без поля `premise`**
  (сервер `books.ts` PATCH трактует `premise === undefined` как «не менять» — безопасно).
- Шапка: «← Studio» → `/books/:id/studio`.

### 5. Прочие правки

- `BooksListPage.tsx`: `onCreate` → после `createBook` (возвращает `Book` с `id`, 201)
  `navigate('/books/${created.id}/studio')`. Ссылка списка (line 136)
  `to={`/books/${b.id}/studio`}` (прямой путь, без лишнего redirect-хопа).
- `ChapterPage.tsx:502` «← к книге» → `/books/:bookId/studio/chapters`.
- `BookPage.tsx` — **удалить файл**. Извлечённые утилиты (`estimatePerChapterUsd`,
  `PER_CHAPTER_TOKENS`, `MODEL_API_ID`) разместить в общем
  `apps/web/src/lib/chapter-cost.ts` (используется `SettingsStagePage`).

### 6. Данные

- `books.premise` остаётся в схеме. `books.ts` INSERT продолжает писать `NULL`.
  Тип `Book.premise` остаётся optional. Import-export не трогаем. Миграций нет.
  Чистку колонки отложить до ремонта Drizzle snapshot (broken since 0008).

## Тестирование

BookPage-теста нет → риск низкий. Добавить (мок `api` по образцу studio-тестов):
- `ChaptersStagePage`: рендер списка глав, add-форма, reorder → `api.updateChapter` вызван.
- `SettingsStagePage`: рендер; `Сохранить` → `api.updateBook` вызван **без ключа `premise`**;
  delete-диалог → `api.deleteBook` + navigate `/books`.
- Redirect: рендер route `/books/:id` → редиректит на `/books/:id/studio`.
- `BooksListPage`: create → `navigate` на `/books/${id}/studio`.

## Out of scope (YAGNI)

- Drop колонки `premise`, миграция 0014, backfill premise→concept.
- Серверные изменения (`books.ts` остаётся как есть).
- Рефактор панелей Outline/Knowledge/Import/Search (переносятся as-is).
- Перенос настроек/глав внутрь дашборда одной страницей (отклонено в пользу отдельных роутов).

## Объём

3 новых файла (`ChaptersStagePage`, `SettingsStagePage`, `lib/chapter-cost.ts`),
~5 правок (`App.tsx`, `StudioPage.tsx`, `BooksListPage.tsx`, `ChapterPage.tsx`),
удаление `BookPage.tsx`, новые тесты. Без миграций БД, без серверных правок.
