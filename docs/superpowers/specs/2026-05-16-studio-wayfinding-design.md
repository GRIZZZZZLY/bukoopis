# Studio Wayfinding — навигация, прогресс, resume

**Дата:** 2026-05-16
**Статус:** утверждён (дизайн), ожидает плана
**Топик:** убрать «слепое» перемещение по 7-стадийному пайплайну Studio — единый stepper на всех страницах, индикатор прогресса, deep-link «Продолжить» из списка книг.

## Проблема

Sub-страницы Studio (`world/lore/plot` → MarkdownStagePage, `characters/items` → EntityStagePage, `chapters`, `settings`) имеют только ссылку «← к Studio». Переход между стадиями возможен лишь через дашборд. Нет общего индикатора прогресса (7 стадий) — `computeRecommendedNextStage` подсвечивает одну карточку, но не показывает «сколько готово / что дальше». Из списка книг нельзя попасть сразу к нужному этапу — только на дашборд, далее вручную.

## Зафиксированные решения

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Паттерн навигации | Общий `<StageStepper>` на ВСЕХ studio-страницах (дашборд + подстраницы), заменяет разрозненные «← к Studio» |
| 2 | Свобода перехода | Свободный прыжок — все 7 стадий всегда кликабельны, без gating (single-user MVP) |
| 3 | Метрика прогресса | Стадия done = `status ∈ {complete, skipped}`; `concept` done = валидный концепт (reuse readiness-логики `computeRecommendedNextStage`); прогресс = doneCount/7 |
| 4 | Resume в списке | Кнопка «Продолжить →» на карточке книги (deep-link на recommended-стадию); прогресс-бар только на дашборде, не в списке; один батч-запрос, не N |

## Архитектура

### 1. Shared-ядро — `computeStudioProgress`

Файл: `packages/shared/src/studio-state.ts` (рядом с `computeRecommendedNextStage`, экспорт через `packages/shared/src/index.ts`).

```ts
export interface StudioStageProgress {
  id: StageId;
  status: "done" | "current" | "todo";
  done: boolean;
}
export interface StudioProgress {
  stages: StudioStageProgress[]; // длина 7, порядок STAGE_IDS
  doneCount: number;             // 0..7
  total: 7;
  recommended: StageId;          // === computeRecommendedNextStage(concept, studioState)
}
export function computeStudioProgress(
  concept: BookConcept,
  studioState: StudioState,
): StudioProgress;
```

Правило `done` (единственное, без альтернатив):
- `world | lore | characters | items | plot | chapters`: `studioState.stages[id]?.status` ∈ `{ "complete", "skipped" }`.
- `concept`: `done` ⟺ `computeRecommendedNextStage(concept, studioState) !== "concept"`. (Эта функция уже возвращает `"concept"` пока концепт не готов и уходит дальше когда готов — переиспользуем её как готовый предикат, никакой новой логики/извлечения `isConceptReady` не делаем.)

`status`: `done` если `done===true`; иначе `current` если `id === recommended`; иначе `todo`. (Если recommended-стадия уже done — что возможно при полностью завершённой книге — ни один сегмент не `current`; это валидно.)

`recommended` = делегирует существующей `computeRecommendedNextStage`. Никакой новой логики выбора следующей стадии.

Единственный источник истины: stepper, дашборд-прогресс и server-resume вызывают только `computeStudioProgress`.

### 2. `<StageStepper>` — переиспользуемый компонент

Файл: `apps/web/src/components/studio/StageStepper.tsx`.

Props:
```ts
interface StageStepperProps {
  bookId: number;
  concept: BookConcept;
  studioState: StudioState;
  activeStageId?: StageId; // подсветка «вы здесь»; settings/неизвестное → undefined
}
```

Рендер: `<nav aria-label="Этапы книги">` → 7 сегментов по `STAGE_IDS`. Каждый сегмент:
- иконка статуса: `✓` done, `▶` current (recommended & не done), `●` todo, `↷` если `studioState.stages[id]?.status === "skipped"` (skipped тоже считается done в метрике, но иконка отдельная для ясности);
- лейбл стадии (RU). `StageStepper` держит свою внутреннюю `STAGE_LABELS`-карту. Существующие per-page `STAGE_LABELS` в StudioPage/MarkdownStagePage НЕ рефакторим и НЕ трогаем (out of scope — не плодить рискованных правок ради DRY; принять локальную дупликацию лейблов как осознанный компромисс);
- `<Link to={stageRoute(bookId, id)}>`, активный сегмент помечен `aria-current="step"` и визуально подсвечен;
- слева/в начале компактный счётчик `doneCount/7`.

Маппинг `stageRoute(bookId, id)`:
- `concept` → `/books/${bookId}/studio`
- `world | lore | plot | characters | items` → `/books/${bookId}/studio/${id}`
- `chapters` → `/books/${bookId}/studio/chapters`

Свободный прыжок (реш. 2): **все 7 сегментов всегда `<Link>`**, без disabled/gating.

Встраивание (замена «← к Studio» / «← к книге» хедер-ссылок):
- `StudioPage` — stepper в шапке, `activeStageId="concept"` (дашборд = дом концепта).
- `MarkdownStagePage` — `activeStageId = stageId` (world/lore/plot).
- `EntityStagePage` — `activeStageId = stageId` (characters/items).
- `ChaptersStagePage` — `activeStageId="chapters"`; внутренняя ссылка «← к Studio» удаляется (stepper её заменяет).
- `SettingsStagePage` — settings НЕ стадия: stepper рендерится с `activeStageId={undefined}` (ни один не active) + сохранить отдельную ссылку «← к Studio» в шапке.

Страницы, где `concept`/`studioState` уже не загружены (например MarkdownStagePage грузит только `getStudioState`, не concept): добавить в загрузку недостающее (`getConcept`) — stepper требует оба. Грузить параллельно в существующем `Promise.all`. Bad-id guard (уже добавлен в Chapters/Settings) — stepper не рендерить пока данные не готовы.

### 3. Прогресс-бар на дашборде

`StudioPage`: под stepper'ом блок:
- полоса `[████░░░]` ширина = `doneCount/7`;
- текст: `Готово {doneCount}/7 · Далее: {STAGE_LABELS[recommended]}`;
- кнопка **«Продолжить →»** `<Link to={stageRoute(bookId, recommended)}>`.

Данные из `computeStudioProgress(concept, studio)` — concept и studio уже в state StudioPage. Если `doneCount === 7` — текст «Книга проработана», кнопка ведёт на `chapters`.

### 4. Resume из списка книг

**Server:** новый Hono-роут в `apps/server/src/routes/books.ts`:
`GET /api/books/recommended` → `{ [bookId: number]: StageId }`.
Реализация: выбрать все книги, для каждой прочитать сохранённые concept + studio_state (как это делают существующие `/concept` и `/studio-state` роуты — переиспользовать те же чтения/парсинг), вызвать shared `computeStudioProgress`, вернуть `recommended`. Книга без studio_state/concept → дефолтный `StudioState`/`BookConcept` factory → `recommended` обычно `"concept"`.

**Client:** `api.listRecommended(): Promise<Record<number, StageId>>` (`req<Record<number,StageId>>("/api/books/recommended")`).

**BooksListPage:** в `load()` грузить `listBooks` + `listRecommended` параллельно (`Promise.all`); `listRecommended` ошибается → деградировать тихо (кнопка «Продолжить» скрыта, список работает). На карточке книги: клик по названию → `/books/${id}/studio` (как сейчас, реш. 4); добавить отдельную кнопку/ссылку «Продолжить →» → `stageRoute(id, recommended[id])`. Прогресс X/7 в списке НЕ показывать (реш. 4).

Вынести `stageRoute(bookId, stageId)` в общий клиентский util (`apps/web/src/lib/studio-routes.ts`) — используется StageStepper, StudioPage, BooksListPage. Не дублировать маппинг.

## Тестирование

- **shared** `computeStudioProgress`: матрица — пустой studio (recommended=concept, done=0), частичный (несколько complete), `skipped` засчитан в done, полностью готовый (done=7), concept-ready переключает concept.done.
- **StageStepper** (vitest+RTL+MemoryRouter): рендерит 7 сегментов с корректными иконками по статусам; каждый сегмент — ссылка с правильным `to` (включая concept→/studio, chapters→/studio/chapters); активный имеет `aria-current="step"`; все кликабельны (нет disabled).
- **StudioPage**: прогресс-бар показывает doneCount/7; «Продолжить» ведёт на `stageRoute(recommended)`.
- **BooksListPage**: при `listRecommended` мок — «Продолжить» на книге linkает на route(recommended); ошибка `listRecommended` → список рендерится, кнопка скрыта.
- **server** `/api/books/recommended`: route-тест с мок-sqlite (паттерн существующих route-тестов) — возвращает map bookId→stageId; книга без studio → "concept".
- Регрессия: существующие тесты Chapters/Settings/Markdown/Entity страниц обновить под наличие stepper (доп. `getConcept` в моках, где нужно).

## Out of scope (YAGNI)

- Hard/soft-gating стадий (реш. 2 — свободный прыжок).
- Прогресс X/7 в карточках списка книг (реш. 4).
- Взвешенный по аспектам прогресс (реш. 3 — простой done/7).
- Миграции БД, изменения схемы studio_state.
- Анимации/переходы stepper (статический рендер).
- Хоткеи редактора, онбординг пустого концепта, 409-conflict UX, $/книга (отдельные будущие фичи 9-12).

## Объём

1 shared-функция (+ возможный извлечённый `isConceptReady`), 1 новый компонент `StageStepper`, 1 client-util `studio-routes.ts`, 1 server-роут + 1 client-метод, вставка stepper в 5 страниц + изменения BooksListPage/StudioPage, тесты. Без миграций.
