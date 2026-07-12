# ADR 0002 — Надёжный пайплайн памяти (P0)

Статус: **реализовано** (принято и выполнено 2026-07-12; шаги 3–7 в коде, 10/10 gate-тестов зелёные)

> Замечания реализации: (1) materialize-идемпотентность решена журналом
> `studio_events` в той же транзакции + replay по (aspectId, tempIds) — слияние
> materialize и PATCH studio_state в один HTTP-вызов не делалось (осознанный
> остаток, риск закрыт идемпотентностью и транзакцией); (2) сброс stale-маркера:
> re-commit только отредактированной главы очищает маркер после её
> re-активации — полная переэкстракция даунстрима остаётся явным действием
> «Перестроить с главы N» (см. maybeClearMemoryStale).
Контекст: архитектурный аудит 2026-07-05 + внешняя рецензия 2026-07-11.
Заменяет: fire-and-forget экстракторы из memory-upgrade (2026-05-14).

## Проблема

Память книги (chunks/summary/facts/notes) — ядро ценности продукта, но строится
наименее надёжным способом:

1. **Fire-and-forget без ретраев.** Упавший экстрактор = молчаливая дыра в каноне.
   Следующая глава строится на неполном состоянии, автор не знает.
2. **Подтверждённая регрессия finalize-gate:** автосейв двигает
   `chapters.current_version_id` на неиндексированную версию
   ([chapters.ts:121](../../apps/server/src/routes/chapters.ts)), фильтр retrieval
   `ch.current_version_id = c.source_id` перестаёт матчить чанки → глава выпадает
   из поиска до следующего Ctrl+S.
3. **Version-спам:** каждый автосейв (10с) создаёт полноценную immutable-версию —
   сотни технических версий за сессию.
4. **Нет provenance:** facts/notes не привязаны к версии главы — нельзя ответить,
   из какой редакции извлечён факт.
5. **Нет инвалидации:** правка ранней главы не помечает зависимую память устаревшей.
6. **Частичное применение:** экстракторы пишут напрямую в активные таблицы;
   сбой посередине = канон изменён наполовину.
7. **Гонка stateful-экстракторов:** facts/notes главы N могут читать состояние
   до того, как записаны факты главы N-1.

## Решение — семантика состояний (инварианты)

### I1. Три состояния текста главы

```
chapter_drafts (новая таблица)   — изменяемый рабочий текст, автосейв = UPSERT
chapters.current_version_id     — последняя зафиксированная immutable-версия
chapters.memory_version_id      — последняя версия, по которой ПОЛНОСТЬЮ
                                  активирована память (новая колонка)
chapters.status                 — редакционный статус (draft|in_review|final),
                                  НЕ означает «проиндексировано»
```

Терминология UI: «Зафиксировать версию» (commit) — создаёт immutable-версию и
memory-jobs. Слово «finalize» уходит из API сохранения (поле остаётся в схеме до
миграции клиента, но семантика = commit). «Финализировать главу» = только
`chapter.status`.

### I2. Активная память читается по `memory_version_id`

- Retrieval-фильтр чанков: `ch.memory_version_id = c.source_id`
  (вместо `current_version_id`). Пока новая версия обрабатывается, retrieval
  продолжает видеть предыдущую полностью обработанную — глава не исчезает.
  Это же закрывает регрессию из «Проблема-2».
- Facts/notes: активны только записи, материализованные активацией (см. I4),
  с `source_chapter_version_id`, указывающим на активированную версию.

### I3. Version-scoped jobs + пере-проверка актуальности

Каждое задание привязано к `chapter_version_id`. После внешнего вызова (LLM/ONNX)
worker перепроверяет: если `current_version_id` главы уже другой — job получает
статус `obsolete`, staged-результат сохраняется как исторический, **активная
память не меняется**.

### I4. Атомарная активация версии целиком

Обработчики пишут только **staged/version-scoped outputs**:

```
index   → chunks/chunk_vec (version-scoped по source_id — уже так)
summary → chapter_versions.summary (инертно до активации)
facts   → memory_jobs.result_json (staged payload)
notes   → memory_jobs.result_json (staged payload)
```

Когда все обязательные kinds для (chapter, version) = done —
`tryActivateMemoryVersion(chapterId, versionId)` одной транзакцией:

```
BEGIN IMMEDIATE
  проверить: chapters.current_version_id == versionId   (иначе obsolete, выход)
  материализовать facts из staged payload (insert + supersede старых)
  материализовать notes из staged payload (insert + resolve по note_id)
  chapters.memory_version_id = versionId
  записать событие (лог/таблица событий)
COMMIT
```

Никакого состояния «facts новые, notes старые».

### I5. Порядок stateful-экстракторов

`facts`/`notes` главы N выполняются только когда для всех глав с меньшим
`order_index` соответствующая память активирована или явно недостижима
(нет зафиксированных версий / глава пропущена). Первая реализация проще:
**worker с concurrency=1 забирает stateful-jobs строго по `order_index`**;
упавший facts-job главы 4 блокирует facts главы 5 (index/summary не блокирует).

### I6. Book-level инвалидация

Новая колонка `books.memory_stale_from_chapter_order` (nullable).
Коммит версии главы N при существовании активированной памяти глав > N:

```
memory_stale_from = min(existing, N)
```

Политика при stale:
- сырой текст глав и retrieval по chunks остаются доступными (это реальная рукопись);
- facts/notes, извлечённые из глав ≥ stale-точки, помечаются в промпте как
  «возможно устарели» (или исключаются — решается на реализации Context-блока);
- Writer получает явное предупреждение в системном контексте;
- UI: «Память устарела начиная с главы N» + действие «Перестроить с главы N»
  (re-enqueue jobs по порядку). Автокаскад — вне P0.

Сброс: успешная активация всех глав ≥ stale-точки → `memory_stale_from = NULL`.

## Схема БД (миграция 0014, plain-SQL по процессу docs/migrations.md)

```sql
CREATE TABLE memory_jobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id            INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id         INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_version_id INTEGER NOT NULL REFERENCES chapter_versions(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('index','summary','facts','notes','rollup')),
  pipeline_version   INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','retry','done','error','obsolete')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  run_after          TEXT,            -- ISO; backoff
  started_at         TEXT,
  finished_at        TEXT,
  last_error         TEXT,
  result_json        TEXT,            -- staged output (facts/notes payload)
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (chapter_version_id, kind, pipeline_version)
);
CREATE INDEX idx_memory_jobs_claim ON memory_jobs (status, run_after, book_id);
CREATE INDEX idx_memory_jobs_version ON memory_jobs (chapter_version_id, kind);

ALTER TABLE chapters ADD COLUMN memory_version_id INTEGER
  REFERENCES chapter_versions(id) ON DELETE SET NULL;
ALTER TABLE books ADD COLUMN memory_stale_from_chapter_order INTEGER;

-- source_version_id УЖЕ существует и на book_facts (0012), и на book_notes
-- (0013) — использовать её как provenance, дубликат не заводить.
-- Добавляется только origin (обе таблицы):
ALTER TABLE book_facts ADD COLUMN origin TEXT NOT NULL DEFAULT 'extracted'
  CHECK (origin IN ('manual','studio','extracted','legacy'));
ALTER TABLE book_notes ADD COLUMN origin TEXT NOT NULL DEFAULT 'extracted'
  CHECK (origin IN ('manual','studio','extracted','legacy'));

CREATE TABLE chapter_drafts (
  chapter_id      INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  content_json    TEXT NOT NULL,
  content_text    TEXT NOT NULL,
  word_count      INTEGER NOT NULL,
  base_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL
);
```

**Legacy-данные:** существующим facts/notes НЕ придумываем provenance:
`origin = 'legacy'` (их старый `source_version_id` остаётся как есть —
best-effort история). Существующим главам `memory_version_id =
current_version_id`, только если для этой версии реально есть chunks —
выражается прямо в SQL миграции (UPDATE … WHERE EXISTS(chunks…)); иначе NULL +
книга помечается stale с первой такой главы. Честная одноразовая перестройка
вместо ложной привязки. Реализовано в `0014_memory_pipeline.sql`.

## Worker

- **Один in-process worker, concurrency = 1.** Без Redis, отдельных процессов,
  DAG-движка, generic-очередей. Поддерживаемая модель — один локальный процесс.
- Старт приложения: `running → retry` (зависшие после краша).
- Цикл: короткая claim-транзакция (`pending|retry`, `run_after <= now`,
  stateful — по order_index) → внешний вызов ВНЕ транзакции → короткая
  транзакция «staged output + status=done» (одна — сбой не даёт
  «результат записан, job не завершён») → если все kinds версии done →
  `tryActivateMemoryVersion`.
- Enqueue — внутри той же транзакции, что и `INSERT chapter_versions`
  (коммит атомарен: версия+jobs или ничего).

### Retry-политика

Ретраить (экспоненциальный backoff через `run_after`, лимит 5 попыток):
сеть, 429, 5xx, временная недоступность модели/эмбеддера.

НЕ ретраить (сразу `error`): невалидный structured output после исчерпания
repair, несовместимая схема, отсутствующая глава/версия, нарушенный инвариант.
`error` виден в UI с действием «Повторить» (re-enqueue attempts=0).

### Деградация эмбеддингов

FTS-only — допустимая деградация (ADR-совместимо с фиксами 2026-07-11):
`index`-job при недоступном эмбеддере вставляет чанки без векторов и
завершается `done` (с пометкой в result_json), не `error`.

### Rollup

`rollup` — отдельный kind, book-scoped, enqueue после успешной активации версии
(зависит от summary). Падение rollup не блокирует активацию.

## Автосейв / коммит (после внедрения chapter_drafts)

```
Автосейв (10с):  UPSERT chapter_drafts            — никаких версий, никаких jobs
Ctrl+S (commit): BEGIN
                   INSERT chapter_versions (snapshot драфта)
                   UPDATE chapters.current_version_id
                   INSERT memory_jobs (index, summary, facts, notes)
                 COMMIT
                 после: draft.base_version_id = newVersionId (или очистка)
Загрузка главы:  draft, если новее current_version; иначе current_version
```

`createChapterVersionInputSchema.finalize` при этом умирает: POST /versions
всегда = commit; автосейв уходит на новый PUT /chapters/:id/draft.

## Статус памяти в UI (per-chapter)

Выводится из (`draft.updated_at` vs `current_version`, `memory_version_id`,
jobs версии, `memory_stale_from`):

```
Текст сохранён                     — draft == current, память актуальна
Есть изменения, не в памяти        — draft новее current_version
Память обновляется                 — jobs pending/running/retry
Память актуальна                   — memory_version_id == current_version_id
Ошибка обновления памяти [Повторить] — есть error-job
Память устарела с главы N [Перестроить] — book stale-маркер
```

## Атомарная Studio-материализация (независимое изменение)

```
BEGIN IMMEDIATE
  проверить expectedRevision          (внутри транзакции, не до неё)
  вставить/обновить characters/items  (идемпотентно: стабильные entity-ключи
                                       из accepted payload, не повторный INSERT)
  обновить studio_state (+emits.entityIds в том же persist)
  revision + 1
  записать studio_event
COMMIT
```

Закрывает: частичную материализацию, осиротевшие сущности (две HTTP-операции →
одна), дубликаты при retry после сетевой ошибки.

## Обязательные тестовые сценарии (gate готовности)

1. Commit атомарен: версия+jobs или ничего.
2. Повтор запроса не создаёт дубли jobs (UNIQUE).
3. Крах после claim: рестарт → `running→retry` → job выполняется.
4. Крах между LLM-ответом и записью: output+done атомарны.
5. Новая версия во время обработки старой: старый job → `obsolete`,
   активная память не меняется.
6. Пока новая версия обрабатывается — retrieval видит прежний `memory_version_id`.
7. Facts главы 5 не активируются раньше facts главы 4.
8. Частичный отказ (index+summary done, notes error): UI показывает частичное
   состояние, retry доступен, активации нет.
9. Эмбеддер недоступен → index-job done (FTS-only), не error.
10. Правка ранней главы → `memory_stale_from` установлен, UI не показывает
    «память актуальна».

## Последовательность реализации

```
Шаг 3. Миграция 0014 (schema foundation, без поведения)
Шаг 4. Worker + enqueue в commit-транзакции + retry/восстановление
       (старый fire-and-forget удаляется только после зелёных тестов 1-5)
Шаг 5. Staged outputs + tryActivateMemoryVersion + retrieval через
       memory_version_id + UI-статусы + stale-маркер (тесты 6-10)
Шаг 6. chapter_drafts + смерть finalize-флага (убирает version-спам
       и регрессию current_version_id)
Шаг 7. Атомарная Studio-материализация (отдельный коммит, не смешивать с worker)
```

## Вне scope P0 (сознательно)

Параллельные workers, Redis/внешняя очередь, DAG-движок, dead-letter таблица,
автокаскадный rebuild, entity IDs / assertionMode / иерархия происхождения
канона (P1), Context Compiler (P1), сегментные summaries (P2).

## Связанные документы

- [docs/architecture-overview.md](../architecture-overview.md) — общий обзор (§7 память)
- [docs/migrations.md](../migrations.md) — процесс plain-SQL миграций
- ADR 0001 — стек и структура
