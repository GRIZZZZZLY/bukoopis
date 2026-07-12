# ADR 0003 — Качество памяти (P1)

Статус: **принято** (2026-07-12), реализуется слайсами.
Контекст: внешняя рецензия 2026-07-11 + ADR 0002 (P0 выполнен).

## Проблема

P0 сделал память надёжной (durable pipeline), но не точной:

1. **Реплика = факт мира.** «„Мария умерла", — сказал Иван» становится каноном,
   даже если Иван лжёт/ошибается/пересказывает слух.
2. **Слепой supersede.** Новый факт с тем же (entity, predicate) закрывает
   старый автоматически — «владеет: меч» убивает «владеет: кольцо», хотя
   владение мультизначно. Модель не может указать, ЧТО именно заменяется.
3. **Строковые сущности.** «Иван/Ивана/Ване/прозвище» — разные строки, канон
   рассыпается по падежам (русский!).
4. **Нет бюджета контекста**, retrieval дублирует rolling window, POV-знание
   не отделено от авторского.
5. **KNN-фильтр после поиска** — недобор кандидатов.
6. **Нет литературного eval-набора** — качество памяти не измеряется.

## Решение — слайсы (каждый самостоятелен)

### Слайс 1 — assertionMode + явный supersede (РЕАЛИЗОВАН в этом ADR-коммите)

- `book_facts.assertion_mode`: `narrated_as_fact | directly_observed |
  stated_by_character | believed_by_character | rumor | dream_or_vision |
  uncertain` (миграция 0015; legacy = narrated_as_fact).
- **Объективный канон** = только `narrated_as_fact` + `directly_observed`.
  `loadActiveFacts`/`renderActiveFactsPrompt` по умолчанию отдают только их —
  ложь персонажа не попадает Writer'у как истина мира. Неверифицированные
  режимы хранятся (для будущего character_knowledge/mysteries), но канон не
  трогают и ничего не supersede'ят.
- **Явный supersede:** активные факты рендерятся экстрактору с id
  (`[fact_12] …` — паттерн note_id из QW). Экстрактор возвращает
  `supersedesFactIds: ["fact_12"]`. Сервер закрывает ровно указанные
  (валидация: своя книга, открыт). Auto-supersede по одинаковому predicate
  остаётся ТОЛЬКО как fallback, когда модель ничего не указала — и только для
  объективных режимов.

### Слайс 2 — entity IDs + aliases

`book_facts.entity_id` уже существует (0012, nullable) — начать заполнять:
резолв entityName → characters/locations/items по canonical_name + новая
таблица `entity_aliases(entity_type, entity_id, alias)`; экстрактору
передавать known entities с id; фоллбэк на строку при не-резолве.

### Слайс 3 — Context Compiler (РЕАЛИЗОВАН; POV-split → 3b)

Единая сборка контекста под токен-бюджет с приоритетами, дедупом и
диагностикой (Context Inspector).

**Сделано:** `apps/server/src/utils/context-compiler.ts` — `estimateTokens`
(эвристика ~3 char/token для RU; hook под count-tokens API), `compileContext`
(required всегда, optional по приоритету пока влезает в бюджет, дропнутые
записаны), `describeCompiledContext` (одна строка в лог). Дедуп:
`gatherRetrievedChunks` получил `excludeFromChapterOrder` — не тянет чанки глав,
которые rolling window уже отдал дословно (`currentOrder - ROLLING_WINDOW`).
Проводка в Writer-путь (`plot.ts /chapters/:id/write`): бюджет
`MAX_WRITER_CONTEXT_TOKENS=80k`, приоритеты characters→rolling→lore→studio→
retrieval→style, дропнутые слои не уходят в промпт, inspector-строка в лог.

**Отложено (слайс 3b):** POV-раздел (ОБЪЕКТИВНО / ИЗВЕСТНО POV / СКРЫТО) —
нужен фильтр фактов по character_knowledge; применение компилятора к
plot-plan и reviser (repair) путям.

### Слайс 4 — KNN-фильтр внутри поиска

`chunk_vec`/`book_notes_vec` пересоздаются с metadata-колонками
(book_id, chapter_order) — фильтр внутри MATCH вместо JOIN-после (sqlite-vec
0.1.6+). Требует reindex (скрипт есть); миграция координируется с
bootstrapVirtualTables.

### Слайс 5 — литературный eval-набор

Постоянный тестовый мини-роман с ловушками (два предмета/потерян один,
падежи+прозвище, ложь о смерти, сон, флэшбек, переписанная глава 3 после
главы 8, похожие заметки, POV-секрет). Метрики: precision/recall фактов,
корректность supersede, реплика≠канон, retrieval Recall@k, отсутствие
будущего/старых версий, дубли в промпте. Гейт для смены embedding-модели,
RRF, reranker, числа глав окна.

## Вне scope P1

Полная темпоральная система (флэшбеки как timeline), автокаскадный rebuild,
knowledge-graph UI, entity-merge UI.
