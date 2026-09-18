# Этап 3 «Сцены и память»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У памяти появляется граница. Что персонаж знает, считается на момент сцены, а не «вообще»; секрет из главы 8 не может попасть в подготовку главы 4; каждая извлечённая запись несёт доказательство в неизменяемом тексте версии, и без него не активируется.

**Architecture:** Всё новое — один слой событий персонажа (`character_events`) поверх уже существующего конвейера памяти: очередь `memory_jobs`, staged-результат в `result_json`, атомарная активация и `pipeline_version` переиспользуются без изменений формы. Задание `facts` расширяется вторым разделом ответа вместо нового вида задания — новый вид потребовал бы пересборки таблицы, потому что список зашит в SQL `CHECK`. Знания читаются **через join к главам**, а не через денормализованный номер: перестановка глав тогда не оставляет тихо неверную границу. Отдельно чинятся два подтверждённых дефекта сводки ранних глав.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Hono, better-sqlite3, zod 4, vitest.

**Spec:** [docs/superpowers/specs/2026-09-05-character-individuality.md](../specs/2026-09-05-character-individuality.md) — разделы 5.4, 6, 7, 12; этап 3 таблицы раздела 18; критерии AC-07, AC-09, AC-10, AC-11, AC-21–26, AC-33, AC-34.

## Global Constraints

- Русский в комментариях, в сообщениях об ошибках и во всём, что видит автор; английские идентификаторы.
- TypeScript strict с `noUncheckedIndexedAccess`. ESM: относительные импорты внутри пакета оканчиваются на `.js`.
- Новых зависимостей не добавлять.
- **Проект только для настольного экрана.** Вёрстка уже 768px не важна.
- **Схема чтения никогда не бросает исключение.** Любая функция, разбирающая JSON из строки базы, вызывается на пути чтения; одно исключение там означает, что книга перестала открываться. Три предыдущих этапа потратили по раунду ревью на этот класс ошибки — не заводить его заново.
- **Нового вида задания в `memory_jobs` не появляется.** Список видов зашит в `CHECK(kind IN ('index','summary','facts','notes','rollup'))`, а SQLite не меняет `CHECK` через `ALTER TABLE`: новый вид означает пересборку таблицы. Решение 6 ТЗ: расширяем контракт задания `facts`. `COMMIT_JOB_KINDS` не меняется.
- **`MEMORY_PIPELINE_VERSION` поднимается до 2.** Уже обработанные версии должны переразобраться новым контрактом; строки `memory_jobs` уникальны по `(chapter_version_id, kind, pipeline_version)`, так что повышение версии само и есть механизм переразбора.
- **Ничего не активируется без доказательства.** У события есть цитата и диапазон в `content_text` указанной версии; активация проверяет `contentText.slice(start, end) === quote` и при несовпадении событие не активирует (AC-25).
- **Наблюдение и гипотеза — разные вещи.** Явные события принятого текста активируются как `derived`; изменения ценностей, принципов и длительных отношений создаются как `proposed` и не подменяют утверждённое ядро (AC-26).
- **Личное убеждение не меняет канон.** Услышанная ложь ложится событием знания с `acquisition: "told"`; `book_facts` при этом не трогается (AC-09).
- Миграции — штатным `pnpm --filter @book-forge/server drizzle:new <name>`. `drizzle:generate` запрещён: snapshots расходятся с реальной схемой с 0008.
- Новые серверные тесты делают `delete process.env.ANTHROPIC_API_KEY;` в `beforeEach` — `createApp` поднимает настоящий воркер памяти.
- Ставить в коммит только файлы своей задачи. Никогда `git add -A`: в рабочем дереве лежат чужие незакоммиченные правки в `import/`.

### Окружение: база требует Node 22

Системный Node здесь — v24.13.1, а у `better-sqlite3` собран бинарник только под Node 22. **Каждый вызов оболочки** кладёт портативный Node первым в PATH, в POSIX-форме — форму `C:/…` Git Bash молча игнорирует:

```
export PATH="/c/Temp/claude/d--PROJECTS-BOOKOPIS/b6ea4f19-3d74-475e-b92a-4c997ca3e207/scratchpad/node-v22.23.2-win-x64:$PATH"
node -v    # должно напечатать v22.23.2 до всего остального
```

`better-sqlite3` резолвится из `apps/server`, а не из корня репозитория. Если автор к моменту исполнения поставил Node 22 в систему (`node -v` = `v22.x` без правки PATH) — эта преамбула больше не нужна, но проверять надо каждый раз.

---

## Что уже выяснено про код (не перепроверять заново)

Собрано чтением HEAD `8eac164`. Эти факты определяют форму задач.

1. **Конвейер памяти уже делает почти всё, что нужно этапу.** `memory_jobs` (виды `index/summary/facts/notes/rollup`, статусы `pending/running/retry/done/error/obsolete`, уникальность по `(chapter_version_id, kind, pipeline_version)`), staged-результат в `result_json`, атомарная активация одной транзакцией в [memory-activation.ts](../../../apps/server/src/utils/memory-activation.ts) с перепроверкой `current_version_id`, признак устаревания книги `books.memory_stale_from_chapter_order`. AC-21 (идемпотентность), AC-22 (частичная активация невозможна), AC-23 (устаревший результат не активируется) и AC-24 (пометка и снятие устаревания) **уже реализованы для фактов и заметок** — этап 3 обязан распространить их на события, а не строить заново. Его тесты должны это подтвердить, а не предположить.
2. **Задание `facts` уже стадирует payload.** `handleFacts` ([memory-worker.ts:197](../../../apps/server/src/utils/memory-worker.ts)) зовёт `extractFactsPayload`, кладёт `{ factCount, staged: { facts } }` и не трогает активные таблицы; материализует их `persistExtractedFacts` внутри активации. События встраиваются ровно в эту форму.
3. **AC-10 — подтверждённый дефект.** `loadRollingChapterContext` ([rolling-context.ts:66](../../../apps/server/src/utils/rolling-context.ts)) читает `SELECT covers_from_order, covers_to_order, summary_text FROM book_meta_summaries WHERE book_id = ?` **без всякой границы**. При генерации главы 10, когда сводка покрывает главы 1–20, условие `meta.covers_to_order >= olderMax` выполняется и в промпт уходит пересказ глав вплоть до двадцатой. Для малых номеров глав утечки нет случайно: `older` пуст, пока глав меньше окна.
4. **AC-11 — подтверждённый дефект.** `runMetaSummary` ([rolling-context.ts:181](../../../apps/server/src/utils/rolling-context.ts)) пропускает работу по условию `existing.covers_to_order >= coversTo` — то есть по **диапазону**, а не по содержимому. Правка главы 3 внутри покрытого диапазона 1–20 диапазона не меняет, и сводка навсегда остаётся описывать старую главу 3.
5. **`character_knowledge` сегодня — плоская таблица** `{id, character_id, fact, learned_in_chapter_id, created_at}` с маршрутами `GET/POST /characters/:id/knowledge` и `DELETE /character-knowledge/:id` ([routes/entities.ts](../../../apps/server/src/routes/entities.ts)), читает её `gatherCharacterContext` ([packages/agents/src/character.ts](../../../packages/agents/src/character.ts)) **без всякой границы по главе** — это и есть AC-07 в его нынешнем виде.
6. **Следующий номер миграции — 0023.** Последняя запись журнала: `idx: 22`, `tag: "0022_characters_v2"`.
7. **Границы сцены в коде нет нигде** — ни в плане (`beatSchema` без id и участников), ни в версиях. Решение 2 ТЗ: одна неявная сцена на главу, `sceneOrdinal: 0`, все контракты с первого дня принимают границу, а не номер главы.
8. **Из этапа 2 доступно и используется:** `normalizeCharacterProfile`, `selectVoiceSamples` с исключающей границей `excludeFromChapterOrder`, `recordProfileVersion`, `entity_profile_versions`, `resolveEntity` (возвращает `null` на неоднозначном имени). Ничего из этого этап 3 не меняет.

## Порядок и промежуточные состояния

Задачи 1–2 — только схемы в `packages/shared`. Задача 3 — миграция и слой строк. Задачи 4–7 встраивают события в конвейер памяти. Задача 8 даёт чтение по границе, 9 — эпизодическое состояние, 10–11 чинят сводку ранних глав, 12 подключает всё к сборке контекста, 13 закрывает документацией и прогоном.

Задачи 10 и 11 не зависят ни от чего в этом плане и могут идти в любой момент; они поставлены после событий, чтобы сначала закрыть главную линию.

После задачи 7 и до задачи 8 события уже пишутся в базу, а читает их пока никто — окно в один-два коммита. Это ожидаемо, заглушку не городить.

## File Structure

**Создаются:**

| Файл | Ответственность |
|---|---|
| `packages/shared/src/scene-boundary.ts` | `SceneBoundary` и его схема; одна неявная сцена на главу |
| `packages/shared/src/character-events.ts` | Виды событий, способы получения знания, статусы проверки, схемы записи и извлечения |
| `apps/server/drizzle/0023_character_events.sql` | Таблица событий, индексы, перенос существующих ручных знаний |
| `apps/server/src/utils/character-events.ts` | Проверка доказательства, запись событий, чтение на границе |
| `apps/server/src/utils/__tests__/character-events.test.ts` | Тесты границы, доказательства и идемпотентности |

**Изменяются:**

| Файл | Что меняется |
|---|---|
| `packages/shared/src/index.ts` | Экспорт двух новых модулей |
| `packages/shared/src/canon-facts.ts` | `canonFactExtractionSchema` получает `characterEvents` |
| `packages/agents/src/canon-fact-extractor.ts` | Тулсхема и системный промпт разделяют канон и личные события |
| `apps/server/src/db/schema.ts` | Таблица `character_events` для типов и документации |
| `apps/server/src/db/rows.ts` | `CharacterEventRow`, `toCharacterEvent` |
| `apps/server/src/utils/memory-queue.ts` | `MEMORY_PIPELINE_VERSION` → 2 |
| `apps/server/src/utils/book-facts.ts` | `extractFactsPayload` возвращает события рядом с фактами |
| `apps/server/src/utils/memory-worker.ts` | `handleFacts` стадирует события |
| `apps/server/src/utils/memory-activation.ts` | Активация пишет события в той же транзакции |
| `apps/server/src/utils/rolling-context.ts` | Граница сводки (AC-10) и отпечаток источников (AC-11) |
| `apps/server/src/routes/entities.ts` | Маршруты знаний работают поверх событий |
| `packages/agents/src/character.ts` | Знания читаются на границе сцены |
| `CLAUDE.md`, спека раздела 18 | Абзац этапа и отметка о выполнении |

---

### Task 1: Граница сцены

**Files:**
- Create: `packages/shared/src/scene-boundary.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/scene-boundary.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `sceneBoundarySchema`, `SceneBoundary`, `IMPLICIT_SCENE_ORDINAL`, `boundaryForChapter(bookId, chapterId, chapterVersionId)`, `sceneKey(boundary)`. Задачи 4, 8, 9, 12 зависят от этих имён.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/scene-boundary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  sceneBoundarySchema,
  boundaryForChapter,
  sceneKey,
  IMPLICIT_SCENE_ORDINAL,
} from "./scene-boundary.js";

describe("SceneBoundary", () => {
  it("глава без разбиения даёт одну неявную сцену", () => {
    const b = boundaryForChapter(3, 41, 512);
    expect(b.sceneOrdinal).toBe(IMPLICIT_SCENE_ORDINAL);
    expect(IMPLICIT_SCENE_ORDINAL).toBe(0);
    expect(b.bookId).toBe(3);
    expect(b.chapterId).toBe(41);
    expect(b.chapterVersionId).toBe(512);
  });

  it("версия может отсутствовать — глава ещё не написана", () => {
    const b = boundaryForChapter(3, 41, null);
    expect(b.chapterVersionId).toBeNull();
    expect(sceneBoundarySchema.safeParse(b).success).toBe(true);
  });

  it("ключ сцены стабилен и не равен индексу массива", () => {
    const a = sceneKey(boundaryForChapter(3, 41, 512));
    const b = sceneKey(boundaryForChapter(3, 41, 999));
    // Ключ описывает МЕСТО в книге, а не запуск: смена версии его не меняет.
    expect(a).toBe(b);
    expect(a).toBe("b3:c41:s0");
    expect(sceneKey(boundaryForChapter(3, 42, 512))).not.toBe(a);
  });

  it("отрицательный порядковый номер сцены отвергается", () => {
    const r = sceneBoundarySchema.safeParse({
      bookId: 1,
      chapterId: 1,
      chapterVersionId: null,
      sceneOrdinal: -1,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/scene-boundary.test.ts`
Expected: FAIL, `Failed to resolve import "./scene-boundary.js"`.

- [ ] **Step 3: Написать модуль**

Создать `packages/shared/src/scene-boundary.ts`:

```ts
import { z } from "zod";

/** Граница сцены (ТЗ индивидуальности, раздел 7).
 *
 *  В первой реализации сцена одна на главу — решение 2 ТЗ. Но все контракты
 *  принимают границу, а не номер главы, с первого дня: когда появятся
 *  внутриглавные границы, добавится только значение `sceneOrdinal`, и ни один
 *  вызов не придётся переписывать. Обратный порядок — сначала номер главы,
 *  потом «разложить на сцены» — означал бы менять каждый контракт разом. */

/** Единственная сцена главы, пока автор не разбил её на части. */
export const IMPLICIT_SCENE_ORDINAL = 0;

export const sceneBoundarySchema = z.object({
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  /** `null` — у главы ещё нет принятой версии. Граница при этом осмысленна:
   *  знания на её начало считаются по предыдущим главам. */
  chapterVersionId: z.number().int().positive().nullable(),
  sceneOrdinal: z.number().int().nonnegative(),
});
export type SceneBoundary = z.infer<typeof sceneBoundarySchema>;

export function boundaryForChapter(
  bookId: number,
  chapterId: number,
  chapterVersionId: number | null,
): SceneBoundary {
  return {
    bookId,
    chapterId,
    chapterVersionId,
    sceneOrdinal: IMPLICIT_SCENE_ORDINAL,
  };
}

/** Стабильный ключ места в книге. Намеренно **не** включает версию: одна и
 *  та же сцена остаётся той же сценой после перезаписи главы, иначе каждый
 *  перегенерированный текст выглядел бы новым местом и все зависимые снимки
 *  сбрасывались бы без причины (раздел 7: стабильный ID не равен индексу). */
export function sceneKey(b: SceneBoundary): string {
  return `b${b.bookId}:c${b.chapterId}:s${b.sceneOrdinal}`;
}
```

Дописать в `packages/shared/src/index.ts`:

```ts
export * from "./scene-boundary.js";
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/shared test -- src/scene-boundary.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
git add packages/shared/src/scene-boundary.ts packages/shared/src/scene-boundary.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): граница сцены — одна неявная сцена на главу"
```

---

### Task 2: Схемы событий персонажа

**Files:**
- Create: `packages/shared/src/character-events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/character-events.test.ts`

**Interfaces:**
- Consumes: ничего из задачи 1.
- Produces: `CHARACTER_EVENT_KINDS`, `ACQUISITION_MODES`, `EVENT_VERIFICATIONS`, `EVENT_ORIGINS`, `knowledgeDataSchema`, `stateDataSchema`, `relationShiftDataSchema`, `characterEventSchema`, `extractedCharacterEventSchema`, `normalizeEventData`, `defaultVerificationFor(kind)`, `ACQUISITION_LABELS`, типы `CharacterEvent`, `ExtractedCharacterEvent`, `CharacterEventKind`, `AcquisitionMode`. Задачи 3–9, 12 зависят от них.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/character-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  characterEventSchema,
  extractedCharacterEventSchema,
  normalizeEventData,
  defaultVerificationFor,
  ACQUISITION_LABELS,
  CHARACTER_EVENT_KINDS,
} from "./character-events.js";

describe("события персонажа", () => {
  it("AC-26: сдвиг отношения по умолчанию только гипотеза", () => {
    expect(defaultVerificationFor("relation_shift")).toBe("proposed");
    expect(defaultVerificationFor("knowledge")).toBe("derived");
    expect(defaultVerificationFor("commitment")).toBe("derived");
    expect(defaultVerificationFor("state")).toBe("derived");
  });

  it("AC-09: способ получения знания хранится и различает услышанное", () => {
    const d = normalizeEventData("knowledge", {
      fact: "Станцию закрывают",
      acquisition: "told",
      source: "Сарек сказал в столовой",
    });
    expect(d.acquisition).toBe("told");
    expect(d.source).toBe("Сарек сказал в столовой");
    expect(ACQUISITION_LABELS.told).toBe("со слов");
  });

  it("неизвестный способ получения не роняет чтение, а становится observed", () => {
    const d = normalizeEventData("knowledge", { fact: "X", acquisition: "мусор" });
    expect(d.acquisition).toBe("observed");
  });

  it("AC-34: эпизодическое состояние обязано нести условие завершения", () => {
    const d = normalizeEventData("state", { state: "устала" });
    // Ни область действия, ни условие не выдумываются: «неизвестно» честнее
    // бессрочной усталости.
    expect(d.scope).toBe("unknown");
    expect(d.endsAtChapterOrder).toBeNull();
    expect(d.endCondition).toBeNull();
  });

  it("чтение не бросает ни на каком мусоре", () => {
    for (const kind of CHARACTER_EVENT_KINDS) {
      expect(() => normalizeEventData(kind, null)).not.toThrow();
      expect(() => normalizeEventData(kind, "строка")).not.toThrow();
      expect(() => normalizeEventData(kind, [1, 2])).not.toThrow();
      expect(() => normalizeEventData(kind, { fact: 42 })).not.toThrow();
    }
  });

  it("извлечённое событие обязано нести цитату и диапазон", () => {
    const ok = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают", acquisition: "told" },
      evidenceQuote: "— Станцию закрывают, — сказал Сарек.",
      evidenceStart: 100,
      evidenceEnd: 136,
    });
    expect(ok.success).toBe(true);

    const noQuote = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X" },
    });
    expect(noQuote.success).toBe(false);
  });

  it("диапазон с концом раньше начала отвергается", () => {
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X" },
      evidenceQuote: "…",
      evidenceStart: 200,
      evidenceEnd: 100,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/character-events.test.ts`
Expected: FAIL, `Failed to resolve import "./character-events.js"`.

- [ ] **Step 3: Написать модуль**

Создать `packages/shared/src/character-events.ts`:

```ts
import { z } from "zod";

/** События персонажа (ТЗ индивидуальности, разделы 5.4, 6, 12).
 *
 *  Одна таблица вместо второй независимой таблицы знаний: знание — это вид
 *  события, а не отдельная сущность. Иначе у чтения в контекст два источника
 *  истины, и они расходятся на первой же правке.
 *
 *  Схема данных события — схема ЧТЕНИЯ: `normalizeEventData` вызывается на
 *  строке из базы и не бросает никогда. Пределы размеров живут в схеме
 *  извлечения, которая применяется к ответу модели. Тот же раздел, что у
 *  профиля персонажа V2. */

export const CHARACTER_EVENT_KINDS = [
  /** Герой узнал что-то. Читается на границе сцены. */
  "knowledge",
  /** Эпизодическое состояние: усталость, раздражение, намерение уйти. */
  "state",
  /** Сдвиг отношения к другому герою. Всегда гипотеза, см. ниже. */
  "relation_shift",
  /** Обещание, долг, взятое обязательство. */
  "commitment",
] as const;
export const characterEventKindSchema = z.enum(CHARACTER_EVENT_KINDS);
export type CharacterEventKind = z.infer<typeof characterEventKindSchema>;

/** Как герой получил сведение. Убеждение может быть ложным — это не меняет
 *  объективный канон книги (раздел 5.4, AC-09). */
export const ACQUISITION_MODES = ["observed", "told", "inferred", "believed"] as const;
export const acquisitionModeSchema = z.enum(ACQUISITION_MODES);
export type AcquisitionMode = z.infer<typeof acquisitionModeSchema>;

export const ACQUISITION_LABELS: Record<AcquisitionMode, string> = {
  observed: "видел сам",
  told: "со слов",
  inferred: "догадался",
  believed: "верит",
};

export const EVENT_ORIGINS = ["manual", "llm", "accepted_prose", "migration"] as const;
export const eventOriginSchema = z.enum(EVENT_ORIGINS);
export type EventOrigin = z.infer<typeof eventOriginSchema>;

/** `derived` — извлечено из принятого текста и активно. `proposed` — гипотеза,
 *  ждёт автора и в контекст не идёт. `confirmed` — автор подтвердил.
 *  `rejected` — автор отклонил либо доказательство не сошлось (AC-25). */
export const EVENT_VERIFICATIONS = ["derived", "proposed", "confirmed", "rejected"] as const;
export const eventVerificationSchema = z.enum(EVENT_VERIFICATIONS);
export type EventVerification = z.infer<typeof eventVerificationSchema>;

/** Виды, которые активируются сами. Всё, что меняет длительные отношения,
 *  ценности или принципы, остаётся гипотезой: одна резкая реплика не делает
 *  «презирает всех» фактом (AC-26, раздел 12). */
export function defaultVerificationFor(kind: CharacterEventKind): EventVerification {
  return kind === "relation_shift" ? "proposed" : "derived";
}

const line = z.string().nullable().default(null);

export const knowledgeDataSchema = z.object({
  fact: z.string().default(""),
  acquisition: acquisitionModeSchema.default("observed"),
  /** Откуда узнал — человек, документ, наблюдение. */
  source: line,
  /** Ссылка на объективный факт книги, если он есть. Знание может
   *  существовать и без него: герой верит тому, чего не было. */
  canonFactId: z.number().int().positive().nullable().default(null),
  /** Порядок главы, с которой сведение опровергнуто. */
  disprovedFromChapterOrder: z.number().int().nonnegative().nullable().default(null),
});
export type KnowledgeData = z.infer<typeof knowledgeDataSchema>;

/** Область действия эпизодического состояния. `unknown` — честный ответ,
 *  когда течение времени неизвестно; выдумывать точный уровень усталости
 *  запрещено (раздел 5.4, AC-34). */
export const STATE_SCOPES = ["scene", "chapter", "until_resolved", "unknown"] as const;
export const stateScopeSchema = z.enum(STATE_SCOPES);

export const stateDataSchema = z.object({
  state: z.string().default(""),
  scope: stateScopeSchema.default("unknown"),
  endsAtChapterOrder: z.number().int().nonnegative().nullable().default(null),
  endCondition: line,
});
export type StateData = z.infer<typeof stateDataSchema>;

export const relationShiftDataSchema = z.object({
  quality: z.string().default(""),
  from: line,
  to: line,
});
export type RelationShiftData = z.infer<typeof relationShiftDataSchema>;

export const commitmentDataSchema = z.object({
  commitment: z.string().default(""),
  toWhom: line,
  dueByChapterOrder: z.number().int().nonnegative().nullable().default(null),
});
export type CommitmentData = z.infer<typeof commitmentDataSchema>;

const DATA_SCHEMAS = {
  knowledge: knowledgeDataSchema,
  state: stateDataSchema,
  relation_shift: relationShiftDataSchema,
  commitment: commitmentDataSchema,
} as const;

export type EventDataFor<K extends CharacterEventKind> = z.infer<
  (typeof DATA_SCHEMAS)[K]
>;

/** Приводит данные события к форме его вида. Никогда не бросает: вызывается
 *  на чтении строки. Значение не той формы заменяется значением по умолчанию,
 *  а не роняет список событий героя. */
export function normalizeEventData<K extends CharacterEventKind>(
  kind: K,
  raw: unknown,
): EventDataFor<K> {
  const schema = DATA_SCHEMAS[kind];
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data as EventDataFor<K>;

  // Разбираем по полю: валидное сохраняем, невалидное заменяем умолчанием.
  // `Object.hasOwn` обязателен: `schema.shape` — обычный объект, и ключ с
  // именем из прототипа (`toString`, `valueOf`, `constructor`) вернул бы
  // унаследованную функцию, у которой нет `safeParse`. Это уронило бы ровно
  // ту функцию, которая написана, чтобы никогда не ронять.
  const salvaged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(schema.shape, key)) continue;
    const field = (schema.shape as Record<string, z.ZodTypeAny>)[key];
    if (field && field.safeParse(value).success) salvaged[key] = value;
  }
  return schema.parse(salvaged) as EventDataFor<K>;
}

export const characterEventSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  subjectCharacterId: z.number().int().positive(),
  addresseeCharacterId: z.number().int().positive().nullable(),
  kind: characterEventKindSchema,
  data: z.unknown(),
  chapterId: z.number().int().positive().nullable(),
  sceneOrdinal: z.number().int().nonnegative(),
  sourceVersionId: z.number().int().positive().nullable(),
  evidenceQuote: z.string().nullable(),
  evidenceStart: z.number().int().nonnegative().nullable(),
  evidenceEnd: z.number().int().nonnegative().nullable(),
  origin: eventOriginSchema,
  verification: eventVerificationSchema,
  createdAt: z.string(),
});
export type CharacterEvent = z.infer<typeof characterEventSchema>;

/** Форма, которую возвращает извлекатель. Доказательство обязательно: без
 *  цитаты и диапазона проверить событие нечем, а непроверяемое событие не
 *  активируется (AC-25). */
export const extractedCharacterEventSchema = z
  .object({
    /** Имя героя как в главе; сервер сопоставляет его резолвером. */
    subjectName: z.string().min(1).max(160),
    addresseeName: z.string().min(1).max(160).nullable().optional(),
    kind: characterEventKindSchema,
    data: z.record(z.string(), z.unknown()),
    evidenceQuote: z.string().min(1).max(2000),
    evidenceStart: z.number().int().nonnegative(),
    evidenceEnd: z.number().int().nonnegative(),
  })
  .refine((e) => e.evidenceEnd > e.evidenceStart, {
    message: "конец диапазона должен быть больше начала",
    path: ["evidenceEnd"],
  })
  // `data` объявлено свободной записью, потому что её форма зависит от вида
  // события. Оставить её непроверенной значило бы принимать от модели что
  // угодно — а докблок модуля обещает, что пределы живут именно здесь.
  // Проверяем схемой соответствующего вида.
  .superRefine((e, ctx) => {
    if (!DATA_SCHEMAS[e.kind].safeParse(e.data).success) {
      ctx.addIssue({
        code: "custom",
        message: `данные не подходят виду события ${e.kind}`,
        path: ["data"],
      });
    }
  });
export type ExtractedCharacterEvent = z.infer<typeof extractedCharacterEventSchema>;
```

Дописать в `packages/shared/src/index.ts`:

```ts
export * from "./character-events.js";
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/shared test -- src/character-events.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Проверить типы**

Run: `pnpm --filter @book-forge/shared typecheck`
Expected: без ошибок. Если вывод `EventDataFor` через индексированный доступ не устраивает `tsc` в строгом режиме, заменить его на явное объединение типов данных — форма важнее приёма.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/character-events.ts packages/shared/src/character-events.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): события персонажа — знания, состояния, сдвиги отношений"
```

---

### Task 3: Миграция 0023 и слой строк

**Files:**
- Create: `apps/server/drizzle/0023_character_events.sql` (через `drizzle:new`)
- Modify: `apps/server/drizzle/meta/_journal.json`, `apps/server/src/db/schema.ts`, `apps/server/src/db/rows.ts`
- Test: `apps/server/src/db/__tests__/character-events-rows.test.ts`

**Interfaces:**
- Consumes: схемы задачи 2.
- Produces: таблица `character_events`; `CharacterEventRow`, `toCharacterEvent`. Задачи 4–9, 12 зависят от них.

- [ ] **Step 1: Проверить номер и создать заготовку**

```bash
tail -8 apps/server/drizzle/meta/_journal.json
pnpm --filter @book-forge/server drizzle:new 0023_character_events
```
Expected: последняя запись до вызова — `"idx": 22, "tag": "0022_characters_v2"`; после появляется `idx: 23`. Если номер другой — взять фактический следующий.

- [ ] **Step 2: Написать SQL**

Заполнить `apps/server/drizzle/0023_character_events.sql`:

```sql
-- Этап 3 ТЗ индивидуальности персонажей: слой событий персонажа.
-- Знание — это вид события, а не отдельная таблица: два источника истины
-- расходятся на первой же правке (раздел 6, решение 5).

CREATE TABLE character_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  subject_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  addressee_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,

  -- Граница сцены. Номер главы НЕ денормализуется: перестановка глав
  -- оставила бы тихо неверную границу, а join к chapters всегда верен.
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  scene_ordinal INTEGER NOT NULL DEFAULT 0,

  -- CASCADE, а не SET NULL: доказательство события живёт в content_text этой
  -- версии. Без версии смещения показывают в пустоту, событие остаётся
  -- активным и непроверяемым — состояние, запрещённое AC-25.
  source_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE CASCADE,

  -- Доказательство в неизменяемом content_text указанной версии.
  evidence_quote TEXT,
  evidence_start INTEGER,
  evidence_end INTEGER,

  origin TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'derived',
  extractor_version INTEGER NOT NULL DEFAULT 1,

  -- Стабильный ключ для идемпотентности повторной обработки (AC-21).
  dedup_key TEXT NOT NULL,
  created_at TEXT NOT NULL,

  CHECK (kind IN ('knowledge','state','relation_shift','commitment')),
  CHECK (origin IN ('manual','llm','accepted_prose','migration')),
  CHECK (verification IN ('derived','proposed','confirmed','rejected')),
  CHECK (scene_ordinal >= 0),
  CHECK (extractor_version >= 1),
  CHECK (evidence_start IS NULL OR evidence_start >= 0),
  CHECK (evidence_end IS NULL OR evidence_end >= 0),
  CHECK (evidence_start IS NULL OR evidence_end IS NULL OR evidence_end > evidence_start)
);
--> statement-breakpoint

-- Повторная обработка той же версии тем же извлекателем не плодит строк.
-- Версия входит в ключ: то же событие, найденное в ДРУГОЙ версии главы, —
-- отдельная запись со своим доказательством. Номер извлекателя — по той же
-- причине: без него повышение extractor_version гасилось бы индексом, и
-- колонка существовала бы ради случая, который ключ запрещает.
CREATE UNIQUE INDEX uq_character_events_dedup
  ON character_events (subject_character_id, kind, dedup_key,
                       source_version_id, extractor_version);
--> statement-breakpoint
CREATE INDEX idx_character_events_subject ON character_events (subject_character_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_chapter ON character_events (chapter_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_book ON character_events (book_id);
--> statement-breakpoint
CREATE INDEX idx_character_events_version ON character_events (source_version_id);
--> statement-breakpoint

-- Перенос существующих ручных знаний (раздел 6, решение 5). Происхождение
-- честно неполное: версии-источника и цитаты у этих строк нет и не будет,
-- выдумывать их запрещено (INV-07). `verification = 'confirmed'` — автор
-- ввёл их руками, это не гипотеза извлекателя.
INSERT INTO character_events
  (book_id, subject_character_id, addressee_character_id, kind, data_json,
   chapter_id, scene_ordinal, source_version_id,
   evidence_quote, evidence_start, evidence_end,
   origin, verification, extractor_version, dedup_key, created_at)
SELECT
  c.book_id,
  k.character_id,
  NULL,
  'knowledge',
  json_object('fact', k.fact, 'acquisition', 'observed',
              'source', NULL, 'canonFactId', NULL,
              'disprovedFromChapterOrder', NULL),
  k.learned_in_chapter_id,
  0,
  NULL,
  NULL, NULL, NULL,
  'migration',
  'confirmed',
  1,
  'legacy_knowledge:' || k.id,
  k.created_at
FROM character_knowledge k
JOIN characters c ON c.id = k.character_id;
```

Старую таблицу `character_knowledge` **не удалять**: она остаётся, пока интерфейс не переключён (решение 5). Отдельная миграция уберёт её позже.

- [ ] **Step 3: Применить и проверить**

```bash
export PATH="/c/Temp/claude/d--PROJECTS-BOOKOPIS/b6ea4f19-3d74-475e-b92a-4c997ca3e207/scratchpad/node-v22.23.2-win-x64:$PATH"
node -v
pnpm migrate
cd apps/server && node -e "
const D=require('better-sqlite3');const d=new D('../../data/db.sqlite',{readonly:true});
console.log('knowledge rows:', d.prepare('SELECT COUNT(*) c FROM character_knowledge').get().c);
console.log('migrated events:', d.prepare(\"SELECT COUNT(*) c FROM character_events WHERE origin='migration'\").get().c);
console.log(d.prepare(\"SELECT sql FROM sqlite_master WHERE name='character_events'\").get().sql.slice(0,200));
"
```
Expected: число перенесённых событий равно числу строк `character_knowledge`. Если обе нули — это нормально, таблица знаний в этой базе пуста; сказать об этом в отчёте, а не выдавать за проверку переноса.

- [ ] **Step 4: Обновить `schema.ts`**

Описать `characterEvents` рядом с `entityProfileVersions` по её образцу: `sqliteTable`, все колонки, `uniqueIndex`, четыре `index`, все `check`. Драйзл здесь только для типов и документации — runtime ходит сырым SQL. Каждый `check` должен повторять предикат SQL дословно, а не приблизительно: расхождение — это ложь в документации, а документация — единственная работа этого файла.

- [ ] **Step 5: Написать падающий тест слоя строк**

Создать `apps/server/src/db/__tests__/character-events-rows.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { toCharacterEvent, type CharacterEventRow } from "../rows.js";

let t: TestApp;
let bookId: number;
let charId: number;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "События" });
  bookId = b.id;
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  charId = c.id;
});
afterEach(() => t.cleanup());

function insertEvent(dataJson: string, kind = "knowledge"): number {
  const info = t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, ?, ?, 0, 'llm', 'derived', 1, ?, ?)`,
    )
    .run(bookId, charId, kind, dataJson, `k:${Math.random()}`, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

describe("чтение строки события", () => {
  it("данные разбираются по виду события", () => {
    const id = insertEvent(
      JSON.stringify({ fact: "Станцию закрывают", acquisition: "told" }),
    );
    const row = t.sqlite
      .prepare("SELECT * FROM character_events WHERE id = ?")
      .get(id) as CharacterEventRow;
    const e = toCharacterEvent(row);
    expect(e.kind).toBe("knowledge");
    expect((e.data as { fact: string }).fact).toBe("Станцию закрывают");
    expect((e.data as { acquisition: string }).acquisition).toBe("told");
  });

  it("битый data_json не роняет чтение", () => {
    const id = insertEvent("{не json");
    const row = t.sqlite
      .prepare("SELECT * FROM character_events WHERE id = ?")
      .get(id) as CharacterEventRow;
    expect(() => toCharacterEvent(row)).not.toThrow();
    expect(toCharacterEvent(row).kind).toBe("knowledge");
  });

  it("уникальный индекс не даёт записать событие дважды", () => {
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, 'llm', 'derived', 1, 'same', ?)`,
    );
    ins.run(bookId, charId, now);
    expect(() => ins.run(bookId, charId, now)).toThrow();
  });
});
```

Форму фикстуры (`t.sqlite`, вызовы `sendJson`) сверить с `apps/server/src/routes/__tests__/_helpers.ts` перед написанием: два предыдущих этапа обнаружили, что предположения брифа о хелперах нуждались в правке. Подстраиваться под файл, а не править хелперы.

- [ ] **Step 6: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/db/__tests__/character-events-rows.test.ts`
Expected: FAIL — `toCharacterEvent` не экспортирован.

- [ ] **Step 7: Добавить строку и конвертер**

В `apps/server/src/db/rows.ts`:

```ts
export interface CharacterEventRow {
  id: number;
  book_id: number;
  subject_character_id: number;
  addressee_character_id: number | null;
  kind: string;
  data_json: string;
  chapter_id: number | null;
  scene_ordinal: number;
  source_version_id: number | null;
  evidence_quote: string | null;
  evidence_start: number | null;
  evidence_end: number | null;
  origin: string;
  verification: string;
  extractor_version: number;
  dedup_key: string;
  created_at: string;
}

/** Вид, происхождение и статус приходят из колонок с CHECK — их можно
 *  разбирать схемой. `data_json` — свободный JSON, поэтому он идёт через
 *  нормализатор, который не бросает. */
export function toCharacterEvent(r: CharacterEventRow): CharacterEvent {
  const kind = characterEventKindSchema.parse(r.kind);
  return {
    id: r.id,
    bookId: r.book_id,
    subjectCharacterId: r.subject_character_id,
    addresseeCharacterId: r.addressee_character_id,
    kind,
    data: normalizeEventData(kind, parseJsonOrNull(r.data_json)),
    chapterId: r.chapter_id,
    sceneOrdinal: r.scene_ordinal,
    sourceVersionId: r.source_version_id,
    evidenceQuote: r.evidence_quote,
    evidenceStart: r.evidence_start,
    evidenceEnd: r.evidence_end,
    origin: eventOriginSchema.parse(r.origin),
    verification: eventVerificationSchema.parse(r.verification),
    createdAt: r.created_at,
  };
}
```

`parseJsonOrNull` уже экспортирован из этого файла с этапа 2 — переиспользовать, не писать второй вариант.

- [ ] **Step 8: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/db/__tests__/character-events-rows.test.ts`
Expected: PASS, 3 теста.

Run: `pnpm --filter @book-forge/server test`
Expected: всё зелёное, вывод без предупреждений.

- [ ] **Step 9: Коммит**

```bash
git add apps/server/drizzle/0023_character_events.sql apps/server/drizzle/meta/_journal.json apps/server/src/db/schema.ts apps/server/src/db/rows.ts apps/server/src/db/__tests__/character-events-rows.test.ts
git commit -m "feat(db): миграция 0023 — события персонажа и перенос ручных знаний"
```

---

### Task 4: Проверка доказательства и запись событий

**Files:**
- Create: `apps/server/src/utils/character-events.ts`
- Test: `apps/server/src/utils/__tests__/character-events.test.ts`

**Interfaces:**
- Consumes: `extractedCharacterEventSchema`, `defaultVerificationFor`, `normalizeEventData`, `toCharacterEvent`, `resolveEntity` (этап 2).
- Produces: `verifyEvidence(contentText, quote, start, end)`, `dedupKeyFor(kind, data)`, `persistCharacterEvents(sqlite, args)`, тип `PersistEventsOutcome`. Задачи 5–8 зависят от них.

- [ ] **Step 1: Написать падающие тесты**

Создать `apps/server/src/utils/__tests__/character-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyEvidence, dedupKeyFor } from "../character-events.js";

describe("verifyEvidence", () => {
  const text = "Рин молчала. — Станцию закрывают, — сказал Сарек. Она кивнула.";

  it("совпадающая цитата принимается", () => {
    const start = text.indexOf("— Станцию закрывают");
    const quote = "— Станцию закрывают";
    expect(verifyEvidence(text, quote, start, start + quote.length)).toBe(true);
  });

  it("AC-25: сдвинутый диапазон отвергается", () => {
    const start = text.indexOf("— Станцию закрывают");
    const quote = "— Станцию закрывают";
    expect(verifyEvidence(text, quote, start + 3, start + 3 + quote.length)).toBe(false);
  });

  it("AC-25: цитата, которой в тексте нет, отвергается", () => {
    expect(verifyEvidence(text, "— Станцию не закрывают", 10, 32)).toBe(false);
  });

  it("диапазон за концом текста отвергается, а не бросает", () => {
    expect(() => verifyEvidence(text, "хвост", 10_000, 10_005)).not.toThrow();
    expect(verifyEvidence(text, "хвост", 10_000, 10_005)).toBe(false);
  });

  it("конец не позже начала отвергается", () => {
    expect(verifyEvidence(text, "Рин", 5, 5)).toBe(false);
    expect(verifyEvidence(text, "Рин", 5, 1)).toBe(false);
  });
});

describe("dedupKeyFor", () => {
  it("одно и то же знание даёт один ключ независимо от порядка полей", () => {
    const a = dedupKeyFor("knowledge", { fact: "X", acquisition: "told" });
    const b = dedupKeyFor("knowledge", { acquisition: "told", fact: "X" });
    expect(a).toBe(b);
  });

  it("разное знание даёт разные ключи", () => {
    expect(dedupKeyFor("knowledge", { fact: "X" })).not.toBe(
      dedupKeyFor("knowledge", { fact: "Y" }),
    );
  });

  it("ключ не зависит от регистра и лишних пробелов в тексте", () => {
    expect(dedupKeyFor("knowledge", { fact: "  Станцию  закрывают " })).toBe(
      dedupKeyFor("knowledge", { fact: "станцию закрывают" }),
    );
  });

  it("сдвиг отношения к разным адресатам даёт разные ключи", () => {
    // Адресат живёт колонкой, а не в data: relationShiftDataSchema — это
    // {quality, from, to}. Без него два сдвига из одной версии к разным
    // героям совпали бы ключом, и уникальный индекс молча выбросил бы
    // второй (INSERT OR IGNORE).
    const data = { quality: "доверие", from: "ровно", to: "холодно" };
    expect(dedupKeyFor("relation_shift", data, 7)).not.toBe(
      dedupKeyFor("relation_shift", data, 8),
    );
  });

  it("отсутствие адресата — тоже значение ключа", () => {
    const data = { fact: "X" };
    expect(dedupKeyFor("knowledge", data, null)).toBe(
      dedupKeyFor("knowledge", data),
    );
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/character-events.test.ts`
Expected: FAIL, модуль `../character-events.js` не найден.

- [ ] **Step 3: Написать модуль**

Создать `apps/server/src/utils/character-events.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import {
  defaultVerificationFor,
  type CharacterEventKind,
  type ExtractedCharacterEvent,
} from "@book-forge/shared";
import { resolveEntity } from "./entity-resolve.js";

/** Слой событий персонажа (ТЗ индивидуальности, разделы 6, 12). */

/**
 * Доказательство — точная цитата и диапазон в НЕИЗМЕНЯЕМОМ `content_text`
 * указанной версии. Проверка буквальная: `slice(start, end) === quote`.
 * Модельный ответ не считается доверенным только потому, что он правильной
 * формы (раздел 14), а событие без сошедшегося доказательства не
 * активируется (AC-25).
 *
 * Координаты — UTF-16 offsets, как их считает JavaScript. Это
 * задокументированная система: смешивать её с индексами TipTap нельзя.
 */
export function verifyEvidence(
  contentText: string,
  quote: string,
  start: number,
  end: number,
): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end <= start) return false;
  if (end > contentText.length) return false;
  return contentText.slice(start, end) === quote;
}

/**
 * Стабильный ключ события для идемпотентности (AC-21). Повторная обработка
 * той же версии тем же извлекателем не должна плодить долги и секреты, а
 * модель между прогонами переставляет ключи и меняет пробелы — поэтому
 * ключ считается по смыслу, а не по сырому JSON.
 *
 * Адресат входит в ключ отдельным аргументом, потому что он живёт колонкой
 * `addressee_character_id`, а не в `data`: у `relation_shift` данные — это
 * {quality, from, to}, и два сдвига из одной версии к разным героям без
 * него совпали бы ключом, а `INSERT OR IGNORE` выбросил бы второй молча.
 */
export function dedupKeyFor(
  kind: CharacterEventKind,
  data: unknown,
  addresseeCharacterId: number | null = null,
): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "string") return v.trim().replace(/\s+/g, " ").toLowerCase();
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = norm((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return `${kind}:${addresseeCharacterId ?? "-"}:${JSON.stringify(norm(data))}`;
}

export interface PersistEventsOutcome {
  inserted: number;
  /** Отвергнуто из-за несошедшегося доказательства (AC-25). */
  rejectedEvidence: number;
  /** Имя субъекта не разрешилось в героя этой книги. */
  unresolved: number;
  /** Уже было — повторная обработка (AC-21). */
  duplicates: number;
}

export interface PersistEventsArgs {
  bookId: number;
  chapterId: number;
  sourceVersionId: number;
  /** Текст ИМЕННО той версии, из которой извлекали. */
  contentText: string;
  events: ExtractedCharacterEvent[];
  extractorVersion: number;
}

/**
 * Пишет события. Вызывать ВНУТРИ транзакции активации: вместе с фактами и
 * заметками одной версии они активируются атомарно, иначе половина новых
 * отношений останется без остальной памяти (раздел 12, AC-22).
 */
export function persistCharacterEvents(
  sqlite: DatabaseType,
  args: PersistEventsArgs,
): PersistEventsOutcome {
  const out: PersistEventsOutcome = {
    inserted: 0,
    rejectedEvidence: 0,
    unresolved: 0,
    duplicates: 0,
  };
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO character_events
       (book_id, subject_character_id, addressee_character_id, kind, data_json,
        chapter_id, scene_ordinal, source_version_id,
        evidence_quote, evidence_start, evidence_end,
        origin, verification, extractor_version, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'llm', ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();

  for (const e of args.events) {
    const subject = resolveEntity(sqlite, args.bookId, "character", e.subjectName);
    if (!subject) {
      // Неоднозначное или неизвестное имя. Резолвер намеренно возвращает
      // `null` вместо первого попавшегося — пришить событие чужому герою
      // хуже, чем не пришить никому (AC-04, этап 2).
      out.unresolved += 1;
      continue;
    }
    if (!verifyEvidence(args.contentText, e.evidenceQuote, e.evidenceStart, e.evidenceEnd)) {
      out.rejectedEvidence += 1;
      continue;
    }
    const addressee = e.addresseeName
      ? resolveEntity(sqlite, args.bookId, "character", e.addresseeName)
      : null;

    const info = insert.run(
      args.bookId,
      subject.entityId,
      addressee?.entityId ?? null,
      e.kind,
      JSON.stringify(e.data),
      args.chapterId,
      args.sourceVersionId,
      e.evidenceQuote,
      e.evidenceStart,
      e.evidenceEnd,
      defaultVerificationFor(e.kind),
      args.extractorVersion,
      dedupKeyFor(e.kind, e.data, addressee?.entityId ?? null),
      now,
    );
    if (info.changes > 0) out.inserted += 1;
    else out.duplicates += 1;
  }
  return out;
}
```

`INSERT OR IGNORE` здесь **уместен и намеренно отличается** от `recordProfileVersion` этапа 2, где `OR IGNORE` был убран: там дубликат означал бы потерянное обновление, а здесь он означает ровно то, что AC-21 требует — повторная обработка той же версии не плодит строк. Написать это комментарием, иначе следующий читатель «поправит» по аналогии.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/character-events.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/character-events.ts apps/server/src/utils/__tests__/character-events.test.ts
git commit -m "feat(events): проверка доказательства и идемпотентная запись событий"
```

---

### Task 5: Извлекатель возвращает события рядом с фактами

**Files:**
- Modify: `packages/shared/src/canon-facts.ts`, `packages/agents/src/canon-fact-extractor.ts`
- Test: `packages/agents/src/__tests__/canon-fact-extractor-prompt.test.ts` (создать, если файла нет)

**Interfaces:**
- Consumes: `extractedCharacterEventSchema` (задача 2).
- Produces: `canonFactExtractionSchema` с полем `characterEvents`; тип `CanonFactExtraction` получает то же поле. Задачи 6 и 7 зависят от него.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, it, expect } from "vitest";
import { canonFactExtractionSchema } from "@book-forge/shared";

describe("контракт извлекателя", () => {
  it("ответ без событий по-прежнему валиден", () => {
    const r = canonFactExtractionSchema.safeParse({ facts: [] });
    expect(r.success).toBe(true);
    // Старые staged-результаты в result_json разбираются без изменений.
    expect(r.success && r.data.characterEvents).toEqual([]);
  });

  it("события принимаются рядом с фактами", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          kind: "knowledge",
          data: { fact: "Станцию закрывают", acquisition: "told" },
          evidenceQuote: "— Станцию закрывают",
          evidenceStart: 10,
          evidenceEnd: 29,
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.characterEvents).toHaveLength(1);
  });

  it("событие без доказательства отбрасывает весь разбор события", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [{ subjectName: "Рин", kind: "knowledge", data: {} }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/__tests__/canon-fact-extractor-prompt.test.ts`
Expected: FAIL — `characterEvents` не в схеме.

- [ ] **Step 3: Расширить схему и промпт**

В `packages/shared/src/canon-facts.ts`:

```ts
export const canonFactExtractionSchema = z.object({
  facts: z.array(extractedFactSchema).max(40),
  /** События персонажей идут тем же вызовом: отдельный вид задания потребовал
   *  бы пересборки `memory_jobs` (список видов зашит в SQL CHECK, решение 6
   *  ТЗ). Необязательное с умолчанием — старые staged-результаты в
   *  `result_json` продолжают разбираться. */
  characterEvents: z.array(extractedCharacterEventSchema).max(30).default([]),
  notes: z.string().nullable().optional(),
});
```

В системном промпте `packages/agents/src/canon-fact-extractor.ts` добавить раздел, разделяющий два выхода. Смысл, который он обязан нести (формулировки уточнить под стиль файла):

- **Факты книги** — то, что произошло объективно. **События персонажа** — то, что стало известно или изменилось *у конкретного героя*.
- Услышанное и увиденное различать: `acquisition` = `observed` только если герой это видел; `told` — если ему сказали; `believed` — если он в это верит без подтверждения. **Ложь, услышанная героем, — это событие знания с `told`, а не факт книги** (AC-09).
- Каждое событие несёт **дословную цитату** из текста главы и её диапазон. Диапазон — позиции символов в переданном тексте. Событие без цитаты не записывается.
- Вывод о длительном отношении («теперь презирает всех») из одной реплики — **не** событие. Записывать только то, что в тексте сказано или показано (AC-26).
- Усталость, раздражение и намерение — события состояния; если из текста не видно, когда это кончится, оставлять `scope: "unknown"`, а не придумывать срок (AC-34).

Обновить `maxTokens` вызова `extractCanonFacts` с 4096 до 8192: ответ стал вдвое шире, а урезанный ответ приходит как ошибка разбора, которую легко принять за плохую модель.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/agents test`
Expected: PASS, включая существующие тесты извлекателя.

Run: `pnpm --filter @book-forge/llm test -- src/__tests__/structured-agents-parity.test.ts`
Expected: PASS — новых агентов не добавляли, сторож паритета не должен сработать.

- [ ] **Step 5: Коммит**

```bash
git add packages/shared/src/canon-facts.ts packages/agents/src/canon-fact-extractor.ts packages/agents/src/__tests__/canon-fact-extractor-prompt.test.ts
git commit -m "feat(agents): извлекатель отделяет личные события от канона книги"
```

---

### Task 6: Воркер стадирует события, версия конвейера 2

**Files:**
- Modify: `apps/server/src/utils/memory-queue.ts`, `apps/server/src/utils/book-facts.ts`, `apps/server/src/utils/memory-worker.ts`
- Test: `apps/server/src/utils/__tests__/memory-pipeline.test.ts` (дописать)

**Interfaces:**
- Consumes: расширенный `canonFactExtractionSchema` (задача 5).
- Produces: `FactsPayload` получает `characterEvents` и `contentText`; staged-результат задания `facts` получает `staged.characterEvents`; `MEMORY_PIPELINE_VERSION = 2`. Задача 7 зависит от формы staged-результата.

- [ ] **Step 1: Написать падающий тест**

Дописать в `apps/server/src/utils/__tests__/memory-pipeline.test.ts`:

```ts
it("версия конвейера поднята до 2 — старые версии переразбираются", () => {
  expect(MEMORY_PIPELINE_VERSION).toBe(2);
});

const CHAPTER_TEXT =
  "Рин молчала. — Станцию закрывают, — сказал Сарек. Она кивнула и вышла.";
const QUOTE = "— Станцию закрывают";

it("staged-результат задания facts несёт события рядом с фактами", async () => {
  // Мок извлекателя возвращает и факт, и событие. Цитата берётся из текста
  // версии ДОСЛОВНО и с настоящими позициями — иначе активация её отвергнет,
  // и тест проверял бы отказ вместо того, что задуман.
  const start = CHAPTER_TEXT.indexOf(QUOTE);
  mockExtractCanonFacts.mockResolvedValue({
    facts: [
      {
        entityType: "character",
        entityName: "Рин",
        statement: "Рин работает на станции",
        assertionMode: "narrated_as_fact",
      },
    ],
    characterEvents: [
      {
        subjectName: "Рин",
        kind: "knowledge",
        data: { fact: "Станцию закрывают", acquisition: "told" },
        evidenceQuote: QUOTE,
        evidenceStart: start,
        evidenceEnd: start + QUOTE.length,
      },
    ],
  });

  const job = claimNextMemoryJob(sqlite, { kinds: ["facts"] })!;
  await runOneJob(job);

  const row = sqlite
    .prepare("SELECT result_json FROM memory_jobs WHERE id = ?")
    .get(job.id) as { result_json: string };
  const staged = JSON.parse(row.result_json);
  expect(staged.staged.facts).toHaveLength(1);
  expect(staged.staged.characterEvents).toHaveLength(1);
  expect(staged.staged.contentText).toBe(CHAPTER_TEXT);
  expect(staged.eventCount).toBe(1);
});
```

Имена `claimNextMemoryJob`, способ прогнать один job (здесь он назван `runOneJob`) и идиому мока агента взять из существующего `memory-pipeline.test.ts`: он уже прогоняет этот конвейер, и его форма здесь главнее, чем этот набросок. Глава для фикстуры должна иметь принятую версию с `content_text = CHAPTER_TEXT` и `word_count` не меньше 80 — иначе `extractFactsPayload` вернёт `skipped: "short"` и никакого staged-результата не будет. Текст можно просто повторить нужное число раз, сохранив цитату в единственном экземпляре.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/memory-pipeline.test.ts`
Expected: FAIL — `MEMORY_PIPELINE_VERSION` равен 1, `staged.characterEvents` отсутствует.

- [ ] **Step 3: Поднять версию и расширить payload**

В `apps/server/src/utils/memory-queue.ts`:

```ts
/** 2 — этап 3: задание `facts` возвращает ещё и события персонажей.
 *  Строки уникальны по (chapter_version_id, kind, pipeline_version), поэтому
 *  повышение версии само переразбирает уже обработанные главы новым
 *  контрактом; отдельной миграции не нужно. */
export const MEMORY_PIPELINE_VERSION = 2;
```

В `apps/server/src/utils/book-facts.ts`, в `FactsPayload` и `extractFactsPayload`:

```ts
export interface FactsPayload {
  facts: ExtractedFact[];
  /** Личные события героев из того же вызова (раздел 12, решение 6). */
  characterEvents: ExtractedCharacterEvent[];
  /** Текст ИМЕННО этой версии — активация сверяет по нему доказательства. */
  contentText: string;
  bookId: number;
  chapterId: number;
  chapterOrder: number;
  skipped?: "missing" | "short";
}
```

Вернуть `characterEvents: result.characterEvents ?? []` и `contentText: v.content_text` из всех ветвей, включая обе ранние с пустым результатом — иначе тип не сойдётся, и заглушать это приведением было бы неверным исправлением.

В `apps/server/src/utils/memory-worker.ts`, `handleFacts`:

```ts
completeMemoryJob(sqlite, job.id, {
  factCount: p.facts.length,
  eventCount: p.characterEvents.length,
  staged: {
    facts: p.facts,
    characterEvents: p.characterEvents,
    contentText: p.contentText,
  },
});
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/memory-pipeline.test.ts`
Expected: PASS.

Run: `pnpm --filter @book-forge/server test`
Expected: всё зелёное. Тесты, проверявшие `pipeline_version = 1`, ожидаемо потребуют правки — это изменение контракта, а не регрессия; сказать об этом в отчёте.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/memory-queue.ts apps/server/src/utils/book-facts.ts apps/server/src/utils/memory-worker.ts apps/server/src/utils/__tests__/memory-pipeline.test.ts
git commit -m "feat(memory): задание facts стадирует события, версия конвейера 2"
```

---

### Task 7: Атомарная активация пишет события

**Files:**
- Modify: `apps/server/src/utils/memory-activation.ts`
- Test: `apps/server/src/utils/__tests__/memory-activation-events.test.ts`

**Interfaces:**
- Consumes: `persistCharacterEvents` (задача 4), staged-форма задачи 6.
- Produces: `StagedFactsResult` получает `characterEvents` и `contentText`; активация пишет события в той же транзакции.

- [ ] **Step 1: Написать падающие тесты**

Создать `apps/server/src/utils/__tests__/memory-activation-events.test.ts` с тремя случаями:

```ts
it("AC-22: события и факты активируются одной транзакцией", () => {
  // Задание notes ещё не done → активация не должна записать НИ фактов,
  // НИ событий. Половина новой памяти хуже, чем её отсутствие.
  const outcome = tryActivateMemoryVersion(sqlite, chapterId, versionId);
  expect(outcome).toBe("pending");
  expect(countEvents()).toBe(0);
  expect(countFacts()).toBe(0);
});

it("AC-23: результат устаревшей версии не активируется", () => {
  // Пока задания выполнялись, глава получила другую текущую версию.
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(otherVersionId, chapterId);
  expect(tryActivateMemoryVersion(sqlite, chapterId, versionId)).toBe("obsolete");
  expect(countEvents()).toBe(0);
});

it("AC-25: событие с несошедшимся доказательством не активируется, остальные проходят", () => {
  // Два события: у одного цитата дословная, у второго сдвинут диапазон.
  expect(tryActivateMemoryVersion(sqlite, chapterId, versionId)).toBe("activated");
  expect(countEvents()).toBe(1);
  const e = sqlite.prepare("SELECT evidence_quote FROM character_events").get();
  expect(e.evidence_quote).toBe(goodQuote);
});

it("AC-21: повторная активация той же версии не плодит событий", () => {
  tryActivateMemoryVersion(sqlite, chapterId, versionId);
  const first = countEvents();
  // Сбрасываем memory_version_id, чтобы пройти путь активации ещё раз.
  sqlite.prepare("UPDATE chapters SET memory_version_id = NULL WHERE id = ?").run(chapterId);
  tryActivateMemoryVersion(sqlite, chapterId, versionId);
  expect(countEvents()).toBe(first);
});
```

Подготовку (книга, персонаж, глава, версия с известным `content_text`, строки `memory_jobs` со staged-результатами) писать напрямую через `sqlite`, как это делает существующий `memory-pipeline.test.ts` — LLM здесь не нужен вовсе, staged-результаты кладутся руками.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/memory-activation-events.test.ts`
Expected: FAIL — события не пишутся.

- [ ] **Step 3: Расширить активацию**

В `apps/server/src/utils/memory-activation.ts`:

```ts
export interface StagedFactsResult {
  factCount: number;
  eventCount?: number;
  skipped?: string;
  staged?: {
    facts: ExtractedFact[];
    /** Необязательные: staged-результаты версии конвейера 1 их не несут. */
    characterEvents?: ExtractedCharacterEvent[];
    contentText?: string;
  };
}
```

Внутри транзакции, сразу после `persistExtractedFacts`:

```ts
    const staged = factsResult?.staged;
    if (staged?.characterEvents?.length && staged.contentText) {
      const outcome = persistCharacterEvents(sqlite, {
        bookId: ch.book_id,
        chapterId,
        sourceVersionId: versionId,
        contentText: staged.contentText,
        events: staged.characterEvents,
        extractorVersion: MEMORY_PIPELINE_VERSION,
      });
      if (outcome.rejectedEvidence > 0 || outcome.unresolved > 0) {
        // Не ошибка активации: остальные слои версии обязаны активироваться.
        // Но молчать нельзя — это единственное место, где видно, сколько
        // извлечённого отброшено и почему.
        console.warn(
          `[memory] v${versionId}: событий отброшено — доказательство ${outcome.rejectedEvidence}, имя не разрешилось ${outcome.unresolved}`,
        );
      }
    }
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/memory-activation-events.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/memory-activation.ts apps/server/src/utils/__tests__/memory-activation-events.test.ts
git commit -m "feat(memory): события активируются вместе с фактами одной транзакцией"
```

---

### Task 8: Знания на границе сцены

**Files:**
- Modify: `apps/server/src/utils/character-events.ts`, `apps/server/src/routes/entities.ts`
- Test: `apps/server/src/routes/__tests__/character-knowledge-boundary.test.ts`

**Interfaces:**
- Consumes: `SceneBoundary` (задача 1), `toCharacterEvent` (задача 3).
- Produces: `loadKnowledgeAtBoundary(sqlite, characterId, boundary, options?)`, `loadEventsAtBoundary(sqlite, characterIds, boundary)`. Задачи 9 и 12 зависят от них.

- [ ] **Step 1: Написать падающие тесты**

Создать `apps/server/src/routes/__tests__/character-knowledge-boundary.test.ts`. Сначала фикстура — её строит один помощник, потому что её же используют задачи 9 и 12:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boundaryForChapter } from "@book-forge/shared";
import { makeTestApp, sendJson, type TestApp } from "./_helpers.js";
import {
  loadKnowledgeAtBoundary,
  loadEventsAtBoundary,
} from "../../utils/character-events.js";

let t: TestApp;
let bookId: number;
let rinId: number;
const chapterIds = new Map<number, number>(); // order_index → chapters.id

/** Глава без текста: границе версия не нужна, знания считаются по событиям. */
function makeChapter(order: number, title: string): number {
  const now = new Date().toISOString();
  const info = t.sqlite
    .prepare(
      `INSERT INTO chapters (book_id, title, order_index, status, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
    )
    .run(bookId, title, order, now, now);
  const id = Number(info.lastInsertRowid);
  chapterIds.set(order, id);
  return id;
}

function addEvent(args: {
  kind: string;
  data: unknown;
  chapterOrder: number | null;
  verification?: string;
  origin?: string;
}): void {
  const now = new Date().toISOString();
  t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`,
    )
    .run(
      bookId,
      rinId,
      args.kind,
      JSON.stringify(args.data),
      args.chapterOrder === null ? null : chapterIds.get(args.chapterOrder),
      args.origin ?? "llm",
      args.verification ?? "derived",
      `k:${Math.random()}`,
      now,
    );
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  chapterIds.clear();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Границы" });
  bookId = b.id;
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  rinId = c.id;
  for (const o of [1, 2, 4, 8, 9]) makeChapter(o, `Глава ${o}`);

  addEvent({ kind: "knowledge", chapterOrder: 2, data: { fact: "Станцию закрывают", acquisition: "told" } });
  addEvent({ kind: "knowledge", chapterOrder: 8, data: { fact: "Сарек — брат Селены", acquisition: "observed" } });
  addEvent({ kind: "knowledge", chapterOrder: 8, data: { fact: "Сарек погиб", acquisition: "told" } });
  addEvent({
    kind: "relation_shift",
    chapterOrder: 2,
    verification: "proposed",
    data: { quality: "доверие", from: "верит", to: "не верит" },
  });
});
afterEach(() => t.cleanup());
```

Проверить форму `makeTestApp`/`sendJson` и обязательные колонки `chapters` по `apps/server/src/routes/__tests__/_helpers.ts` и существующим тестам **до** написания: два предыдущих этапа обнаружили, что предположения брифа о хелперах нуждались в правке. Подстраиваться под файл, а не править хелперы.

Дальше сами проверки:

```ts
it("AC-07: секрет из главы 8 не виден при подготовке главы 4", () => {
  // Событие знания записано на главу 8; граница — начало главы 4.
  const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch4Id, null));
  expect(known.map((k) => k.data.fact)).not.toContain("Сарек — брат Селены");
});

it("знание из главы 2 видно при подготовке главы 4", () => {
  const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch4Id, null));
  expect(known.map((k) => k.data.fact)).toContain("Станцию закрывают");
});

it("знание, полученное в САМОЙ главе, в её начальный контекст не входит", () => {
  // Граница исключающая: начало сцены строится из событий ДО неё (раздел 7).
  const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch2Id, null));
  expect(known.map((k) => k.data.fact)).not.toContain("Станцию закрывают");
});

it("AC-33: флешбэк с явной ранней границей не получает поздних знаний", () => {
  const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch1Id, null));
  expect(known).toHaveLength(0);
});

it("AC-26: гипотеза в контекст не попадает", () => {
  // relation_shift активируется как `proposed` и активным знанием не является.
  const events = loadEventsAtBoundary(t.sqlite, [rinId], boundaryForChapter(bookId, ch9Id, null));
  expect(events.every((e) => e.verification !== "proposed")).toBe(true);
});

it("AC-09: услышанная ложь остаётся знанием героя и не становится фактом книги", () => {
  const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch9Id, null));
  const lie = known.find((k) => k.data.fact === "Сарек погиб");
  expect(lie?.data.acquisition).toBe("told");
  const facts = t.sqlite.prepare("SELECT COUNT(*) c FROM book_facts WHERE book_id = ?").get(bookId);
  expect(facts.c).toBe(0);
});

it("перенесённое ручное знание без главы видно на любой границе", () => {
  // У миграционных строк `chapter_id` может быть NULL: автор не указал главу.
  // Скрыть их было бы потерей авторских сведений (INV-07).
  addEvent({
    kind: "knowledge",
    chapterOrder: null,
    origin: "migration",
    verification: "confirmed",
    data: { fact: "Боится замкнутых пространств", acquisition: "observed" },
  });
  const known = loadKnowledgeAtBoundary(
    t.sqlite,
    rinId,
    boundaryForChapter(bookId, chapterIds.get(1)!, null),
  );
  expect(known.map((k) => (k.data as { fact: string }).fact)).toContain(
    "Боится замкнутых пространств",
  );
});

it("AC-24: перестановка глав сразу меняет то, что видно на границе", () => {
  // Знание записано на главу 8 и на границе главы 4 невидимо.
  const at4 = () =>
    loadKnowledgeAtBoundary(
      t.sqlite,
      rinId,
      boundaryForChapter(bookId, chapterIds.get(4)!, null),
    ).map((k) => (k.data as { fact: string }).fact);
  expect(at4()).not.toContain("Сарек — брат Селены");

  // Автор переставил главы: бывшая восьмая стала первой.
  t.sqlite
    .prepare("UPDATE chapters SET order_index = 0 WHERE id = ?")
    .run(chapterIds.get(8)!);

  // Порядок берётся join'ом к `chapters`, а не денормализованной копией,
  // поэтому граница верна сразу. С денормализованным номером она осталась бы
  // тихо неверной до следующего пересчёта — и заметить это было бы нечем.
  expect(at4()).toContain("Сарек — брат Селены");
});
```

Все перечисленные проверки используют одну фикстуру из `beforeEach`; та, что добавляет миграционную строку, дописывает её сама, чтобы не влиять на проверку AC-33.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/character-knowledge-boundary.test.ts`
Expected: FAIL — `loadKnowledgeAtBoundary` не экспортирована.

- [ ] **Step 3: Написать чтение на границе**

Дописать в `apps/server/src/utils/character-events.ts`:

```ts
/** Только эти статусы считаются действующими знаниями. Гипотеза в контекст
 *  не идёт, отклонённое — тем более (AC-26). */
const ACTIVE_VERIFICATIONS = "('derived','confirmed')";

/**
 * События субъектов на начало сцены. Граница ИСКЛЮЧАЮЩАЯ: начальный контекст
 * строится из событий ДО неё, иначе герой входит в сцену, уже зная то, что
 * узнает в ней (раздел 7, AC-07).
 *
 * Порядок главы берётся **join'ом к `chapters`**, а не денормализованной
 * колонкой: перестановка глав иначе оставила бы тихо неверную границу, и
 * заметить это было бы нечем.
 *
 * Событие без главы (перенесённое ручное знание) видно всегда: автор ввёл
 * его вне повествования, и прятать его — потеря авторских сведений.
 */
export function loadEventsAtBoundary(
  sqlite: DatabaseType,
  subjectIds: number[],
  boundary: SceneBoundary,
): CharacterEvent[] {
  if (subjectIds.length === 0) return [];
  const placeholders = subjectIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT e.* FROM character_events e
       LEFT JOIN chapters ec ON ec.id = e.chapter_id
       WHERE e.subject_character_id IN (${placeholders})
         AND e.verification IN ${ACTIVE_VERIFICATIONS}
         AND (
           e.chapter_id IS NULL
           OR ec.order_index < (SELECT order_index FROM chapters WHERE id = ?)
         )
       ORDER BY e.id ASC`,
    )
    .all(...subjectIds, boundary.chapterId) as CharacterEventRow[];
  return rows.map(toCharacterEvent);
}

/** Знания одного героя на границе. Опровергнутое к этому моменту не
 *  возвращается: «знал, но уже знает, что это неправда» — не знание. */
export function loadKnowledgeAtBoundary(
  sqlite: DatabaseType,
  characterId: number,
  boundary: SceneBoundary,
): CharacterEvent[] {
  const order = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;
  return loadEventsAtBoundary(sqlite, [characterId], boundary).filter((e) => {
    if (e.kind !== "knowledge") return false;
    const d = e.data as { disprovedFromChapterOrder: number | null };
    if (d.disprovedFromChapterOrder === null || !order) return true;
    return d.disprovedFromChapterOrder > order.order_index;
  });
}
```

`ORDER BY e.id ASC` — не украшение: порядок должен быть стабильным, потому что эти строки едут в кэшируемый префикс промпта. Тот же довод, что у образцов речи на этапе 2.

- [ ] **Step 4: Перевести маршруты знаний на события**

В `apps/server/src/routes/entities.ts`:

- `GET /characters/:id/knowledge` — читает события вида `knowledge` этого героя (без границы: экран показывает всё, что известно автору) и отдаёт их в **прежней форме ответа** `{id, characterId, fact, learnedInChapterId, createdAt}`. Форма ответа не меняется: клиент `KnowledgePanel` переключается отдельной работой (решение 5).
- `POST /characters/:id/knowledge` — пишет событие `kind: "knowledge"`, `origin: "manual"`, `verification: "confirmed"`, `chapter_id` из `learnedInChapterId`, доказательства нет. Ответ прежней формы.
- `DELETE /character-knowledge/:id` — удаляет событие по его id.

Старую таблицу `character_knowledge` маршруты больше не читают и не пишут. Она остаётся в базе нетронутой до отдельной миграции — это страховка на случай, если что-то в переносе окажется неверным.

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/character-knowledge-boundary.test.ts src/routes/__tests__/entities.test.ts`
Expected: PASS оба файла. Существующие тесты знаний должны пройти без правки — форма ответа не менялась. Если какой-то потребовал правки, это значит, что форма всё-таки изменилась: остановиться и сказать об этом, а не подгонять тест.

- [ ] **Step 6: Коммит**

```bash
git add apps/server/src/utils/character-events.ts apps/server/src/routes/entities.ts apps/server/src/routes/__tests__/character-knowledge-boundary.test.ts
git commit -m "feat(events): знания читаются на границе сцены, маршруты поверх событий"
```

---

### Task 9: Эпизодическое состояние с условием завершения

**Files:**
- Modify: `apps/server/src/utils/character-events.ts`
- Test: `apps/server/src/utils/__tests__/character-state.test.ts`

**Interfaces:**
- Consumes: `loadEventsAtBoundary` (задача 8), `stateDataSchema` (задача 2).
- Produces: `loadActiveStates(sqlite, characterIds, boundary)`, тип `ActiveState`. Задача 12 зависит от них.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("AC-34: состояние с истёкшим сроком не переносится дальше", () => {
  // «Устала» со scope chapter, записано в главе 2 → в главе 5 её нет.
  const states = loadActiveStates(sqlite, [rinId], boundaryForChapter(bookId, ch5Id, null));
  expect(states.map((s) => s.state)).not.toContain("устала");
});

it("AC-34: состояние с неизвестным сроком помечается неопределённым, а не переносится точным", () => {
  const states = loadActiveStates(sqlite, [rinId], boundaryForChapter(bookId, ch5Id, null));
  const grudge = states.find((s) => s.state === "не простила смену");
  expect(grudge).toBeDefined();
  expect(grudge!.certainty).toBe("stale");
  expect(grudge!.observedAtChapterOrder).toBe(2);
});

it("состояние текущей главы действует", () => {
  const states = loadActiveStates(sqlite, [rinId], boundaryForChapter(bookId, ch3Id, null));
  expect(states.map((s) => s.state)).toContain("устала");
});

it("состояние с явным условием завершения несёт его наружу", () => {
  const states = loadActiveStates(sqlite, [rinId], boundaryForChapter(bookId, ch3Id, null));
  const s = states.find((x) => x.state === "ждёт ответа Сарека");
  expect(s!.endCondition).toBe("пока Сарек не ответит");
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/character-state.test.ts`
Expected: FAIL — `loadActiveStates` не экспортирована.

- [ ] **Step 3: Написать отбор состояний**

Дописать в `apps/server/src/utils/character-events.ts`:

```ts
export interface ActiveState {
  subjectCharacterId: number;
  state: string;
  endCondition: string | null;
  observedAtChapterOrder: number | null;
  /** `fresh` — наблюдалось в этой или соседней главе. `stale` — наблюдалось
   *  давно, срок неизвестен. Точный уровень усталости через двадцать глав
   *  выдумывать запрещено; честный ответ — «последнее наблюдение тогда-то,
   *  дальше неизвестно» (раздел 5.4, AC-34). */
  certainty: "fresh" | "stale";
}

/** За сколько глав наблюдение перестаёт считаться свежим, если срок не задан. */
const STATE_FRESH_WINDOW = 2;

export function loadActiveStates(
  sqlite: DatabaseType,
  subjectIds: number[],
  boundary: SceneBoundary,
): ActiveState[] {
  const at = sqlite
    .prepare("SELECT order_index FROM chapters WHERE id = ?")
    .get(boundary.chapterId) as { order_index: number } | undefined;
  const nowOrder = at?.order_index ?? 0;

  const out: ActiveState[] = [];
  for (const e of loadEventsAtBoundary(sqlite, subjectIds, boundary)) {
    if (e.kind !== "state") continue;
    const d = e.data as {
      state: string;
      scope: string;
      endsAtChapterOrder: number | null;
      endCondition: string | null;
    };
    const seenAt = e.chapterId
      ? ((
          sqlite
            .prepare("SELECT order_index FROM chapters WHERE id = ?")
            .get(e.chapterId) as { order_index: number } | undefined
        )?.order_index ?? null)
      : null;

    // Явный срок кончился — состояние больше не действует.
    if (d.endsAtChapterOrder !== null && d.endsAtChapterOrder <= nowOrder) continue;
    // Область «сцена» или «глава» без явного срока: действует только там,
    // где наблюдалось.
    if (
      (d.scope === "scene" || d.scope === "chapter") &&
      d.endsAtChapterOrder === null &&
      seenAt !== null &&
      seenAt < nowOrder
    ) {
      continue;
    }

    out.push({
      subjectCharacterId: e.subjectCharacterId,
      state: d.state,
      endCondition: d.endCondition,
      observedAtChapterOrder: seenAt,
      certainty:
        seenAt !== null && nowOrder - seenAt > STATE_FRESH_WINDOW ? "stale" : "fresh",
    });
  }
  return out;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/character-state.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/character-events.ts apps/server/src/utils/__tests__/character-state.test.ts
git commit -m "feat(events): эпизодическое состояние не переносится бессрочно"
```

---

### Task 10: Сводка ранних глав не заглядывает вперёд

**Files:**
- Modify: `apps/server/src/utils/rolling-context.ts`
- Test: `apps/server/src/utils/__tests__/rolling-context.test.ts` (дописать)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `loadRollingChapterContext` перестаёт использовать сводку, выходящую за границу.

- [ ] **Step 1: Написать падающий тест**

```ts
it("AC-10: сводка, покрывающая главы позже границы, не используется", async () => {
  // Книга из 12 глав, сводка покрывает 1–20 (сохранена, когда книга была длиннее).
  // Готовим контекст для главы 10.
  const ctx = loadRollingChapterContext(sqlite, bookId, 10)!;
  expect(ctx).not.toContain("СВОДКА_ДО_ДВАДЦАТОЙ");
  // Ранние главы при этом не пропадают — они возвращаются поглавно.
  expect(ctx).toContain("Глава 1");
});

it("сводка в пределах границы по-прежнему используется", async () => {
  const ctx = loadRollingChapterContext(sqlite, bookId, 12)!;
  expect(ctx).toContain("СВОДКА_ДО_ДЕВЯТОЙ");
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/rolling-context.test.ts`
Expected: FAIL — первый тест находит текст сводки за границей.

- [ ] **Step 3: Добавить границу**

В `apps/server/src/utils/rolling-context.ts`, в `loadRollingChapterContext`, после чтения `meta`:

```ts
    // Сводка, покрывающая главы ПОЗЖЕ границы, пересказывает ещё не
    // написанное с точки зрения этой сцены. Раньше она бралась без проверки,
    // и при генерации главы 10 в промпт уходил пересказ вплоть до двадцатой
    // (AC-10). Такую сводку не используем вовсе — ранние главы отдаются
    // поглавно, это дороже по месту, но не лжёт.
    const usableMeta =
      meta && meta.covers_to_order < beforeOrderIndex ? meta : undefined;
```

Дальше вместо `meta` использовать `usableMeta` во всех трёх ветвях. Ветка «сводки нет» уже умеет отдавать главы поглавно — она и обрабатывает этот случай.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/rolling-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/rolling-context.ts apps/server/src/utils/__tests__/rolling-context.test.ts
git commit -m "fix(memory): сводка ранних глав не заглядывает за границу сцены"
```

---

### Task 11: Сводка пересчитывается при правке внутри её диапазона

**Files:**
- Create: `apps/server/drizzle/0024_meta_summary_fingerprint.sql` (через `drizzle:new`)
- Modify: `apps/server/drizzle/meta/_journal.json`, `apps/server/src/db/schema.ts`, `apps/server/src/utils/rolling-context.ts`
- Test: `apps/server/src/utils/__tests__/rolling-context.test.ts` (дописать)

**Interfaces:**
- Consumes: ничего.
- Produces: колонка `book_meta_summaries.source_fingerprint`; `metaSourceFingerprint(chapters)`.

- [ ] **Step 1: Написать падающий тест**

```ts
/** Новая принятая версия главы со своей поглавной сводкой. Именно смена
 *  `chapters.current_version_id` и делает отпечаток источников другим. */
function commitNewVersion(chapterId: number, text: string, summary: string): number {
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, content_json, content_text, word_count, summary, created_at)
       VALUES (?, '{}', ?, ?, ?, ?)`,
    )
    .run(chapterId, text, text.split(/\s+/).length, summary, now);
  const versionId = Number(info.lastInsertRowid);
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(versionId, chapterId);
  return versionId;
}

it("AC-11: правка главы внутри покрытого диапазона заставляет пересчитать сводку", async () => {
  // Книга из 12 глав, у каждой принятая версия со сводкой. Первый прогон
  // строит сводку по главам 1–9 (всё, что старше окна в три главы).
  await runMetaSummary(sqlite, bookId);

  // Глава 3 — внутри покрытого диапазона — получает другую версию.
  commitNewVersion(chapterIds.get(3)!, "совсем другой текст", "другая сводка главы 3");

  const r = await runMetaSummary(sqlite, bookId);
  expect(r.skipped).not.toBe("covered");
  expect(r.updated).toBe(true);
});

it("без изменений сводка не пересчитывается", async () => {
  await runMetaSummary(sqlite, bookId);
  const r = await runMetaSummary(sqlite, bookId);
  expect(r.skipped).toBe("covered");
});
```

Точные колонки `chapter_versions` сверить со `schema.ts` перед написанием — если у таблицы есть обязательные поля сверх перечисленных, вставка упадёт, и это будет выглядеть провалом логики, а не фикстуры. Агент `metaSummarize` мокируется по идиоме этого файла; возвращаемый им текст должен различаться между прогонами, иначе второй тест не отличит пересчёт от пропуска.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/rolling-context.test.ts`
Expected: FAIL — первый тест получает `skipped: "covered"`.

- [ ] **Step 3: Миграция**

```bash
pnpm --filter @book-forge/server drizzle:new 0024_meta_summary_fingerprint
```

```sql
-- Сводка ранних глав пропускалась по совпадению ДИАПАЗОНА, поэтому правка
-- главы внутри него сводку не обновляла и та навсегда описывала старый текст
-- (AC-11). Отпечаток описывает, из чего сводка собрана.
ALTER TABLE book_meta_summaries ADD COLUMN source_fingerprint TEXT;
```

Колонка nullable намеренно: у существующей строки отпечатка нет, и это правильно читается как «неизвестно из чего собрана» — такая сводка пересчитается один раз при первом же прогоне, что и нужно.

- [ ] **Step 4: Считать и сверять отпечаток**

В `apps/server/src/utils/rolling-context.ts`:

```ts
/** Отпечаток источников сводки: какие главы и КАКИЕ ИХ ВЕРСИИ в неё вошли.
 *  Сравнение по диапазону не ловит правку внутри него — именно так сводка
 *  и оставалась описывать старый текст главы 3 навсегда. */
function metaSourceFingerprint(
  rows: Array<{ order_index: number; version_id: number }>,
): string {
  return rows
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((r) => `${r.order_index}:${r.version_id}`)
    .join("|");
}
```

Запрос `summarized` дополнить `v.id AS version_id`. Условие пропуска заменить на:

```ts
    const fingerprint = metaSourceFingerprint(older);
    const existing = sqlite
      .prepare(
        `SELECT covers_to_order, source_fingerprint FROM book_meta_summaries WHERE book_id = ?`,
      )
      .get(bookId) as
      | { covers_to_order: number; source_fingerprint: string | null }
      | undefined;
    if (
      existing &&
      existing.covers_to_order >= coversTo &&
      existing.source_fingerprint === fingerprint
    ) {
      return { updated: false, coversTo, skipped: "covered" };
    }
```

И записывать `source_fingerprint` в `INSERT … ON CONFLICT DO UPDATE`.

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/rolling-context.test.ts`
Expected: PASS.

Run: `pnpm --filter @book-forge/server test`
Expected: всё зелёное.

- [ ] **Step 6: Коммит**

```bash
git add apps/server/drizzle/0024_meta_summary_fingerprint.sql apps/server/drizzle/meta/_journal.json apps/server/src/db/schema.ts apps/server/src/utils/rolling-context.ts apps/server/src/utils/__tests__/rolling-context.test.ts
git commit -m "fix(memory): сводка пересчитывается при правке внутри её диапазона"
```

---

### Task 12: Контекст персонажа читает знания на границе

**Files:**
- Modify: `packages/agents/src/character.ts`, `apps/server/src/utils/chapter-prose-context.ts`
- Test: `packages/agents/src/__tests__/character-context.test.ts` (дописать)

**Interfaces:**
- Consumes: `loadKnowledgeAtBoundary`, `loadActiveStates` (задачи 8–9), `boundaryForChapter` (задача 1).
- Produces: `gatherCharacterContext(sqlite, bookId, texts, alwaysIncludeIds?, boundary?)`; `CharacterAgentResult` получает `states: ActiveState[]`; `CharacterContext.knowledge` меняет тип с записи `character_knowledge` на данные события знания (`{ fact, acquisition, source, canonFactId, disprovedFromChapterOrder }`). Последнее — ломающее изменение типа внутри пакета: прежний тип удаляется, а не остаётся рядом.

- [ ] **Step 1: Написать падающие тесты**

Этот файл уже существует с этапа 2 и не ходит в базу — `characterContextToPrompt` чистая функция. Фикстуры строятся вручную, как там:

```ts
const names = new Map([[1, "Рин"], [2, "Сарек"]]);

function ctx(over: Partial<CharacterAgentResult> = {}): CharacterAgentResult {
  return {
    characters: [
      {
        character: {
          id: 1, bookId: 3, canonicalName: "Рин", revision: 0,
          profile: normalizeCharacterProfile({ description: "Инженер." }),
          createdAt: "", updatedAt: "",
        },
        knowledge: [],
      },
    ],
    relationships: [],
    voiceSamples: [],
    states: [],
    ...over,
  };
}

it("AC-07: знание из поздней главы не попадает в промпт ранней", () => {
  // Сборка уже отсекла его по границе — в контекст оно не приходит вовсе.
  const text = characterContextToPrompt(
    ctx({
      characters: [
        {
          character: ctx().characters[0]!.character,
          knowledge: [{ fact: "Станцию закрывают", acquisition: "told" }],
        },
      ],
    }),
    names,
  );
  expect(text).toContain("Станцию закрывают");
  expect(text).not.toContain("Сарек — брат Селены");
});

it("состояние с неизвестным сроком показано как последнее наблюдение", () => {
  const text = characterContextToPrompt(
    ctx({
      states: [
        {
          subjectCharacterId: 1,
          state: "не простила смену",
          endCondition: null,
          observedAtChapterOrder: 2,
          certainty: "stale",
        },
      ],
    }),
    names,
  );
  expect(text).toContain("не простила смену");
  expect(text).toContain("наблюдалось в главе 2");
});

it("свежее состояние показано без оговорки о давности", () => {
  const text = characterContextToPrompt(
    ctx({
      states: [
        {
          subjectCharacterId: 1,
          state: "устала",
          endCondition: null,
          observedAtChapterOrder: 3,
          certainty: "fresh",
        },
      ],
    }),
    names,
  );
  expect(text).toContain("устала");
  expect(text).not.toContain("наблюдалось в главе");
});

it("без событий блок состояния не появляется", () => {
  expect(characterContextToPrompt(ctx(), names)).not.toContain("Сейчас с ним");
});
```

Форму `knowledge` в `CharacterContext` привести к тому, что отдаёт `loadKnowledgeAtBoundary` — прежний тип со ссылкой на строку `character_knowledge` больше не нужен, и оставлять его рядом значило бы держать два описания одного и того же.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/__tests__/character-context.test.ts`
Expected: FAIL — знания читаются без границы, блок состояния отсутствует.

- [ ] **Step 3: Перевести сборку контекста на события**

В `packages/agents/src/character.ts`:

- `gatherCharacterContext` принимает необязательный параметр `boundary?: SceneBoundary`. Без границы поведение прежнее — так вызовы, у которых главы в области видимости нет, продолжают работать.
- Знания читаются `loadKnowledgeAtBoundary`, а не запросом к `character_knowledge`. **Старый запрос удалить**, а не оставить рядом: два источника знаний — это ровно то, что раздел 6 запрещает.
- `CharacterAgentResult` получает `states: ActiveState[]`, заполняемые `loadActiveStates`. Вернуть их из **каждой** ветви, включая ранние с пустым результатом.
- `characterContextToPrompt` рисует блок «Сейчас с ним» только когда состояния есть; у состояния с `certainty: "stale"` печатает «наблюдалось в главе N», а не выдаёт его за текущее.

В `apps/server/src/utils/chapter-prose-context.ts` передать границу: `boundaryForChapter(book.id, ch.id, ch.current_version_id)`. Эта функция уже получает главу — придумывать ничего не нужно.

**Промпты Writer'а в этой задаче не меняются.** Это этап 5 со своим планом и утверждением. Признак нарушения границы — падение `packages/agents/src/__tests__/writer-prompt.test.ts`; если он упал, остановиться и доложить, а не править его.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/agents test`
Expected: PASS, включая `writer-prompt.test.ts` без правок.

Run: `pnpm --filter @book-forge/server test`
Expected: всё зелёное.

- [ ] **Step 5: Коммит**

```bash
git add packages/agents/src/character.ts apps/server/src/utils/chapter-prose-context.ts packages/agents/src/__tests__/character-context.test.ts
git commit -m "feat(agents): контекст персонажа считает знания на границе сцены"
```

---

### Task 13: Проверка на копии базы и документация

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-05-character-individuality.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: абзац «Сцены и память» в `CLAUDE.md`, отметка о выполнении в таблице раздела 18.

- [ ] **Step 1: Миграции на копии непустой базы**

```bash
export PATH="/c/Temp/claude/d--PROJECTS-BOOKOPIS/b6ea4f19-3d74-475e-b92a-4c997ca3e207/scratchpad/node-v22.23.2-win-x64:$PATH"
export SCRATCH="$(dirname "$(mktemp -u)")/bf-0023"
mkdir -p "$SCRATCH"
cp data/db.sqlite "$SCRATCH/before.sqlite"
cd apps/server && node -e "
const D=require('better-sqlite3');const d=new D(process.env.SCRATCH+'/before.sqlite',{readonly:true});
for(const t of ['books','chapters','chapter_versions','characters','relationships','character_knowledge','book_facts','book_notes'])
  console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c);
"
```
Записать числа **до**. Без них числа «после» ничего не доказывают.

```bash
cp "$SCRATCH/before.sqlite" "$SCRATCH/after.sqlite"
DB_PATH="$SCRATCH/after.sqlite" pnpm migrate
cd apps/server && node -e "
const D=require('better-sqlite3');const d=new D(process.env.SCRATCH+'/after.sqlite',{readonly:true});
for(const t of ['books','chapters','chapter_versions','characters','relationships','character_knowledge','book_facts','book_notes'])
  console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c);
console.log('events from migration:', d.prepare(\"SELECT COUNT(*) c FROM character_events WHERE origin='migration'\").get().c);
"
```
Expected: все прежние счётчики совпадают; число миграционных событий равно числу строк `character_knowledge`. Использовать копию, а не рабочую базу. **`export`, а не просто присваивание** — `node -e` читает `process.env.SCRATCH`, и неэкспортированная переменная даёт `undefined`.

- [ ] **Step 2: Удалить копии после проверки**

```bash
rm -rf "$SCRATCH"
```
Оставленная в репозитории копия базы — то, что кто-нибудь потом заметёт в коммит. Проверка записана в отчёт, файлы больше не нужны.

- [ ] **Step 3: Полный прогон**

```bash
pnpm typecheck
pnpm test
pnpm build
```
Expected: всё зелёное, вывод без предупреждений. Вставить в отчёт **настоящий хвост** каждой команды, а не код возврата: код возврата — не доказательство, которое читатель может проверить.

- [ ] **Step 4: Абзац в `CLAUDE.md`**

Дописать после абзаца «Персонажи V2», в той же манере — плотная русская проза, называющая **отказ, который предотвращает каждое решение**, а не перечень файлов. Обязательно должно прозвучать:

- Знания живут событиями, а не отдельной таблицей, и читаются **на границе сцены**: секрет из главы 8 не попадает в подготовку главы 4, потому что запрос отсекает события по порядку главы. Граница исключающая — то, что герой узнаёт в самой сцене, в её начальный контекст не входит.
- Порядок главы берётся join'ом к `chapters`, а не денормализованной колонкой: перестановка глав иначе оставила бы тихо неверную границу.
- Доказательство обязательно: `contentText.slice(start, end) === quote`, иначе событие не активируется. Модельный ответ не считается доверенным потому, что он правильной формы.
- Сдвиг отношения активируется как гипотеза, а не как факт: одна резкая реплика не делает «презирает всех» правдой.
- Услышанная ложь — знание героя с `acquisition: "told"`; объективный канон книги при этом не меняется.
- Эпизодическое состояние не переносится бессрочно: у него есть область действия, а наблюдение старше двух глав отдаётся как «последнее наблюдение тогда-то», а не как текущее.
- Новый вид задания в `memory_jobs` **не** заводился: список зашит в SQL `CHECK`, а SQLite не меняет `CHECK` через `ALTER TABLE`. Расширен контракт задания `facts`, `MEMORY_PIPELINE_VERSION` поднят до 2, и это же переразбирает уже обработанные главы.
- `INSERT OR IGNORE` при записи событий — намеренное отличие от `recordProfileVersion` этапа 2, где `OR IGNORE` был убран: там дубликат означал потерянное обновление, здесь он означает повторную обработку той же версии, чего AC-21 и требует.
- Два починенных дефекта сводки ранних глав: она бралась **без границы** (при генерации главы 10 в промпт уходил пересказ вплоть до двадцатой) и пропускалась по совпадению **диапазона**, а не содержимого (правка главы 3 внутри диапазона 1–20 сводку не обновляла никогда).

- [ ] **Step 5: Отметить этап в ТЗ**

В таблице раздела 18, строка этапа 3 — дописать в третью колонку: `Выполнено 2026-09-18, план: docs/superpowers/plans/2026-09-18-character-stage-3-scenes-and-memory.md`.

- [ ] **Step 6: Коммит**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-05-character-individuality.md
git commit -m "docs: сцены и память"
```

---

## Что этот этап сознательно не делает

- **Внутриглавных сцен нет.** Решение 2 ТЗ: одна неявная сцена на главу, `sceneOrdinal: 0`. Контракты принимают границу с первого дня, поэтому добавление настоящих сцен не потребует менять API. **AC-08 в этом этапе не проверяется** — он относится к следующему слайсу и не считается проваленным.
- **Карты сцен версии (`chapterVersionId` → границы текста) нет** — раздел 6 относит её к тому же последующему слайсу.
- **Снимки контекста (`GenerationContextSnapshot`) — этап 4.** Здесь события только пишутся и читаются; общий сборщик источников со своим отпечатком и бюджетом приходит следующим этапом.
- **Промпты Writer'а не меняются.** Правила и проверка состава — этап 5.
- **Экрана памяти персонажа нет.** Раздел 13 описывает «Состояние на выбранную сцену и переход к подтверждающему тексту»; он проектируется вместе с карточкой персонажа под фазу 4 конвейера, а не пристраивается к `KnowledgePanel`.
- **`character_knowledge` не удаляется.** Она остаётся нетронутой до отдельной миграции — страховка на случай, если перенос окажется неверным (решение 5).
- **AC-12–15, AC-16–20, AC-27–32, AC-35–37 сюда не входят** и проверяются на своих этапах.
