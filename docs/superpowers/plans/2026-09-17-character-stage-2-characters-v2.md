# Этап 2 «Персонажи V2»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карточка персонажа перестаёт быть семью строками текста: профиль V2 с ролями, ценностями, стратегиями и голосом, направленные отношения с независимыми качествами, банк образцов речи, монотонные ревизии с обязательным `expectedRevision` — и всё это читает старые книги без единой потери.

**Architecture:** Форма профиля разъезжается на две: **схема чтения** ничего не отбрасывает и никогда не бросает исключение (неизвестные ключи уезжают в `extra`, длина не ограничена), **схема записи** ограничивает размеры и отбивает мусор на входе маршрута. Тот же приём уже применён к `bookOutlineVariantSchema` в фазе 5 конвейера. Миграция 0022 только структурная: добавляет `revision`, одну общую таблицу истории принятых профилей и банк образцов речи, но **не переписывает ни одной строки `profile_json`** — нормализация живёт на чтении, поэтому ни одно старое поле не может исчезнуть из базы. Материализация Мастерской перестаёт быть `INSERT`-ом: кандидат, у которого уже есть `materializedEntityId`, обновляет свою строку с проверкой ревизии.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Hono, better-sqlite3, zod 4, React 18 + Vite, vitest.

**Spec:** [docs/superpowers/specs/2026-09-05-character-individuality.md](../specs/2026-09-05-character-individuality.md) — разделы 5.1, 5.2, 5.3, 6, 13, 14, 15; этап 2 таблицы раздела 18; критерии AC-01–06, AC-30–32, AC-35.

## Global Constraints

- Русский в интерфейсе, комментариях и сообщениях об ошибках; английские идентификаторы.
- TypeScript strict с `noUncheckedIndexedAccess`. ESM: относительные импорты внутри пакета оканчиваются на `.js`.
- Новых зависимостей не добавлять.
- **Проект только для настольного экрана.** Вёрстка уже 768px не важна, адаптивную работу не добавлять.
- **Схема чтения профиля никогда не бросает исключение.** `normalizeCharacterProfile` и `normalizeRelationshipProfile` вызываются на пути чтения строки из базы. Одно исключение там — и книга перестаёт открываться целиком. Неизвестные ключи сохраняются, слишком длинные значения сохраняются, мусор оборачивается, но не отбрасывается.
- **Ограничения размеров живут только в схемах записи** (`*WriteSchema`), которые применяются в маршрутах создания и изменения. Тот же раздел на «ослаблено в хранилище, закреплено на входе» уже есть у `bookOutlineVariantSchema` и `architecture` в [packages/shared/src/plot.ts](../../../packages/shared/src/plot.ts).
- **Миграция ничего не сочиняет** (INV-07, раздел 15.4 ТЗ). 0022 меняет структуру и ставит нули в `revision`. Она не вызывает LLM, не переписывает `profile_json`, не выдумывает `roleTier` и не превращает отсутствие сведений в значение.
- **`expectedRevision` обязателен** для `PATCH /characters/:id` и `PATCH /relationships/:id` с первого коммита. Единственный клиент — это веб-приложение из того же репозитория, переходного «необязательного» режима не заводить: с ним AC-02 не выполняется (решение раздела 5.1 ТЗ).
- **Ни одна ревизия не растёт без записи в историю.** `revision` и строка `entity_profile_versions` пишутся в одной транзакции.
- **Экран карточки персонажа в этом этапе не создаётся.** Раздел 18 ТЗ: «экран карточек проектировать один раз, под „составы“ фазы 4, а не под текущий `EntityStagePage`». Всё авторское редактирование V2 в этом этапе идёт в уже существующие вкладки `KnowledgePanel`.
- Миграции — штатным `pnpm --filter @book-forge/server drizzle:new <name>`. `drizzle:generate` запрещён: snapshots расходятся с реальной схемой с 0008.
- Новые серверные тесты делают `delete process.env.ANTHROPIC_API_KEY;` в `beforeEach` — `createApp` поднимает настоящий воркер памяти.
- Ставить в коммит только файлы своей задачи. Никогда `git add -A`: в рабочем дереве лежат чужие незакоммиченные правки в `import/` и `assets/`.

---

## Что уже выяснено про код (не перепроверять заново)

Эти факты собраны чтением HEAD 2026-09-17. Они меняют форму задач, поэтому вынесены до них.

1. **`role/age/background` теряются на чтении, а не на записи.** Материализация (`routes/studio.ts:1343`) кладёт в `profile_json` **весь** профиль кандидата, включая `role`, `age`, `background`. Теряет их `toCharacter` (`db/rows.ts:189`): `characterProfileSchema.parse` по умолчанию срезает неизвестные ключи. Значит у уже материализованных героев (в том числе у пилотного состава книги 3, id 22–27) эти поля **лежат в базе прямо сейчас** и восстанавливать их миграцией не нужно — достаточно перестать их срезать. Это и есть половина AC-35.
2. **`safeProfile` бросает исключение.** `db/rows.ts:180` — `schema.parse(JSON.parse(json))`. Профиль с пустым `description` или битым JSON роняет весь `GET /books/:id/characters`. Отсюда требование «схема чтения не бросает».
3. **`PATCH /characters/:id` и `PATCH /relationships/:id` перезаписывают молча** (`routes/entities.ts:102-128`, `443-469`): читают строку, накладывают поля, пишут. Ни ревизии, ни сравнения.
4. **Ни один экран не вызывает `api.updateCharacter` и `api.updateRelationship`.** Поиск по `apps/web/src` даёт только определения в `api/client.ts`. Значит обязательный `expectedRevision` ничего не ломает в интерфейсе: правится сигнатура клиента, а не экраны.
5. **Единственный существующий редактор сущностей — `KnowledgePanel`** (`apps/web/src/components/KnowledgePanel.tsx`, 441 строка, вкладки Characters/Locations/Items/Hooks/Relationships), примонтирован в `ChaptersStagePage.tsx:187`. `RelationshipsTab` умеет создавать связь (от/к/тип/tension) и удалять. Экрана карточки персонажа в приложении нет вообще.
6. **`resolveEntity` (`utils/entity-resolve.ts:26`) на неоднозначности берёт первое совпадение** — `rows.find(...)`. Два героя с одинаковым нормализованным именем в одной книге дают тихий выбор «случайного». Алиасы уже хранятся нормализованными (`addEntityAlias` нормализует перед вставкой), уникальность — пара «книга + тип + алиас».
7. **Материализация всегда `INSERT`** (`routes/studio.ts:1300-1355`). Идемпотентность есть только по `requestKey` — набору `tempId`. Автор, изменивший состав и нажавший «Добавить в канон» второй раз, получает дубликаты строк `characters`.
8. **Следующий номер миграции — 0022.** В `apps/server/drizzle/meta/_journal.json` последняя запись `idx: 21`, `tag: "0021_critique_partial"`.
9. **CHECK-ограничения менять не нужно.** Все новые значения перечислений живут в новых таблицах; в существующие таблицы добавляются только колонки. Перестройки таблиц в 0022 нет.

## Порядок и промежуточные состояния

Задачи 1–3 — только пакет `shared`: схемы и чистые функции, сервер их ещё не видит. Задача 4 — миграция и слой строк, после неё API уже отдаёт V2 и `revision`. Задачи 5–6 закрывают ревизии и банк голоса на сервере, 7 чинит материализацию, 8 — резолвер. 9–10 — интерфейс и сборка контекста. 11 — документация и прогон на копии реальной базы.

После задачи 4 и до задачи 5 `GET` уже отдаёт `revision`, а `PATCH` его ещё не требует — окно в один-два коммита, где старое поведение перезаписи сохраняется. Это ожидаемо, заглушку не городить.

## File Structure

**Создаются:**

| Файл | Ответственность |
|---|---|
| `packages/shared/src/character-profile.ts` | Схема профиля V2 (чтение и запись), `normalizeCharacterProfile`, профиль голоса как часть карточки |
| `packages/shared/src/character-voice.ts` | Банк образцов речи: схема записи образца, перечисления, детерминированный отбор `selectVoiceSamples` |
| `packages/shared/src/relationship-profile.ts` | Направленные качества отношения A → B, `normalizeRelationshipProfile` |
| `apps/server/drizzle/0022_characters_v2.sql` | Ревизии, общая таблица истории принятых профилей, банк образцов речи |
| `apps/server/src/utils/entity-revisions.ts` | Одна транзакция «проверить ревизию → записать → нарастить → положить в историю» для персонажа и отношения |
| `apps/web/src/components/VoiceSamples.tsx` | Список, добавление, принятие и удаление образцов речи одного героя |
| `apps/web/src/components/RelationshipQualities.tsx` | Редактор направленных качеств одного отношения с `expectedRevision` и разбором 409 |

**Изменяются:**

| Файл | Что меняется |
|---|---|
| `packages/shared/src/entities.ts` | `characterSchema.profile` → V2, `+revision`; `relationshipSchema` `+revision` `+profile`; входные схемы получают `expectedRevision` |
| `packages/shared/src/index.ts` | Экспорт трёх новых модулей |
| `packages/shared/src/studio-state.ts` | `entityCandidateSchema.profile` — типизированная схема вместо `z.unknown()`, `+materializedEntityId` в запрос материализации |
| `apps/server/src/db/schema.ts` | Колонки `revision`, `profile_json`, две новые таблицы (для типов и документации) |
| `apps/server/src/db/rows.ts` | `toCharacter`/`toRelationship` через нормализаторы; `CharacterVoiceSampleRow` + `toVoiceSample` |
| `apps/server/src/routes/entities.ts` | `expectedRevision` в обоих `PATCH`, 409, маршруты образцов речи, уборка истории при удалении |
| `apps/server/src/routes/studio.ts` | Материализация: upsert по `materializedEntityId`, нормализация профиля, проверка книги у `mergedIntoId` |
| `apps/server/src/utils/entity-resolve.ts` | Неоднозначное имя больше не резолвится в «первого попавшегося» |
| `packages/agents/src/character.ts` | Контекст персонажа отдаёт качества направления и отобранные образцы речи |
| `apps/web/src/api/client.ts` | `expectedRevision` в сигнатурах, функции банка голоса |
| `apps/web/src/components/KnowledgePanel.tsx` | Вкладка персонажей показывает `VoiceSamples`, вкладка отношений — `RelationshipQualities` |
| `CLAUDE.md` | Абзац «Персонажи V2» |
| `docs/superpowers/specs/2026-09-05-character-individuality.md` | Отметка о выполнении этапа 2 в таблице раздела 18 |

---

### Task 1: Схема профиля V2 и нормализатор

**Files:**
- Create: `packages/shared/src/character-profile.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/character-profile.test.ts`

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: `characterProfileV2Schema`, `characterProfileWriteSchema`, `normalizeCharacterProfile(raw: unknown): CharacterProfileV2`, типы `CharacterProfileV2`, `RoleTier`, `VoiceProfile`, константа `ROLE_TIERS`. Задачи 4, 5, 7, 9, 10 зависят от этих имён.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/character-profile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeCharacterProfile,
  characterProfileWriteSchema,
} from "./character-profile.js";

describe("normalizeCharacterProfile", () => {
  it("AC-01: старая карточка V1 проходит без потерь", () => {
    const v1 = {
      description: "Инженер тишины, держит смену на себе.",
      want: "вернуть станцию",
      need: "разрешить себе просить помощь",
      lie: "просьба — это слабость",
      voice: "короткие фразы, без прилагательных",
      appearance: "седые виски, ожог на левой руке",
      arc: "от одиночки к части команды",
      notes: "автор: не давать ей плакать на людях",
    };
    const p = normalizeCharacterProfile(v1);
    expect(p.schemaVersion).toBe(2);
    expect(p.description).toBe(v1.description);
    expect(p.want).toBe(v1.want);
    expect(p.need).toBe(v1.need);
    expect(p.lie).toBe(v1.lie);
    expect(p.voice).toBe(v1.voice);
    expect(p.appearance).toBe(v1.appearance);
    expect(p.arc).toBe(v1.arc);
    expect(p.notes).toBe(v1.notes);
  });

  it("AC-01: психологические сведения не сочиняются", () => {
    const p = normalizeCharacterProfile({ description: "Курьер." });
    expect(p.roleTier).toBeNull();
    expect(p.values).toEqual([]);
    expect(p.principles).toEqual([]);
    expect(p.contradictions).toEqual([]);
    expect(p.goals).toEqual([]);
    expect(p.strategies.refuses).toBeNull();
  });

  it("AC-35: поля кандидата Мастерской сохраняются", () => {
    const p = normalizeCharacterProfile({
      name: "Рин Даре",
      role: "протагонист",
      age: "34",
      description: "Старший инженер смены.",
      background: "Выросла на орбитальной верфи.",
    });
    expect(p.role).toBe("протагонист");
    expect(p.age).toBe("34");
    expect(p.background).toBe("Выросла на орбитальной верфи.");
    expect(p.name).toBe("Рин Даре");
  });

  it("неизвестные ключи уезжают в extra, а не пропадают", () => {
    const p = normalizeCharacterProfile({
      description: "X",
      somethingOld: { a: 1 },
    });
    expect(p.extra).toEqual({ somethingOld: { a: 1 } });
  });

  it("чтение не бросает на длинном тексте и на мусоре", () => {
    const long = "я".repeat(50_000);
    expect(normalizeCharacterProfile({ description: long }).description).toBe(long);
    expect(() => normalizeCharacterProfile(null)).not.toThrow();
    expect(() => normalizeCharacterProfile("строка")).not.toThrow();
    expect(() => normalizeCharacterProfile({ want: 42 })).not.toThrow();
    expect(normalizeCharacterProfile(null).description).toBe("");
  });

  it("AC-03: эпизодический герой без анкеты — валидный профиль", () => {
    const p = normalizeCharacterProfile({
      description: "Охранник на воротах, одна сцена.",
      roleTier: "episodic",
    });
    expect(p.roleTier).toBe("episodic");
    expect(characterProfileWriteSchema.safeParse(p).success).toBe(true);
  });

  it("повторная нормализация ничего не меняет", () => {
    const once = normalizeCharacterProfile({ description: "X", role: "друг" });
    expect(normalizeCharacterProfile(once)).toEqual(once);
  });

  it("схема записи отбивает слишком длинное описание", () => {
    const r = characterProfileWriteSchema.safeParse({
      ...normalizeCharacterProfile({ description: "X" }),
      description: "я".repeat(20_001),
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/character-profile.test.ts`
Expected: FAIL, `Failed to resolve import "./character-profile.js"`.

- [ ] **Step 3: Написать модуль**

Создать `packages/shared/src/character-profile.ts`:

```ts
import { z } from "zod";

/** Профиль персонажа V2 (ТЗ индивидуальности, раздел 5.1).
 *
 *  Схем две, и это не дублирование.
 *  `characterProfileV2Schema` — схема ЧТЕНИЯ. Она не ограничивает длину и
 *  ничего не требует: её применяют к тому, что уже лежит в базе, и падение
 *  на ней означает, что книга перестала открываться. Тот же приём уже
 *  применён к повествовательным полям `bookOutlineVariantSchema`.
 *  `characterProfileWriteSchema` — схема ЗАПИСИ, с пределами; её применяют
 *  маршруты создания и изменения. */

export const ROLE_TIERS = ["main", "recurring", "episodic"] as const;
export const roleTierSchema = z.enum(ROLE_TIERS);
export type RoleTier = z.infer<typeof roleTierSchema>;

/** Неизвестно — это `null`, а не пустая строка: «сведений нет» и «автор
 *  стёр текст» — разные события (раздел 5.1: отсутствие сведений не равно
 *  отсутствию качества). */
const line = z.string().nullable().default(null);

export const characterGoalSchema = z.object({
  goal: z.string(),
  horizon: z.enum(["long", "current"]).default("current"),
  conflictsWith: z.string().nullable().default(null),
});

export const characterValueSchema = z.object({
  value: z.string(),
  priority: z.number().int().nullable().default(null),
  context: line,
  price: line,
});

export const characterPrincipleSchema = z.object({
  rule: z.string(),
  scope: line,
  exceptions: line,
  cost: line,
});

export const characterStrategiesSchema = z.object({
  asks: line,
  refuses: line,
  defends: line,
  persuades: line,
  cares: line,
  argues: line,
});

export const characterEverydaySchema = z.object({
  attachments: line,
  pleasure: line,
  irritation: line,
  habits: line,
  humour: line,
});

export const characterPerceptionSchema = z.object({
  noticesFirst: line,
  misses: line,
  explainsBy: line,
});

/** Профиль голоса — часть карточки. Банк образцов речи лежит отдельно
 *  (таблица `character_voice_samples`), см. `character-voice.ts`. */
export const voiceProfileSchema = z.object({
  lineLength: line,
  pauses: line,
  vocabulary: line,
  abstractness: line,
  jargon: line,
  agrees: line,
  refuses: line,
  asks: line,
  cares: line,
  irritated: line,
  humour: line,
  selfCensorship: line,
  tabooTopics: line,
  /** Различия речи по собеседнику: ключ — ситуация из
   *  `VOICE_SAMPLE_SITUATIONS`, значение — короткое описание регистра. */
  registers: z.record(z.string(), z.string()).default({}),
  underStress: line,
  whenTired: line,
  whenSafe: line,
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const characterAuthorPlanSchema = z.object({
  arc: line,
  futureTrials: line,
  constraints: line,
});

export const characterProfileV2Schema = z.object({
  schemaVersion: z.literal(2),

  // V1: сохраняется дословно и навсегда (AC-01).
  description: z.string().default(""),
  want: line,
  need: line,
  lie: line,
  voice: line,
  appearance: line,
  arc: line,
  notes: line,

  // Поля кандидата Мастерской (AC-35). `name` дублирует
  // `characters.canonical_name` и остаётся тем, что предложила модель.
  name: line,
  role: line,
  age: line,
  background: line,

  // V2.
  roleTier: roleTierSchema.nullable().default(null),
  goals: z.array(characterGoalSchema).default([]),
  values: z.array(characterValueSchema).default([]),
  principles: z.array(characterPrincipleSchema).default([]),
  contradictions: z.array(z.string()).default([]),
  strategies: characterStrategiesSchema.default({}),
  everyday: characterEverydaySchema.default({}),
  perception: characterPerceptionSchema.default({}),
  voiceProfile: voiceProfileSchema.default({}),
  authorPlan: characterAuthorPlanSchema.default({}),

  /** Всё, чего схема не знает. Единственная гарантия, что нормализация
   *  никогда не теряет авторские сведения (INV-07). */
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type CharacterProfileV2 = z.infer<typeof characterProfileV2Schema>;

const KNOWN_KEYS = new Set(Object.keys(characterProfileV2Schema.shape));

/** Пределы для входящих данных. Всё, что не перечислено, наследуется от
 *  схемы чтения. */
export const characterProfileWriteSchema = characterProfileV2Schema.extend({
  description: z.string().max(20_000),
  notes: z.string().max(20_000).nullable().default(null),
  background: z.string().max(20_000).nullable().default(null),
  goals: z.array(characterGoalSchema).max(20).default([]),
  values: z.array(characterValueSchema).max(20).default([]),
  principles: z.array(characterPrincipleSchema).max(20).default([]),
  contradictions: z.array(z.string().max(2000)).max(20).default([]),
});

/** Приводит что угодно из базы, импорта или ответа модели к V2 без потерь.
 *  Никогда не бросает: вызывается на чтении строки. */
export function normalizeCharacterProfile(raw: unknown): CharacterProfileV2 {
  const base = characterProfileV2Schema.parse({ schemaVersion: 2 });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    // Не объект — сохранить как есть и не выдумывать описание.
    return raw === null || raw === undefined
      ? base
      : { ...base, extra: { raw } };
  }

  const source = raw as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "extra") continue;
    (KNOWN_KEYS.has(key) ? known : extra)[key] = value;
  }
  // `extra` предыдущей нормализации не теряется при повторном проходе.
  const priorExtra = source["extra"];
  if (priorExtra && typeof priorExtra === "object" && !Array.isArray(priorExtra)) {
    Object.assign(extra, priorExtra as Record<string, unknown>);
  }

  const parsed = characterProfileV2Schema.safeParse({
    ...known,
    schemaVersion: 2,
  });
  if (parsed.success) return { ...parsed.data, extra };

  // Часть полей не той формы. Разбираем по одному: валидное — в профиль,
  // невалидное — в `extra`, чтобы автор увидел его и починил руками.
  const salvaged: Record<string, unknown> = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(known)) {
    const field = characterProfileV2Schema.shape[
      key as keyof typeof characterProfileV2Schema.shape
    ];
    if (field && field.safeParse(value).success) salvaged[key] = value;
    else extra[key] = value;
  }
  return { ...characterProfileV2Schema.parse(salvaged), extra };
}
```

Дописать в `packages/shared/src/index.ts` рядом с остальными:

```ts
export * from "./character-profile.js";
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/shared test -- src/character-profile.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Проверить типы**

Run: `pnpm --filter @book-forge/shared typecheck`
Expected: без ошибок. Если `z.object(...).default({})` не проходит в zod 4 из-за обязательных ключей — заменить на `.default(() => characterStrategiesSchema.parse({}))` для каждой такой группы; все поля внутри групп имеют `.default(null)`, поэтому `parse({})` валиден.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/character-profile.ts packages/shared/src/character-profile.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): профиль персонажа V2 читается без потерь"
```

---

### Task 2: Банк образцов речи и детерминированный отбор

**Files:**
- Create: `packages/shared/src/character-voice.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/character-voice.test.ts`

**Interfaces:**
- Consumes: ничего из задачи 1 (модули независимы).
- Produces: `VOICE_SAMPLE_SITUATIONS`, `VOICE_SAMPLE_ORIGINS`, `VOICE_SAMPLE_STATUSES`, `characterVoiceSampleSchema`, `createVoiceSampleInputSchema`, `updateVoiceSampleInputSchema`, `selectVoiceSamples(samples, selection)`, типы `CharacterVoiceSample`, `VoiceSampleSituation`, `VoiceSampleSelection`. Задачи 4, 6, 9, 10 зависят от этих имён.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/character-voice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  selectVoiceSamples,
  type CharacterVoiceSample,
} from "./character-voice.js";

function sample(p: Partial<CharacterVoiceSample>): CharacterVoiceSample {
  return {
    id: 1,
    bookId: 3,
    characterId: 22,
    text: "…",
    situation: "neutral",
    addresseeCharacterId: null,
    note: null,
    origin: "author",
    status: "accepted",
    sourceVersionId: null,
    sourceChapterOrder: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...p,
  };
}

const bank: CharacterVoiceSample[] = [
  sample({ id: 1, situation: "neutral", text: "нейтрально" }),
  sample({ id: 2, situation: "authority", text: "с начальником" }),
  sample({ id: 3, situation: "intimate", text: "с близким" }),
  sample({ id: 4, situation: "authority", addresseeCharacterId: 23, text: "с Сареком-начальником" }),
  sample({ id: 5, situation: "conflict", status: "proposed", text: "непринятый" }),
  sample({ id: 6, situation: "intimate", sourceChapterOrder: 12, text: "из поздней главы" }),
];

describe("selectVoiceSamples", () => {
  it("AC-06: начальник и близкий дают разные наборы", () => {
    const boss = selectVoiceSamples(bank, { situation: "authority", limit: 1 });
    const close = selectVoiceSamples(bank, { situation: "intimate", limit: 1 });
    expect(boss[0]?.text).toBe("с начальником");
    expect(close[0]?.text).toBe("с близким");
  });

  it("AC-06: конкретный адресат весит больше типа ситуации", () => {
    const picked = selectVoiceSamples(bank, {
      situation: "authority",
      addresseeCharacterId: 23,
      limit: 1,
    });
    expect(picked[0]?.id).toBe(4);
  });

  it("AC-15: одинаковые входы дают один и тот же порядок", () => {
    const a = selectVoiceSamples(bank, { situation: "authority", limit: 3 });
    const b = selectVoiceSamples([...bank].reverse(), { situation: "authority", limit: 3 });
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it("непринятые образцы не отбираются", () => {
    const picked = selectVoiceSamples(bank, { situation: "conflict", limit: 5 });
    expect(picked.map((s) => s.id)).not.toContain(5);
  });

  it("образец из поздней главы не попадает в раннюю сцену", () => {
    const early = selectVoiceSamples(bank, {
      situation: "intimate",
      beforeChapterOrder: 4,
      limit: 5,
    });
    expect(early.map((s) => s.id)).not.toContain(6);
    const late = selectVoiceSamples(bank, {
      situation: "intimate",
      beforeChapterOrder: 20,
      limit: 5,
    });
    expect(late.map((s) => s.id)).toContain(6);
  });

  it("limit соблюдается и пустой банк не падает", () => {
    expect(selectVoiceSamples(bank, { situation: "neutral", limit: 2 })).toHaveLength(2);
    expect(selectVoiceSamples([], { situation: "neutral" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/character-voice.test.ts`
Expected: FAIL, `Failed to resolve import "./character-voice.js"`.

- [ ] **Step 3: Написать модуль**

Создать `packages/shared/src/character-voice.ts`:

```ts
import { z } from "zod";

/** Банк образцов речи (ТЗ индивидуальности, раздел 5.2).
 *
 *  Отбор обязан быть детерминированным при одинаковых входах: образцы едут
 *  в кэшируемый префикс промпта Writer'а, и `ORDER BY random()` там уже
 *  однажды стоил полного промаха кэша на каждую генерацию
 *  (см. `style-context.ts`). Здесь случайности нет ни в одном виде. */

export const VOICE_SAMPLE_SITUATIONS = [
  "neutral",
  "conflict",
  "vulnerable",
  "authority",
  "intimate",
  "stranger",
] as const;
export const voiceSampleSituationSchema = z.enum(VOICE_SAMPLE_SITUATIONS);
export type VoiceSampleSituation = z.infer<typeof voiceSampleSituationSchema>;

/** Подписи для интерфейса: внутренний код латиницей в русском экране не
 *  показывается (тот же разбор, что у `ASPECT_STATUS_LABEL`). */
export const VOICE_SITUATION_LABELS: Record<VoiceSampleSituation, string> = {
  neutral: "обычный разговор",
  conflict: "конфликт",
  vulnerable: "уязвимость",
  authority: "с начальником",
  intimate: "с близким",
  stranger: "с незнакомцем",
};

export const VOICE_SAMPLE_ORIGINS = ["author", "accepted_prose", "llm"] as const;
export const voiceSampleOriginSchema = z.enum(VOICE_SAMPLE_ORIGINS);
export type VoiceSampleOrigin = z.infer<typeof voiceSampleOriginSchema>;

export const VOICE_SAMPLE_STATUSES = ["proposed", "accepted", "rejected"] as const;
export const voiceSampleStatusSchema = z.enum(VOICE_SAMPLE_STATUSES);
export type VoiceSampleStatus = z.infer<typeof voiceSampleStatusSchema>;

export const characterVoiceSampleSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  characterId: z.number().int().positive(),
  text: z.string(),
  situation: voiceSampleSituationSchema,
  addresseeCharacterId: z.number().int().positive().nullable(),
  note: z.string().nullable(),
  origin: voiceSampleOriginSchema,
  status: voiceSampleStatusSchema,
  sourceVersionId: z.number().int().positive().nullable(),
  /** Порядок главы-источника. Нужен, чтобы образец из главы 12 не утёк в
   *  подготовку главы 4 (раздел 5.2). */
  sourceChapterOrder: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CharacterVoiceSample = z.infer<typeof characterVoiceSampleSchema>;

export const createVoiceSampleInputSchema = z.object({
  text: z.string().min(1).max(2000),
  situation: voiceSampleSituationSchema,
  addresseeCharacterId: z.number().int().positive().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  origin: voiceSampleOriginSchema.default("author"),
  status: voiceSampleStatusSchema.optional(),
  sourceVersionId: z.number().int().positive().nullable().optional(),
  sourceChapterOrder: z.number().int().nonnegative().nullable().optional(),
});
export type CreateVoiceSampleInput = z.infer<typeof createVoiceSampleInputSchema>;

export const updateVoiceSampleInputSchema = z.object({
  status: voiceSampleStatusSchema,
});
export type UpdateVoiceSampleInput = z.infer<typeof updateVoiceSampleInputSchema>;

export interface VoiceSampleSelection {
  situation: VoiceSampleSituation;
  addresseeCharacterId?: number | null;
  /** Граница сцены. Образец, взятый из главы с этим порядком или позже,
   *  отбрасывается. `null`/`undefined` — границы нет. */
  beforeChapterOrder?: number | null;
  limit?: number;
}

/** Отбор образцов: только принятые, только не из будущего, дальше —
 *  релевантность и стабильный порядок по id. Случайности нет. */
export function selectVoiceSamples(
  samples: CharacterVoiceSample[],
  selection: VoiceSampleSelection,
): CharacterVoiceSample[] {
  const limit = selection.limit ?? 3;
  const boundary = selection.beforeChapterOrder ?? null;
  const scored = samples
    .filter((s) => s.status === "accepted")
    .filter(
      (s) =>
        boundary === null ||
        s.sourceChapterOrder === null ||
        s.sourceChapterOrder < boundary,
    )
    .map((s) => {
      let score = 0;
      if (s.situation === selection.situation) score += 4;
      if (
        selection.addresseeCharacterId != null &&
        s.addresseeCharacterId === selection.addresseeCharacterId
      ) {
        score += 3;
      }
      if (s.origin === "author") score += 1;
      return { sample: s, score };
    })
    .filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score || a.sample.id - b.sample.id);
  return scored.slice(0, limit).map((x) => x.sample);
}
```

Дописать в `packages/shared/src/index.ts`:

```ts
export * from "./character-voice.js";
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/shared test -- src/character-voice.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/shared/src/character-voice.ts packages/shared/src/character-voice.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): банк образцов речи с детерминированным отбором"
```

---

### Task 3: Направленные качества отношения

**Files:**
- Create: `packages/shared/src/relationship-profile.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/relationship-profile.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `directedRelationshipSchema`, `directedRelationshipWriteSchema`, `normalizeRelationshipProfile(raw: unknown): DirectedRelationship`, `RELATIONSHIP_QUALITY_LABELS`, тип `DirectedRelationship`. Задачи 4, 5, 9, 10 зависят от них.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/relationship-profile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeRelationshipProfile,
  directedRelationshipWriteSchema,
} from "./relationship-profile.js";

describe("normalizeRelationshipProfile", () => {
  it("пустое отношение — все качества неизвестны", () => {
    const p = normalizeRelationshipProfile(null);
    expect(p.schemaVersion).toBe(2);
    expect(p.trust).toBeNull();
    expect(p.respect).toBeNull();
    expect(p.disputes).toEqual([]);
    expect(p.silences).toEqual([]);
  });

  it("сочетание «уважает компетентность, не доверяет обещаниям» хранится как есть", () => {
    const p = normalizeRelationshipProfile({
      respect: "уважает компетентность",
      trust: "не доверяет обещаниям",
    });
    expect(p.respect).toBe("уважает компетентность");
    expect(p.trust).toBe("не доверяет обещаниям");
  });

  it("качества не выводятся из tension", () => {
    const p = normalizeRelationshipProfile({ tension: -0.9 });
    expect(p.trust).toBeNull();
    expect(p.fear).toBeNull();
    expect(p.extra).toEqual({ tension: -0.9 });
  });

  it("чтение не бросает на мусоре", () => {
    expect(() => normalizeRelationshipProfile("строка")).not.toThrow();
    expect(() => normalizeRelationshipProfile({ trust: 5 })).not.toThrow();
    expect(normalizeRelationshipProfile({ trust: 5 }).extra).toEqual({ trust: 5 });
  });

  it("схема записи ограничивает длину", () => {
    const ok = directedRelationshipWriteSchema.safeParse(
      normalizeRelationshipProfile({ trust: "верит на слово" }),
    );
    expect(ok.success).toBe(true);
    const tooLong = directedRelationshipWriteSchema.safeParse({
      ...normalizeRelationshipProfile(null),
      trust: "я".repeat(2001),
    });
    expect(tooLong.success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/relationship-profile.test.ts`
Expected: FAIL, `Failed to resolve import "./relationship-profile.js"`.

- [ ] **Step 3: Написать модуль**

Создать `packages/shared/src/relationship-profile.ts`:

```ts
import { z } from "zod";

/** Направленные качества отношения A → B (ТЗ индивидуальности, раздел 5.3).
 *
 *  Направление A → B и направление B → A — две независимые строки
 *  `relationships` со своим `profile_json` каждая (INV-03). Симметричного
 *  графа здесь нет и не заводится.
 *
 *  Старые `type`, `tension`, `notes` остаются колонками таблицы и живут
 *  рядом. Новые качества из `tension` не вычисляются: «-0.9» не значит
 *  «боится», это разные сведения, и подмена одного другим — сочинение
 *  за автора. */

const line = z.string().nullable().default(null);

export const directedRelationshipSchema = z.object({
  schemaVersion: z.literal(2),
  trust: line,
  respect: line,
  attachment: line,
  dependency: line,
  fear: line,
  duty: line,
  resentment: line,
  /** Чего A ждёт от B. */
  expectations: line,
  /** Предметы разногласий. */
  disputes: z.array(z.string()).default([]),
  /** Темы умолчания. */
  silences: z.array(z.string()).default([]),
  /** Характерный регистр общения A с B. */
  register: line,
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type DirectedRelationship = z.infer<typeof directedRelationshipSchema>;

export const RELATIONSHIP_QUALITY_LABELS: Record<string, string> = {
  trust: "доверие",
  respect: "уважение",
  attachment: "привязанность",
  dependency: "зависимость",
  fear: "страх",
  duty: "долг",
  resentment: "обида",
  expectations: "чего ждёт",
  register: "манера общения",
};

export const directedRelationshipWriteSchema = directedRelationshipSchema.extend({
  trust: z.string().max(2000).nullable().default(null),
  respect: z.string().max(2000).nullable().default(null),
  attachment: z.string().max(2000).nullable().default(null),
  dependency: z.string().max(2000).nullable().default(null),
  fear: z.string().max(2000).nullable().default(null),
  duty: z.string().max(2000).nullable().default(null),
  resentment: z.string().max(2000).nullable().default(null),
  expectations: z.string().max(2000).nullable().default(null),
  register: z.string().max(2000).nullable().default(null),
  disputes: z.array(z.string().max(1000)).max(20).default([]),
  silences: z.array(z.string().max(1000)).max(20).default([]),
});

const KNOWN_KEYS = new Set(Object.keys(directedRelationshipSchema.shape));

/** Никогда не бросает: вызывается на чтении строки `relationships`. */
export function normalizeRelationshipProfile(raw: unknown): DirectedRelationship {
  const base = directedRelationshipSchema.parse({ schemaVersion: 2 });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw === null || raw === undefined ? base : { ...base, extra: { raw } };
  }
  const source = raw as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "extra") continue;
    (KNOWN_KEYS.has(key) ? known : extra)[key] = value;
  }
  const priorExtra = source["extra"];
  if (priorExtra && typeof priorExtra === "object" && !Array.isArray(priorExtra)) {
    Object.assign(extra, priorExtra as Record<string, unknown>);
  }
  const parsed = directedRelationshipSchema.safeParse({ ...known, schemaVersion: 2 });
  if (parsed.success) return { ...parsed.data, extra };

  const salvaged: Record<string, unknown> = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(known)) {
    const field = directedRelationshipSchema.shape[
      key as keyof typeof directedRelationshipSchema.shape
    ];
    if (field && field.safeParse(value).success) salvaged[key] = value;
    else extra[key] = value;
  }
  return { ...directedRelationshipSchema.parse(salvaged), extra };
}
```

Дописать в `packages/shared/src/index.ts`:

```ts
export * from "./relationship-profile.js";
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/shared test -- src/relationship-profile.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/shared/src/relationship-profile.ts packages/shared/src/relationship-profile.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): направленные качества отношений"
```

---

### Task 4: Миграция 0022 и слой строк

**Files:**
- Create: `apps/server/drizzle/0022_characters_v2.sql` (через `drizzle:new`)
- Modify: `apps/server/drizzle/meta/_journal.json` (создаётся `drizzle:new`), `apps/server/src/db/schema.ts`, `apps/server/src/db/rows.ts`, `packages/shared/src/entities.ts`
- Test: `apps/server/src/db/__tests__/rows-character-v2.test.ts`

**Interfaces:**
- Consumes: `normalizeCharacterProfile`, `CharacterProfileV2` (задача 1); `characterVoiceSampleSchema` (задача 2); `normalizeRelationshipProfile`, `DirectedRelationship` (задача 3).
- Produces: колонки `characters.revision`, `relationships.revision`, `relationships.profile_json`; таблицы `entity_profile_versions`, `character_voice_samples`; `CharacterRow` (+`revision`), `RelationshipRow` (+`revision`, `profile_json`), `CharacterVoiceSampleRow`, `toVoiceSample`; типы `Character` (+`revision`, `profile: CharacterProfileV2`), `Relationship` (+`revision`, `profile: DirectedRelationship`). Задачи 5–10 зависят от них.

- [ ] **Step 1: Проверить номер и создать заготовку**

```bash
tail -12 apps/server/drizzle/meta/_journal.json
pnpm --filter @book-forge/server drizzle:new 0022_characters_v2
```
Expected: последняя запись журнала до вызова — `"idx": 21, "tag": "0021_critique_partial"`; после вызова появляется запись `idx: 22` и пустой `.sql`. Если номер другой — взять фактический следующий и переименовать файл соответственно.

- [ ] **Step 2: Написать SQL**

Заполнить `apps/server/drizzle/0022_characters_v2.sql`:

```sql
-- Этап 2 ТЗ индивидуальности персонажей: профиль V2, ревизии, банк голоса.
-- Миграция ТОЛЬКО структурная. Ни одна строка profile_json не переписывается:
-- нормализация до V2 живёт на чтении (db/rows.ts), поэтому невозможно
-- потерять поле, которого мы сегодня не знаем (INV-07, раздел 15.4 ТЗ).

ALTER TABLE characters ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE relationships ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE relationships ADD COLUMN profile_json TEXT;

-- Одна таблица истории на персонажей и отношения. Полиморфная ссылка —
-- тот же приём, что у entity_aliases (entity_type + entity_id, без FK).
CREATE TABLE entity_profile_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  profile_json TEXT NOT NULL,
  origin TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (entity_type IN ('character','relationship')),
  CHECK (origin IN ('author','llm','import','materialize','migration'))
);
CREATE UNIQUE INDEX uq_entity_profile_versions
  ON entity_profile_versions (entity_type, entity_id, revision);
CREATE INDEX idx_entity_profile_versions_entity
  ON entity_profile_versions (entity_type, entity_id);
CREATE INDEX idx_entity_profile_versions_book
  ON entity_profile_versions (book_id);

CREATE TABLE character_voice_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  situation TEXT NOT NULL,
  addressee_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  note TEXT,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  source_version_id INTEGER REFERENCES chapter_versions(id) ON DELETE SET NULL,
  source_chapter_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (situation IN ('neutral','conflict','vulnerable','authority','intimate','stranger')),
  CHECK (origin IN ('author','accepted_prose','llm')),
  CHECK (status IN ('proposed','accepted','rejected'))
);
CREATE INDEX idx_voice_samples_character
  ON character_voice_samples (character_id, status);
CREATE INDEX idx_voice_samples_book ON character_voice_samples (book_id);
```

Перед этим сверить точное имя таблицы версий главы: `grep -n "chapter_versions\|chapterVersions" apps/server/src/db/schema.ts | head -3`. Если имя другое — поправить `REFERENCES` и сказать об этом в отчёте.

- [ ] **Step 3: Применить и проверить**

```bash
pnpm migrate
node -e "const D=require('better-sqlite3');const d=new D('data/db.sqlite');console.log(d.prepare('PRAGMA table_info(characters)').all().map(c=>c.name).join(','));console.log(d.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entity_profile_versions','character_voice_samples')\").all());"
```
Expected: в списке колонок есть `revision`; обе таблицы найдены.

- [ ] **Step 4: Обновить `schema.ts`**

В `apps/server/src/db/schema.ts` добавить `revision: integer("revision").notNull().default(0)` в `characters`; то же плюс `profileJson: text("profile_json")` в `relationships`; описать две новые таблицы рядом с `entityAliases` по её образцу (`sqliteTable`, `index`, `check`). Драйзл здесь только для типов и документации — runtime ходит сырым SQL.

- [ ] **Step 5: Написать падающий тест слоя строк**

Создать `apps/server/src/db/__tests__/rows-character-v2.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";

interface BookJson { id: number }
interface CharacterJson {
  id: number;
  revision: number;
  profile: Record<string, unknown>;
}

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "V2" });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("чтение профиля V2", () => {
  it("AC-01/AC-35: старая строка читается со всеми полями и revision 0", async () => {
    const now = new Date().toISOString();
    t.sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        bookId,
        "Рин Даре",
        JSON.stringify({
          description: "Старший инженер смены.",
          want: "вернуть станцию",
          role: "протагонист",
          age: "34",
          background: "Выросла на орбитальной верфи.",
          неизвестноеПоле: "сохранить",
        }),
        now,
        now,
      );
    const [c] = (await sendJson<CharacterJson[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    ));
    expect(c?.revision).toBe(0);
    expect(c?.profile.schemaVersion).toBe(2);
    expect(c?.profile.role).toBe("протагонист");
    expect(c?.profile.age).toBe("34");
    expect(c?.profile.background).toBe("Выросла на орбитальной верфи.");
    expect(c?.profile.extra).toEqual({ неизвестноеПоле: "сохранить" });
  });

  it("битый profile_json не роняет список", async () => {
    const now = new Date().toISOString();
    t.sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(bookId, "Сломанный", "{не json", now, now);
    const list = await sendJson<CharacterJson[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.profile.schemaVersion).toBe(2);
  });
});
```

Перед написанием прочитать `apps/server/src/routes/__tests__/_helpers.ts`: этот план предполагает, что `TestApp` отдаёт `sqlite`, а `sendJson` принимает метод `"GET"` без тела. Если хоть одно не так — взять тот способ, который в helpers уже есть (`send` + `.json()`), и сказать об этом в отчёте. Форму вызовов не «чинить» правкой helpers.

- [ ] **Step 6: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/db/__tests__/rows-character-v2.test.ts`
Expected: FAIL — `revision` отсутствует в ответе, а битый JSON бросает из `safeProfile`.

- [ ] **Step 7: Переписать чтение строк**

В `packages/shared/src/entities.ts`:

```ts
import { characterProfileV2Schema } from "./character-profile.js";
import { directedRelationshipSchema } from "./relationship-profile.js";

export const characterSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  canonicalName: z.string().min(1),
  profile: characterProfileV2Schema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

и в `relationshipSchema` дописать:

```ts
  revision: z.number().int().nonnegative(),
  profile: directedRelationshipSchema,
```

Старый `characterProfileSchema` **оставить на месте** и не удалять: на него ссылаются `packages/agents/src/character.ts` и тесты. Пометить комментарием «V1, только для чтения старых данных; новый код использует `characterProfileV2Schema`».

В `apps/server/src/db/rows.ts`:

```ts
export interface CharacterRow {
  id: number;
  book_id: number;
  canonical_name: string;
  profile_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

/** Профиль читается нормализатором, а не `schema.parse`: одно исключение
 *  здесь означает, что `GET /books/:id/characters` перестал отвечать на
 *  всю книгу из-за одной кривой строки. */
export function toCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    bookId: r.book_id,
    canonicalName: r.canonical_name,
    profile: normalizeCharacterProfile(parseJsonOrNull(r.profile_json)),
    revision: r.revision ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseJsonOrNull(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { rawProfileJson: json };
  }
}
```

`toRelationship` — так же: `revision: r.revision ?? 0`, `profile: normalizeRelationshipProfile(parseJsonOrNull(r.profile_json))`.

Добавить строку и конвертер образца речи:

```ts
export interface CharacterVoiceSampleRow {
  id: number;
  book_id: number;
  character_id: number;
  text: string;
  situation: string;
  addressee_character_id: number | null;
  note: string | null;
  origin: string;
  status: string;
  source_version_id: number | null;
  source_chapter_order: number | null;
  created_at: string;
  updated_at: string;
}

export function toVoiceSample(r: CharacterVoiceSampleRow): CharacterVoiceSample {
  return characterVoiceSampleSchema.parse({
    id: r.id,
    bookId: r.book_id,
    characterId: r.character_id,
    text: r.text,
    situation: r.situation,
    addresseeCharacterId: r.addressee_character_id,
    note: r.note,
    origin: r.origin,
    status: r.status,
    sourceVersionId: r.source_version_id,
    sourceChapterOrder: r.source_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}
```

`parse` здесь допустим: значения приходят из колонок с CHECK-ограничениями, свободного JSON нет.

- [ ] **Step 8: Прогнать тесты и починить рябь по типам**

Run: `pnpm --filter @book-forge/server test -- src/db/__tests__/rows-character-v2.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: ошибки только там, где конструируется `Character`/`Relationship` целиком (моки в тестах, `quick-start-run`). V2 сохраняет все имена полей V1, поэтому читающий код (`c.profile.description`, `c.profile.want`) не меняется. Исправить конструирование, добавив `revision: 0` и `profile: normalizeCharacterProfile({...})`.

- [ ] **Step 9: Прогнать полный набор пакета**

Run: `pnpm --filter @book-forge/server test`
Expected: всё зелёное, вывод без предупреждений.

- [ ] **Step 10: Коммит**

```bash
git add apps/server/drizzle/0022_characters_v2.sql apps/server/drizzle/meta/_journal.json apps/server/src/db/schema.ts apps/server/src/db/rows.ts apps/server/src/db/__tests__/rows-character-v2.test.ts packages/shared/src/entities.ts
git commit -m "feat(db): миграция 0022 — ревизии, история профилей, банк голоса"
```

---

### Task 5: Обязательный `expectedRevision` и история принятых профилей

**Files:**
- Create: `apps/server/src/utils/entity-revisions.ts`
- Modify: `apps/server/src/routes/entities.ts`, `packages/shared/src/entities.ts`, `apps/web/src/api/client.ts`
- Test: `apps/server/src/routes/__tests__/entity-revisions.test.ts`

**Interfaces:**
- Consumes: всё из задач 1, 3, 4.
- Produces: `RevisionConflictError`, `updateCharacterProfile(sqlite, input)`, `updateRelationshipProfile(sqlite, input)`, `recordProfileVersion(...)`; `updateCharacterInputSchema`/`updateRelationshipInputSchema` с обязательным `expectedRevision`. Задача 7 использует `recordProfileVersion`, задача 9 — форму ошибки 409.

- [ ] **Step 1: Написать падающие тесты**

Создать `apps/server/src/routes/__tests__/entity-revisions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson { id: number }
interface CharacterJson { id: number; revision: number; profile: Record<string, unknown> }
interface RelationshipJson { id: number; revision: number; profile: Record<string, unknown> }

let t: TestApp;
let bookId: number;
let rin: CharacterJson;
let sarek: CharacterJson;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Ревизии" });
  bookId = b.id;
  rin = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  sarek = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Сарек",
    profile: { description: "Навигатор." },
  });
});
afterEach(() => t.cleanup());

describe("ревизии персонажа", () => {
  it("AC-02: второе изменение с той же ревизией получает 409", async () => {
    const first = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: rin.revision,
      profile: { description: "Инженер.", want: "вернуть станцию" },
    });
    expect(first.status).toBe(200);

    const second = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: rin.revision,
      profile: { description: "Инженер.", want: "уйти со станции" },
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; details?: { currentRevision: number } };
    expect(body.error).toBe("revision_conflict");
    expect(body.details?.currentRevision).toBe(1);

    const after = await sendJson<CharacterJson>(t.app, `/api/characters/${rin.id}`, "GET");
    expect(after.profile.want).toBe("вернуть станцию");
    expect(after.revision).toBe(1);
  });

  it("PATCH без expectedRevision — 400", async () => {
    const r = await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      profile: { description: "Инженер." },
    });
    expect(r.status).toBe(400);
  });

  it("принятая ревизия попадает в историю", async () => {
    await send(t.app, `/api/characters/${rin.id}`, "PATCH", {
      expectedRevision: 0,
      profile: { description: "Инженер.", need: "просить помощь" },
    });
    const rows = t.sqlite
      .prepare(
        `SELECT revision, origin FROM entity_profile_versions
         WHERE entity_type = 'character' AND entity_id = ? ORDER BY revision`,
      )
      .all(rin.id) as Array<{ revision: number; origin: string }>;
    expect(rows.map((r) => r.revision)).toEqual([1]);
    expect(rows[0]?.origin).toBe("author");
  });
});

describe("направленные отношения", () => {
  it("AC-05: A доверяет B, B не доверяет A — направления независимы", async () => {
    const ab = await sendJson<RelationshipJson>(
      t.app, `/api/books/${bookId}/relationships`, "POST",
      { fromCharacterId: rin.id, toCharacterId: sarek.id, type: "напарник", tension: 0 },
    );
    const ba = await sendJson<RelationshipJson>(
      t.app, `/api/books/${bookId}/relationships`, "POST",
      { fromCharacterId: sarek.id, toCharacterId: rin.id, type: "напарник", tension: 0 },
    );

    await send(t.app, `/api/relationships/${ab.id}`, "PATCH", {
      expectedRevision: ab.revision,
      profile: { trust: "верит на слово", respect: "уважает выдержку" },
    });
    await send(t.app, `/api/relationships/${ba.id}`, "PATCH", {
      expectedRevision: ba.revision,
      profile: { trust: "не доверяет обещаниям", resentment: "не простил смену" },
    });

    const list = await sendJson<RelationshipJson[]>(
      t.app, `/api/books/${bookId}/relationships`, "GET",
    );
    const forward = list.find((r) => r.id === ab.id);
    const back = list.find((r) => r.id === ba.id);
    expect(forward?.profile.trust).toBe("верит на слово");
    expect(back?.profile.trust).toBe("не доверяет обещаниям");
    expect(forward?.profile.resentment).toBeNull();
  });

  it("AC-30: связь между книгами не создаётся", async () => {
    const other = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Чужая" });
    const alien = await sendJson<CharacterJson>(
      t.app, `/api/books/${other.id}/characters`, "POST",
      { canonicalName: "Чужой", profile: { description: "X" } },
    );
    const r = await send(t.app, `/api/books/${bookId}/relationships`, "POST", {
      fromCharacterId: rin.id, toCharacterId: alien.id, type: "враг", tension: 0,
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/entity-revisions.test.ts`
Expected: FAIL — второй PATCH возвращает 200, истории нет, `profile` в ответе отношения отсутствует.

- [ ] **Step 3: Написать общий модуль ревизий**

Создать `apps/server/src/utils/entity-revisions.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";

/** Единственное место, где растёт ревизия персонажа или отношения.
 *  Наращивание и запись в историю идут одной транзакцией: ревизия без
 *  своей строки истории — это потерянная авторская версия (INV-06). */

export type ProfileEntityType = "character" | "relationship";
export type ProfileOrigin =
  | "author"
  | "llm"
  | "import"
  | "materialize"
  | "migration";

export class RevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("ревизия изменилась");
    this.name = "RevisionConflictError";
  }
}

export function recordProfileVersion(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    entityType: ProfileEntityType;
    entityId: number;
    revision: number;
    profileJson: string;
    origin: ProfileOrigin;
    note?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO entity_profile_versions
         (book_id, entity_type, entity_id, revision, profile_json, origin, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.bookId,
      args.entityType,
      args.entityId,
      args.revision,
      args.profileJson,
      args.origin,
      args.note ?? null,
      new Date().toISOString(),
    );
}

export function deleteProfileVersions(
  sqlite: DatabaseType,
  entityType: ProfileEntityType,
  entityId: number,
): void {
  sqlite
    .prepare(
      "DELETE FROM entity_profile_versions WHERE entity_type = ? AND entity_id = ?",
    )
    .run(entityType, entityId);
}

/** Сравнение с ожидаемой ревизией, запись, рост, история — одна транзакция.
 *  Бросает `RevisionConflictError`; вызывающий маршрут превращает её в 409. */
export function bumpEntityRevision(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    entityType: ProfileEntityType;
    entityId: number;
    expectedRevision: number;
    currentRevision: number;
    profileJson: string;
    origin: ProfileOrigin;
    /** Применяет остальные колонки строки; ревизию не трогает. */
    applyColumns: (nextRevision: number, now: string) => void;
  },
): number {
  const tx = sqlite.transaction((): number => {
    if (args.currentRevision !== args.expectedRevision) {
      throw new RevisionConflictError(args.currentRevision);
    }
    const next = args.currentRevision + 1;
    const now = new Date().toISOString();
    args.applyColumns(next, now);
    recordProfileVersion(sqlite, {
      bookId: args.bookId,
      entityType: args.entityType,
      entityId: args.entityId,
      revision: next,
      profileJson: args.profileJson,
      origin: args.origin,
    });
    return next;
  });
  return tx.immediate();
}
```

- [ ] **Step 4: Ужесточить входные схемы**

В `packages/shared/src/entities.ts`:

```ts
/** Профиль на входе — сырой объект, а не `characterProfileWriteSchema`.
 *  У схемы записи `schemaVersion: z.literal(2)` обязателен, и клиент,
 *  присылающий `{ description: "…" }`, получал бы 400 на пустом месте.
 *  Порядок один во всех маршрутах записи: сырое тело → нормализация →
 *  проверка пределов схемой записи. */
const rawProfileSchema = z.record(z.string(), z.unknown());

export const updateCharacterInputSchema = z
  .object({
    // Обязателен с первого коммита: единственный клиент едет в том же
    // репозитории, а необязательный режим ломает AC-02 (раздел 5.1 ТЗ).
    expectedRevision: z.number().int().nonnegative(),
    canonicalName: z.string().min(1).max(200).optional(),
    profile: rawProfileSchema.optional(),
  })
  .refine((v) => v.canonicalName !== undefined || v.profile !== undefined, {
    message: "at least one field required",
  });

export const updateRelationshipInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    type: z.string().min(1).max(100).optional(),
    tension: z.number().min(-1).max(1).optional(),
    notes: z.string().max(2000).nullable().optional(),
    profile: rawProfileSchema.optional(),
  })
  .refine(
    (v) =>
      v.type !== undefined ||
      v.tension !== undefined ||
      v.notes !== undefined ||
      v.profile !== undefined,
    { message: "at least one field required" },
  );
```

`createCharacterInputSchema.profile` — тоже `rawProfileSchema`.

Пределы применяет один общий помощник, чтобы порядок «нормализовать →
проверить» не разъехался по четырём маршрутам. Положить его рядом со
схемами в `packages/shared/src/character-profile.ts`:

```ts
/** Принимает V1, V2 и то, что прислал автор; возвращает V2 или список
 *  нарушенных пределов. Единственная дверь на запись профиля. */
export function parseCharacterProfileForWrite(
  raw: unknown,
): { ok: true; profile: CharacterProfileV2 } | { ok: false; error: z.ZodError } {
  const normalized = normalizeCharacterProfile(raw);
  const checked = characterProfileWriteSchema.safeParse(normalized);
  return checked.success
    ? { ok: true, profile: normalized }
    : { ok: false, error: checked.error };
}
```

Такой же `parseRelationshipProfileForWrite` — в `relationship-profile.ts`.
Дописать к тестам задач 1 и 3 по одному случаю на каждый: `{ description: "x" }`
проходит, `{ description: "я".repeat(20_001) }` не проходит.

- [ ] **Step 5: Переписать маршруты**

В `apps/server/src/routes/entities.ts`, `PATCH /characters/:id`:

```ts
r.patch("/characters/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const parsed = updateCharacterInputSchema.safeParse(body);
  if (!parsed.success) return validationFailed(c, parsed.error);
  const existing = sqlite
    .prepare("SELECT * FROM characters WHERE id = ?")
    .get(id) as CharacterRow | undefined;
  if (!existing) return notFound(c, "character");

  let nextProfile: CharacterProfileV2;
  if (parsed.data.profile) {
    const checked = parseCharacterProfileForWrite(parsed.data.profile);
    if (!checked.ok) return validationFailed(c, checked.error);
    nextProfile = checked.profile;
  } else {
    nextProfile = normalizeCharacterProfile(
      JSON.parse(existing.profile_json || "null"),
    );
  }
  const profileJson = JSON.stringify(nextProfile);
  const nextName = parsed.data.canonicalName ?? existing.canonical_name;

  try {
    bumpEntityRevision(sqlite, {
      bookId: existing.book_id,
      entityType: "character",
      entityId: id,
      expectedRevision: parsed.data.expectedRevision,
      currentRevision: existing.revision ?? 0,
      profileJson,
      origin: "author",
      applyColumns: (revision, now) => {
        sqlite
          .prepare(
            `UPDATE characters
               SET canonical_name = ?, profile_json = ?, revision = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(nextName, profileJson, revision, now, id);
      },
    });
  } catch (e) {
    if (e instanceof RevisionConflictError) {
      return c.json(
        {
          error: "revision_conflict",
          message: "карточка изменилась, обновите её и повторите",
          details: { currentRevision: e.currentRevision },
        },
        409,
      );
    }
    throw e;
  }

  bumpBook(sqlite, existing.book_id);
  const row = sqlite
    .prepare("SELECT * FROM characters WHERE id = ?")
    .get(id) as CharacterRow;
  return c.json(toCharacter(row));
});
```

`PATCH /relationships/:id` — то же самое с `type`/`tension`/`notes`/`profile_json` в `applyColumns` и `entityType: "relationship"`.

В `DELETE /characters/:id` и `DELETE /relationships/:id` дописать `deleteProfileVersions(sqlite, "character" | "relationship", id)` перед удалением строки: ссылка в истории полиморфная, без FK, и сирот никто не уберёт.

В `POST /books/:id/characters` — записать `recordProfileVersion(..., revision: 0, origin: "author")` в той же транзакции, что и вставка, чтобы история начиналась с исходной карточки.

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/entity-revisions.test.ts`
Expected: PASS, 5 тестов.

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/entities.test.ts`
Expected: существующие тесты PATCH падают — им нужен `expectedRevision`. Дописать его в каждый вызов PATCH; это ожидаемое изменение контракта, а не поломка.

- [ ] **Step 7: Обновить клиент**

В `apps/web/src/api/client.ts` сигнатуры `updateCharacter` и `updateRelationship` принимают тело со схемой из `@book-forge/shared`; отдельного аргумента `expectedRevision` не заводить — он часть тела. Типы подтянутся из общего пакета.

- [ ] **Step 8: Коммит**

```bash
git add apps/server/src/utils/entity-revisions.ts apps/server/src/routes/entities.ts apps/server/src/routes/__tests__/entity-revisions.test.ts apps/server/src/routes/__tests__/entities.test.ts packages/shared/src/entities.ts apps/web/src/api/client.ts
git commit -m "feat(entities): expectedRevision обязателен, ревизии пишутся в историю"
```

---

### Task 6: Маршруты банка образцов речи

**Files:**
- Modify: `apps/server/src/routes/entities.ts`, `apps/web/src/api/client.ts`
- Test: `apps/server/src/routes/__tests__/voice-samples.test.ts`

**Interfaces:**
- Consumes: `createVoiceSampleInputSchema`, `updateVoiceSampleInputSchema`, `toVoiceSample`, `CharacterVoiceSampleRow`.
- Produces: `GET/POST /api/characters/:id/voice-samples`, `PATCH/DELETE /api/voice-samples/:id`; клиентские `listVoiceSamples`, `createVoiceSample`, `updateVoiceSample`, `deleteVoiceSample`. Задачи 9 и 10 зависят от них.

- [ ] **Step 1: Написать падающие тесты**

Создать `apps/server/src/routes/__tests__/voice-samples.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson { id: number }
interface CharacterJson { id: number }
interface SampleJson { id: number; status: string; situation: string; text: string }

let t: TestApp;
let bookId: number;
let rin: CharacterJson;
let sarek: CharacterJson;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Голос" });
  bookId = b.id;
  rin = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST",
    { canonicalName: "Рин", profile: { description: "Инженер." } });
  sarek = await sendJson<CharacterJson>(t.app, `/api/books/${bookId}/characters`, "POST",
    { canonicalName: "Сарек", profile: { description: "Навигатор." } });
});
afterEach(() => t.cleanup());

describe("банк образцов речи", () => {
  it("авторский образец создаётся сразу принятым", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Не надо. Я сама.",
      situation: "conflict",
      origin: "author",
    });
    expect(s.status).toBe("accepted");
    const list = await sendJson<SampleJson[]>(t.app, `/api/characters/${rin.id}/voice-samples`, "GET");
    expect(list).toHaveLength(1);
  });

  it("образец модели ждёт принятия", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Хорошо, посмотрим.",
      situation: "neutral",
      origin: "llm",
    });
    expect(s.status).toBe("proposed");
    const accepted = await sendJson<SampleJson>(t.app, `/api/voice-samples/${s.id}`, "PATCH", {
      status: "accepted",
    });
    expect(accepted.status).toBe("accepted");
  });

  it("AC-30: адресат из другой книги отклоняется", async () => {
    const other = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Чужая" });
    const alien = await sendJson<CharacterJson>(t.app, `/api/books/${other.id}/characters`, "POST",
      { canonicalName: "Чужой", profile: { description: "X" } });
    const r = await send(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Привет.",
      situation: "stranger",
      addresseeCharacterId: alien.id,
    });
    expect(r.status).toBe(400);
  });

  it("адресат из своей книги принимается", async () => {
    const r = await send(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Ты опять за своё.",
      situation: "intimate",
      addresseeCharacterId: sarek.id,
    });
    expect(r.status).toBe(201);
  });

  it("удаление возвращает 204 и убирает образец", async () => {
    const s = await sendJson<SampleJson>(t.app, `/api/characters/${rin.id}/voice-samples`, "POST", {
      text: "Х", situation: "neutral",
    });
    const del = await send(t.app, `/api/voice-samples/${s.id}`, "DELETE");
    expect(del.status).toBe(204);
    expect(await sendJson<SampleJson[]>(t.app, `/api/characters/${rin.id}/voice-samples`, "GET")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/voice-samples.test.ts`
Expected: FAIL, 404 на всех маршрутах.

- [ ] **Step 3: Добавить маршруты**

В `apps/server/src/routes/entities.ts` после блока знаний персонажа:

```ts
// ─────────────── Образцы речи ───────────────

r.get("/characters/:id/voice-samples", (c) => {
  const id = Number(c.req.param("id"));
  const ch = sqlite
    .prepare("SELECT id FROM characters WHERE id = ?")
    .get(id) as { id: number } | undefined;
  if (!ch) return notFound(c, "character");
  const rows = sqlite
    .prepare(
      "SELECT * FROM character_voice_samples WHERE character_id = ? ORDER BY id ASC",
    )
    .all(id) as CharacterVoiceSampleRow[];
  return c.json(rows.map(toVoiceSample));
});

r.post("/characters/:id/voice-samples", async (c) => {
  const id = Number(c.req.param("id"));
  const ch = sqlite
    .prepare("SELECT id, book_id FROM characters WHERE id = ?")
    .get(id) as { id: number; book_id: number } | undefined;
  if (!ch) return notFound(c, "character");
  const body = await c.req.json().catch(() => null);
  const parsed = createVoiceSampleInputSchema.safeParse(body);
  if (!parsed.success) return validationFailed(c, parsed.error);

  // AC-30: адресат обязан жить в той же книге. Плоский маршрут
  // `/characters/:id` не несёт книгу в пути, поэтому проверка тут.
  const addressee = parsed.data.addresseeCharacterId ?? null;
  if (addressee !== null) {
    const ok = sqlite
      .prepare("SELECT id FROM characters WHERE id = ? AND book_id = ?")
      .get(addressee, ch.book_id) as { id: number } | undefined;
    if (!ok) return badRequest(c, "адресат должен быть героем этой же книги");
  }

  // Авторский образец — уже решение автора, отдельного принятия не просит.
  // Предложение модели ждёт: «ничего не утверждается без автора».
  const status =
    parsed.data.status ?? (parsed.data.origin === "author" ? "accepted" : "proposed");
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO character_voice_samples
         (book_id, character_id, text, situation, addressee_character_id, note,
          origin, status, source_version_id, source_chapter_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ch.book_id, id, parsed.data.text, parsed.data.situation, addressee,
      parsed.data.note ?? null, parsed.data.origin, status,
      parsed.data.sourceVersionId ?? null, parsed.data.sourceChapterOrder ?? null,
      now, now,
    );
  bumpBook(sqlite, ch.book_id);
  const row = sqlite
    .prepare("SELECT * FROM character_voice_samples WHERE id = ?")
    .get(info.lastInsertRowid) as CharacterVoiceSampleRow;
  return c.json(toVoiceSample(row), 201);
});

r.patch("/voice-samples/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const parsed = updateVoiceSampleInputSchema.safeParse(body);
  if (!parsed.success) return validationFailed(c, parsed.error);
  const existing = sqlite
    .prepare("SELECT id, book_id FROM character_voice_samples WHERE id = ?")
    .get(id) as { id: number; book_id: number } | undefined;
  if (!existing) return notFound(c, "voice_sample");
  sqlite
    .prepare(
      "UPDATE character_voice_samples SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(parsed.data.status, new Date().toISOString(), id);
  bumpBook(sqlite, existing.book_id);
  const row = sqlite
    .prepare("SELECT * FROM character_voice_samples WHERE id = ?")
    .get(id) as CharacterVoiceSampleRow;
  return c.json(toVoiceSample(row));
});

r.delete("/voice-samples/:id", (c) => {
  const id = Number(c.req.param("id"));
  const existing = sqlite
    .prepare("SELECT book_id FROM character_voice_samples WHERE id = ?")
    .get(id) as { book_id: number } | undefined;
  if (!existing) return notFound(c, "voice_sample");
  sqlite.prepare("DELETE FROM character_voice_samples WHERE id = ?").run(id);
  bumpBook(sqlite, existing.book_id);
  return c.body(null, 204);
});
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/voice-samples.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Добавить функции клиента**

В `apps/web/src/api/client.ts` рядом с блоком знаний персонажа:

```ts
  // ── Образцы речи ──
  listVoiceSamples: (characterId: number) =>
    req<CharacterVoiceSample[]>(`/api/characters/${characterId}/voice-samples`),
  createVoiceSample: (characterId: number, body: CreateVoiceSampleInput) =>
    req<CharacterVoiceSample>(`/api/characters/${characterId}/voice-samples`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVoiceSample: (id: number, body: UpdateVoiceSampleInput) =>
    req<CharacterVoiceSample>(`/api/voice-samples/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVoiceSample: (id: number) =>
    req<void>(`/api/voice-samples/${id}`, { method: "DELETE" }),
```

- [ ] **Step 6: Коммит**

```bash
git add apps/server/src/routes/entities.ts apps/server/src/routes/__tests__/voice-samples.test.ts apps/web/src/api/client.ts
git commit -m "feat(voice): банк образцов речи на сервере и в клиенте"
```

---

### Task 7: Материализация обновляет, а не дублирует

**Files:**
- Modify: `packages/shared/src/studio-state.ts`, `apps/server/src/routes/studio.ts`, `apps/web/src/components/studio/aspect-engine/EntityStageRunner.tsx`, `apps/web/src/api/client.ts`
- Test: `apps/server/src/routes/__tests__/aspects-entities.test.ts` (дописать), `apps/web/src/components/studio/aspect-engine/__tests__/EntityCasting.test.tsx` (дописать)

**Interfaces:**
- Consumes: `normalizeCharacterProfile`, `recordProfileVersion`.
- Produces: `entityCandidateProfileSchema` в `studio-state.ts`; поле `materializedEntityId` в теле материализации; ответ материализации не меняет формы.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `apps/server/src/routes/__tests__/aspects-entities.test.ts`:

```ts
it("AC-35: role/age/background переживают материализацию и читаются через API", async () => {
  const res = await sendJson<{ createdEntityIds: number[] }>(
    t.app, `/api/books/${bookId}/aspects/asp1/materialize`, "POST",
    {
      stageId: "characters",
      aspectName: "Протагонист",
      candidates: [{
        tempId: "c1",
        decision: "accept",
        profile: {
          name: "Рин Даре",
          role: "протагонист",
          age: "34",
          description: "Старший инженер смены, держит вахту на себе.",
          background: "Выросла на орбитальной верфи.",
        },
      }],
    },
  );
  const id = res.createdEntityIds[0]!;
  const c = await sendJson<{ profile: Record<string, unknown>; revision: number }>(
    t.app, `/api/characters/${id}`, "GET",
  );
  expect(c.profile.role).toBe("протагонист");
  expect(c.profile.age).toBe("34");
  expect(c.profile.background).toBe("Выросла на орбитальной верфи.");
  expect(c.profile.schemaVersion).toBe(2);
});

it("AC-35: повторная материализация не создаёт дубликат", async () => {
  const first = await sendJson<{ createdEntityIds: number[] }>(
    t.app, `/api/books/${bookId}/aspects/asp2/materialize`, "POST",
    {
      stageId: "characters",
      aspectName: "Протагонист",
      candidates: [{ tempId: "c1", decision: "accept", profile: { name: "Рин", description: "Инженер смены на станции." } }],
    },
  );
  const id = first.createdEntityIds[0]!;

  // Тот же раздел, другой набор tempId — это НЕ повтор запроса, поэтому
  // ключ идемпотентности не срабатывает и путь идёт до апдейта.
  await sendJson(t.app, `/api/books/${bookId}/aspects/asp2/materialize`, "POST", {
    stageId: "characters",
    aspectName: "Протагонист",
    candidates: [
      { tempId: "c1", decision: "accept", materializedEntityId: id,
        profile: { name: "Рин Даре", description: "Старший инженер смены." } },
      { tempId: "c2", decision: "accept", profile: { name: "Сарек", description: "Навигатор дальнего хода." } },
    ],
  });

  const all = await sendJson<Array<{ id: number; canonicalName: string; revision: number }>>(
    t.app, `/api/books/${bookId}/characters`, "GET",
  );
  expect(all).toHaveLength(2);
  const rin = all.find((c) => c.id === id);
  expect(rin?.canonicalName).toBe("Рин Даре");
  expect(rin?.revision).toBe(1);
});

it("AC-30: mergedIntoId из другой книги отклоняется", async () => {
  const other = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Чужая" });
  const alien = await sendJson<{ id: number }>(
    t.app, `/api/books/${other.id}/characters`, "POST",
    { canonicalName: "Чужой", profile: { description: "X" } },
  );
  const r = await send(t.app, `/api/books/${bookId}/aspects/asp3/materialize`, "POST", {
    stageId: "characters",
    aspectName: "Протагонист",
    candidates: [{ tempId: "c9", decision: "accept", mergedIntoId: alien.id, profile: { name: "Ч" } }],
  });
  expect(r.status).toBe(400);
});
```

Дописать в `apps/web/src/components/studio/aspect-engine/__tests__/EntityCasting.test.tsx` проверку: кандидат с `materializedEntityId` в `finalPayload` после правки имени отправляется в `onMaterialize` вместе с этим идентификатором и с неизменными `role`/`background`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/aspects-entities.test.ts`
Expected: FAIL — второй прогон даёт трёх персонажей вместо двух, `role` в ответе отсутствует, `mergedIntoId` из чужой книги проходит.

- [ ] **Step 3: Типизировать профиль кандидата**

В `packages/shared/src/studio-state.ts` заменить `profile: z.unknown()`:

```ts
/** Профиль кандидата Мастерской. Поля перечислены (раздел 5.1 ТЗ требует
 *  типизированной схемы вместо `z.unknown()`), но `catchall` оставляет
 *  неизвестные ключи на месте: генератор сущностей волен вернуть больше,
 *  и терять это на границе схемы нельзя. */
export const entityCandidateProfileSchema = z
  .object({
    name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    age: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    background: z.string().nullable().optional(),
    origin: z.string().nullable().optional(),
    significance: z.string().nullable().optional(),
    properties: z.string().nullable().optional(),
  })
  .catchall(z.unknown());
export type EntityCandidateProfile = z.infer<typeof entityCandidateProfileSchema>;

export const entityCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: entityKindSchema,
  profile: entityCandidateProfileSchema,
  status: entityCandidateStatusSchema,
  materializedEntityId: z.number().int().positive().optional(),
  mergedIntoEntityId: z.number().int().positive().optional(),
});
```

- [ ] **Step 4: Переписать материализацию**

В `apps/server/src/routes/studio.ts`:

```ts
const materializeBodySchema = z.object({
  stageId: z.enum(["characters", "items"]),
  aspectName: z.string().min(1).max(120),
  candidates: z
    .array(
      z.object({
        tempId: z.string().min(1),
        decision: z.enum(["accept", "reject"]),
        profile: entityCandidateProfileSchema,
        /** Кандидат, уже заведённый в канон прошлой материализацией.
         *  Обновляем его строку, а не вставляем вторую (раздел 5.1 ТЗ). */
        materializedEntityId: z.number().int().positive().optional(),
        mergedIntoId: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});
```

Внутри транзакции: перед циклом — проверка принадлежности книге для всех `materializedEntityId` и `mergedIntoId` (одним `SELECT id FROM characters|items WHERE book_id = ? AND id IN (...)`); не совпало — вернуть `badRequest(c, "сущность принадлежит другой книге")` **до** открытия транзакции.

Рядом с уже существующими `insertChar`/`insertItem` объявить недостающие
подготовленные запросы:

```ts
const selectCharRevision = sqlite.prepare(
  "SELECT revision FROM characters WHERE id = ?",
);
const updateChar = sqlite.prepare(
  `UPDATE characters
     SET canonical_name = ?, profile_json = ?, revision = ?, updated_at = ?
   WHERE id = ?`,
);
// У `items` колонки `revision` нет: этап 2 предметов не касается.
const updateItem = sqlite.prepare(
  "UPDATE items SET name = ?, profile_json = ?, updated_at = ? WHERE id = ?",
);
```

Ветка принятия:

```ts
const profile =
  parsed.data.stageId === "characters"
    ? normalizeCharacterProfile(cand.profile)
    : cand.profile;
const profileJson = JSON.stringify(profile);
const name = typeof cand.profile.name === "string" && cand.profile.name.trim()
  ? cand.profile.name.trim()
  : "Без имени";

let entityId: number;
if (cand.materializedEntityId !== undefined) {
  entityId = cand.materializedEntityId;
  if (parsed.data.stageId === "characters") {
    const current = selectCharRevision.get(entityId) as
      | { revision: number }
      | undefined;
    const nextRevision = (current?.revision ?? 0) + 1;
    updateChar.run(name, profileJson, nextRevision, now, entityId);
    recordProfileVersion(sqlite, {
      bookId: id, entityType: "character", entityId,
      revision: nextRevision, profileJson, origin: "materialize",
    });
  } else {
    updateItem.run(name, profileJson, now, entityId);
  }
} else {
  const info = (parsed.data.stageId === "characters" ? insertChar : insertItem)
    .run(id, name, profileJson, now, now);
  entityId = Number(info.lastInsertRowid);
  if (parsed.data.stageId === "characters") {
    recordProfileVersion(sqlite, {
      bookId: id, entityType: "character", entityId,
      revision: 0, profileJson, origin: "materialize",
    });
  }
}
```

Предметы нормализацией не трогаются и ревизий не получают: `normalizeCharacterProfile` — про персонажей, а у `items` нет колонки `revision`. Расширение предметов — не задача этого этапа.

- [ ] **Step 5: Передать `materializedEntityId` из интерфейса**

В `EntityStageRunner.tsx`, в `handleMaterialize`, `candidatesForApi`:

```ts
const candidatesForApi = cast.map((c) => ({
  tempId: c.tempId,
  decision: decisions[c.tempId] ?? ("accept" as const),
  profile: c.profile,
  ...(c.materializedEntityId !== undefined
    ? { materializedEntityId: c.materializedEntityId }
    : {}),
}));
```

`editCandidate` уже разворачивает профиль через спред, поэтому `role`, `age` и `background` переживают правку имени и описания. Тип `materializeEntitySet` в `apps/web/src/api/client.ts` — дописать `materializedEntityId?: number`.

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/aspects-entities.test.ts`
Expected: PASS.

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add packages/shared/src/studio-state.ts apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/aspects-entities.test.ts apps/web/src/components/studio/aspect-engine/EntityStageRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/EntityCasting.test.tsx apps/web/src/api/client.ts
git commit -m "fix(studio): материализация обновляет героя и не теряет поля"
```

---

### Task 8: Неоднозначное имя больше не резолвится в «первого попавшегося»

**Files:**
- Modify: `apps/server/src/utils/entity-resolve.ts`
- Test: `apps/server/src/utils/__tests__/entity-resolve.test.ts` (дописать)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `resolveEntity` возвращает `null` при неоднозначности; поведение остальных вызывающих не меняется.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `apps/server/src/utils/__tests__/entity-resolve.test.ts`:

```ts
it("AC-04: два героя с одинаковым именем не резолвятся в случайного", () => {
  const now = new Date().toISOString();
  const ins = sqlite.prepare(
    `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
     VALUES (?, ?, '{"description":"x"}', ?, ?)`,
  );
  ins.run(bookId, "Рин", now, now);
  ins.run(bookId, "рин", now, now);
  expect(resolveEntity(sqlite, bookId, "character", "Рин")).toBeNull();
});

it("AC-04: алиас склонённого имени резолвится в явного героя", () => {
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
       VALUES (?, 'Рин Даре', '{"description":"x"}', ?, ?)`,
    )
    .run(bookId, now, now);
  const id = Number(info.lastInsertRowid);
  addEntityAlias(sqlite, bookId, "character", id, "Рину");
  expect(resolveEntity(sqlite, bookId, "character", "рину")?.entityId).toBe(id);
});

it("AC-04: неоднозначность не мешает соседней книге", () => {
  // одинаковые имена в РАЗНЫХ книгах — это не неоднозначность
  const now = new Date().toISOString();
  const other = sqlite
    .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Чужая', ?, ?)")
    .run(now, now);
  const otherBook = Number(other.lastInsertRowid);
  sqlite.prepare(
    `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
     VALUES (?, 'Рин', '{"description":"x"}', ?, ?)`,
  ).run(bookId, now, now);
  sqlite.prepare(
    `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
     VALUES (?, 'Рин', '{"description":"x"}', ?, ?)`,
  ).run(otherBook, now, now);
  expect(resolveEntity(sqlite, bookId, "character", "Рин")).not.toBeNull();
});
```

Форму фикстуры (`sqlite`, `bookId`, минимальный `INSERT INTO books`) взять из уже существующих тестов этого файла, а не из этого плана: там может быть больше обязательных колонок.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/entity-resolve.test.ts`
Expected: FAIL на первом тесте — `resolveEntity` вернул первого героя вместо `null`.

- [ ] **Step 3: Починить резолвер**

В `apps/server/src/utils/entity-resolve.ts` заменить оба `rows.find(...)` на:

```ts
    // Два героя с одинаковым нормализованным именем — это неоднозначность,
    // а не «возьмём первого». Тихий выбор пришивает факт чужому герою и
    // обнаруживается только в готовой главе (AC-04).
    const hits = rows.filter((r) => normalizeEntityName(r.name) === norm);
    if (hits.length === 1) {
      const hit = hits[0]!;
      return { entityId: hit.id, canonicalName: hit.name };
    }
    if (hits.length > 1) return null;
```

Алиасную ветку не трогать: пара «книга + тип + алиас» уникальна по построению `addEntityAlias`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/entity-resolve.test.ts src/utils/__tests__/book-facts.test.ts`
Expected: PASS оба файла — `null` уже был штатным исходом для `book_facts.entity_id`.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/utils/entity-resolve.ts apps/server/src/utils/__tests__/entity-resolve.test.ts
git commit -m "fix(resolve): неоднозначное имя не резолвится молча"
```

---

### Task 9: Авторское редактирование V2 в существующих вкладках

**Files:**
- Create: `apps/web/src/components/VoiceSamples.tsx`, `apps/web/src/components/RelationshipQualities.tsx`
- Modify: `apps/web/src/components/KnowledgePanel.tsx`
- Test: `apps/web/src/components/__tests__/VoiceSamples.test.tsx`, `apps/web/src/components/__tests__/RelationshipQualities.test.tsx`

**Interfaces:**
- Consumes: клиентские функции банка голоса (задача 6), `api.updateRelationship` с `expectedRevision` (задача 5), `RELATIONSHIP_QUALITY_LABELS`, `VOICE_SITUATION_LABELS`.
- Produces: два самостоятельных компонента; `KnowledgePanel` их только монтирует.

Отдельный экран карточки персонажа здесь **не создаётся** (Global Constraints, раздел 18 ТЗ).

- [ ] **Step 1: Написать падающий тест образцов речи**

Создать `apps/web/src/components/__tests__/VoiceSamples.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceSamples } from "../VoiceSamples";

const api = {
  listVoiceSamples: vi.fn(),
  createVoiceSample: vi.fn(),
  updateVoiceSample: vi.fn(),
  deleteVoiceSample: vi.fn(),
};
vi.mock("@/api/client", () => ({ api: new Proxy({}, { get: (_t, k) => api[k as keyof typeof api] }) }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listVoiceSamples.mockResolvedValue([]);
});

describe("VoiceSamples", () => {
  it("подписи ситуаций по-русски, внутренних кодов нет", async () => {
    api.listVoiceSamples.mockResolvedValue([
      { id: 1, characterId: 7, text: "Не надо. Я сама.", situation: "conflict",
        addresseeCharacterId: null, note: null, origin: "author", status: "accepted",
        sourceVersionId: null, sourceChapterOrder: null, bookId: 3,
        createdAt: "", updatedAt: "" },
    ]);
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    expect(await screen.findByText("конфликт")).toBeTruthy();
    expect(screen.queryByText("conflict")).toBeNull();
  });

  it("добавление образца зовёт API и перечитывает список", async () => {
    api.createVoiceSample.mockResolvedValue({ id: 2 });
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    await userEvent.type(await screen.findByLabelText("Текст образца"), "Хорошо.");
    await userEvent.click(screen.getByRole("button", { name: "Добавить образец" }));
    await waitFor(() => expect(api.createVoiceSample).toHaveBeenCalled());
    expect(api.listVoiceSamples).toHaveBeenCalledTimes(2);
  });

  it("предложение модели можно принять", async () => {
    api.listVoiceSamples.mockResolvedValue([
      { id: 3, characterId: 7, text: "Посмотрим.", situation: "neutral",
        addresseeCharacterId: null, note: null, origin: "llm", status: "proposed",
        sourceVersionId: null, sourceChapterOrder: null, bookId: 3,
        createdAt: "", updatedAt: "" },
    ]);
    api.updateVoiceSample.mockResolvedValue({ id: 3, status: "accepted" });
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Принять" }));
    await waitFor(() =>
      expect(api.updateVoiceSample).toHaveBeenCalledWith(3, { status: "accepted" }),
    );
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/__tests__/VoiceSamples.test.tsx`
Expected: FAIL, модуль `../VoiceSamples` не найден.

- [ ] **Step 3: Написать `VoiceSamples.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import {
  VOICE_SAMPLE_SITUATIONS,
  VOICE_SITUATION_LABELS,
  type Character,
  type CharacterVoiceSample,
  type VoiceSampleSituation,
} from "@book-forge/shared";
import { api } from "@/api/client";

interface Props {
  bookId: number;
  characterId: number;
  /** Для выбора адресата. Герой сам себе адресатом быть не может. */
  characters: Character[];
}

/** Банк образцов речи одного героя (ТЗ индивидуальности, раздел 5.2).
 *  Авторский образец — уже решение автора и создаётся принятым; образец
 *  модели ждёт кнопки. Отдельного экрана карточки в этом этапе нет, поэтому
 *  блок живёт во вкладке «Персонажи» панели материалов. */
export function VoiceSamples({ bookId, characterId, characters }: Props) {
  const [list, setList] = useState<CharacterVoiceSample[] | null>(null);
  const [text, setText] = useState("");
  const [situation, setSituation] = useState<VoiceSampleSituation>("neutral");
  const [addressee, setAddressee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setList(await api.listVoiceSamples(characterId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [characterId]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createVoiceSample(characterId, {
        text: text.trim(),
        situation,
        origin: "author",
        ...(addressee !== null ? { addresseeCharacterId: addressee } : {}),
      });
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: number, status: "accepted" | "rejected") {
    setBusy(true);
    try {
      await api.updateVoiceSample(id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nameById = new Map(characters.map((c) => [c.id, c.canonicalName]));
  const others = characters.filter((c) => c.id !== characterId);

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
      <form onSubmit={onAdd} className="flex flex-col gap-2">
        <textarea
          aria-label="Текст образца"
          placeholder="Одна реплика этого героя"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
        />
        <div className="flex gap-2 flex-wrap items-center">
          <select
            aria-label="Ситуация"
            value={situation}
            onChange={(e) => setSituation(e.target.value as VoiceSampleSituation)}
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          >
            {VOICE_SAMPLE_SITUATIONS.map((s) => (
              <option key={s} value={s}>
                {VOICE_SITUATION_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Собеседник"
            value={addressee ?? ""}
            onChange={(e) =>
              setAddressee(e.target.value ? Number(e.target.value) : null)
            }
            className="border border-[var(--color-input)] rounded-md px-2 py-1 text-sm"
          >
            <option value="">любой собеседник</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.canonicalName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)]"
          >
            Добавить образец
          </button>
        </div>
      </form>

      {list === null ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">Загрузка…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Образцов речи нет. Три коротких — обычный разговор, конфликт,
          уязвимость — дают Writer’у диапазон.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((s) => (
            <li key={s.id} className="text-sm flex items-start gap-2">
              <span className="flex-1">
                «{s.text}»{" "}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {VOICE_SITUATION_LABELS[s.situation]}
                  {s.addresseeCharacterId !== null &&
                    ` · ${nameById.get(s.addresseeCharacterId) ?? `#${s.addresseeCharacterId}`}`}
                  {s.status === "proposed" && " · ждёт решения"}
                </span>
              </span>
              {s.status === "proposed" && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(s.id, "accepted")}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(s.id, "rejected")}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
                  >
                    Отклонить
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`Удалить образец ${s.id}`}
                disabled={busy}
                onClick={async () => {
                  await api.deleteVoiceSample(s.id);
                  await load();
                }}
                className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Написать падающий тест качеств отношения**

Создать `apps/web/src/components/__tests__/RelationshipQualities.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RelationshipQualities } from "../RelationshipQualities";

const updateRelationship = vi.fn();
vi.mock("@/api/client", () => ({ api: { updateRelationship: (...a: unknown[]) => updateRelationship(...a) } }));

const rel = {
  id: 5, bookId: 3, fromCharacterId: 1, toCharacterId: 2,
  type: "напарник", tension: 0, notes: null, revision: 2,
  profile: { schemaVersion: 2, trust: null, respect: null, attachment: null,
    dependency: null, fear: null, duty: null, resentment: null,
    expectations: null, disputes: [], silences: [], register: null, extra: {} },
  createdAt: "", updatedAt: "",
};

beforeEach(() => updateRelationship.mockReset());

describe("RelationshipQualities", () => {
  it("сохраняет с текущей ревизией", async () => {
    updateRelationship.mockResolvedValue({ ...rel, revision: 3 });
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("доверие"), "верит на слово");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateRelationship).toHaveBeenCalled());
    const [, body] = updateRelationship.mock.calls[0] as [number, { expectedRevision: number }];
    expect(body.expectedRevision).toBe(2);
  });

  it("409 показывает понятное сообщение, а не код", async () => {
    updateRelationship.mockRejectedValue(new Error("revision_conflict"));
    render(<RelationshipQualities relationship={rel as never} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("доверие"), "х");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("изменилась");
    expect(alert.textContent).not.toContain("revision_conflict");
  });
});
```

- [ ] **Step 5: Прогнать, убедиться что падает, написать компонент**

Run: `pnpm --filter @book-forge/web test -- src/components/__tests__/RelationshipQualities.test.tsx`
Expected: FAIL, модуль не найден.

```tsx
import { useState } from "react";
import {
  RELATIONSHIP_QUALITY_LABELS,
  type DirectedRelationship,
  type Relationship,
} from "@book-forge/shared";
import { api } from "@/api/client";

interface Props {
  relationship: Relationship;
  onSaved: () => void | Promise<void>;
}

/** Качества одного направления A → B (ТЗ индивидуальности, раздел 5.3).
 *  Направление B → A — другая строка и другой экземпляр этого компонента:
 *  правка одного не трогает другое (INV-03). */
export function RelationshipQualities({ relationship, onSaved }: Props) {
  const [draft, setDraft] = useState<DirectedRelationship>(relationship.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: string) {
    setDraft((p) => ({ ...p, [key]: value.trim() ? value : null }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateRelationship(relationship.id, {
        expectedRevision: relationship.revision,
        profile: draft,
      });
      await onSaved();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Внутренний код в русском экране не показывается.
      setError(
        raw.includes("revision_conflict")
          ? "Связь изменилась в другом месте. Обновите страницу и повторите."
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {Object.entries(RELATIONSHIP_QUALITY_LABELS).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <span className="w-32 text-[var(--color-muted-foreground)]">
              {label}
            </span>
            <input
              aria-label={label}
              value={(draft as Record<string, unknown>)[key] as string ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              placeholder="неизвестно"
              className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs">
          <span className="w-32 text-[var(--color-muted-foreground)]">
            разногласия
          </span>
          <input
            aria-label="разногласия"
            value={draft.disputes.join(", ")}
            onChange={(e) =>
              setDraft((p) => ({
                ...p,
                disputes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="через запятую"
            className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-32 text-[var(--color-muted-foreground)]">
            умолчания
          </span>
          <input
            aria-label="умолчания"
            value={draft.silences.join(", ")}
            onChange={(e) =>
              setDraft((p) => ({
                ...p,
                silences: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="через запятую"
            className="flex-1 border border-[var(--color-input)] rounded-md px-2 py-0.5 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="self-start text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 disabled:border-[var(--color-border-soft)] disabled:text-[var(--color-text-muted)]"
      >
        Сохранить
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Примонтировать в `KnowledgePanel`**

В `CharactersTab` под каждым героем — `<VoiceSamples bookId={bookId} characterId={c.id} characters={list} />` (раскрывающийся блок, чтобы список героев не разъезжался). В `RelationshipsTab` под каждой связью — `<RelationshipQualities relationship={r} onSaved={load} />`, тоже раскрывающийся. Логику вкладок больше ничем не трогать: файл и так 441 строка.

- [ ] **Step 7: Прогнать тесты веба**

Run: `pnpm --filter @book-forge/web test`
Expected: всё зелёное, вывод без предупреждений.

- [ ] **Step 8: Коммит**

```bash
git add apps/web/src/components/VoiceSamples.tsx apps/web/src/components/RelationshipQualities.tsx apps/web/src/components/KnowledgePanel.tsx apps/web/src/components/__tests__/VoiceSamples.test.tsx apps/web/src/components/__tests__/RelationshipQualities.test.tsx
git commit -m "feat(web): образцы речи и качества отношений в панели материалов"
```

---

### Task 10: Контекст персонажа отдаёт качества направления и образцы речи

**Files:**
- Modify: `packages/agents/src/character.ts`
- Test: `packages/agents/src/__tests__/character-context.test.ts` (создать, если файла нет)

**Interfaces:**
- Consumes: `selectVoiceSamples`, `VOICE_SITUATION_LABELS`, `RELATIONSHIP_QUALITY_LABELS`, `normalizeCharacterProfile`, `toVoiceSample`.
- Produces: `CharacterAgentResult` получает `voiceSamples`; `characterContextToPrompt(result, charNameById, options?)` принимает необязательные `{ situation, addresseeCharacterId, beforeChapterOrder }`.

Промпты Writer'а здесь **не меняются** — это этап 5. Меняется только то, что собирается и как оно отрисовано.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/agents/src/__tests__/character-context.test.ts`. Тест в базу не ходит: `characterContextToPrompt` — чистая функция.

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  type CharacterVoiceSample,
  type Relationship,
} from "@book-forge/shared";
import { characterContextToPrompt } from "../character.js";

const names = new Map([
  [1, "Рин"],
  [2, "Сарек"],
]);

function rel(id: number, from: number, to: number, profile: unknown): Relationship {
  return {
    id, bookId: 3, fromCharacterId: from, toCharacterId: to,
    type: "напарник", tension: 0, notes: null, revision: 0,
    profile: normalizeRelationshipProfile(profile),
    createdAt: "", updatedAt: "",
  };
}

function voice(p: Partial<CharacterVoiceSample>): CharacterVoiceSample {
  return {
    id: 1, bookId: 3, characterId: 1, text: "…", situation: "neutral",
    addresseeCharacterId: null, note: null, origin: "author", status: "accepted",
    sourceVersionId: null, sourceChapterOrder: null, createdAt: "", updatedAt: "",
    ...p,
  };
}

const result = {
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
  relationships: [
    rel(10, 1, 2, { trust: "верит на слово" }),
    rel(11, 2, 1, { resentment: "не простил смену" }),
  ],
  voiceSamples: [
    voice({ id: 1, situation: "authority", text: "Так точно." }),
    voice({ id: 2, situation: "intimate", text: "Ты опять за своё." }),
  ],
};

const bare = { ...result, relationships: [], voiceSamples: [] };

describe("characterContextToPrompt", () => {
  it("AC-05: обе стороны отношения попадают в промпт раздельно", () => {
    const text = characterContextToPrompt(result, names);
    expect(text).toContain("Рин → Сарек");
    expect(text).toContain("доверие: верит на слово");
    expect(text).toContain("Сарек → Рин");
    expect(text).toContain("обида: не простил смену");
  });

  it("AC-06: для разговора с начальником берутся образцы этого регистра", () => {
    const boss = characterContextToPrompt(result, names, { situation: "authority" });
    const close = characterContextToPrompt(result, names, { situation: "intimate" });
    expect(boss).toContain("Так точно.");
    expect(boss).not.toContain("Ты опять за своё.");
    expect(close).toContain("Ты опять за своё.");
  });

  it("без образцов и качеств лишних блоков нет", () => {
    const text = characterContextToPrompt(bare, names);
    expect(text).not.toContain("Образцы речи");
    expect(text).not.toContain("доверие:");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/__tests__/character-context.test.ts`
Expected: FAIL — качеств и образцов в выводе нет.

- [ ] **Step 3: Расширить сборку и отрисовку**

В `gatherCharacterContext` дочитать образцы речи участников одним запросом:

```ts
const voiceRows = sqlite
  .prepare(
    `SELECT * FROM character_voice_samples
     WHERE character_id IN (${placeholders}) AND status = 'accepted'
     ORDER BY id ASC`,
  )
  .all(...ids) as CharacterVoiceSampleRow[];
```

`ORDER BY id ASC` — не украшение: порядок должен быть стабильным ещё до отбора, иначе `selectVoiceSamples` получает разный вход на одинаковых данных.

Результат сложить в `CharacterAgentResult`:

```ts
export interface CharacterAgentResult {
  characters: CharacterContext[];
  relationships: Relationship[];
  /** Принятые образцы речи всех участников, в стабильном порядке. */
  voiceSamples: CharacterVoiceSample[];
}
```

и вернуть `voiceSamples: voiceRows.map(toVoiceSample)` из обеих ветвей
`gatherCharacterContext`, включая две ранние с пустым результатом — иначе
тип не сойдётся.

В `characterContextToPrompt` добавить после блока персонажа:

```ts
    const samplesFor = (characterId: number) =>
      result.voiceSamples.filter((s) => s.characterId === characterId);

    const mine = selectVoiceSamples(samplesFor(c.id), {
      situation: options?.situation ?? "neutral",
      addresseeCharacterId: options?.addresseeCharacterId ?? null,
      beforeChapterOrder: options?.beforeChapterOrder ?? null,
    });
    if (mine.length > 0) {
      lines.push("- Образцы речи (диапазон, не образец для копирования):");
      for (const s of mine) {
        lines.push(`  · [${VOICE_SITUATION_LABELS[s.situation]}] ${s.text}`);
      }
    }
```

В блоке отношений после существующей строки `type`/`tension` дописать непустые качества:

```ts
      for (const [key, label] of Object.entries(RELATIONSHIP_QUALITY_LABELS)) {
        const value = (r.profile as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) {
          lines.push(`  · ${label}: ${value}`);
        }
      }
```

Старую строку `type (tension: …)` оставить: раздел 5.3 ТЗ требует сохранить прежние поля.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm --filter @book-forge/agents test`
Expected: PASS, включая `writer-prompt.test.ts` — форма промпта Writer'а не менялась.

- [ ] **Step 5: Коммит**

```bash
git add packages/agents/src/character.ts packages/agents/src/__tests__/character-context.test.ts
git commit -m "feat(agents): контекст персонажа несёт качества направления и образцы речи"
```

---

### Task 11: Проверка на копии реальной базы и документация

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-05-character-individuality.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: подтверждённый AC-32 и AC-31, абзац в `CLAUDE.md`, отметка о выполнении в таблице раздела 18 ТЗ.

- [ ] **Step 1: AC-32 — миграция на копии непустой базы**

```bash
SCRATCH="$(dirname "$(mktemp -u)")/bf-0022"
mkdir -p "$SCRATCH"
cp data/db.sqlite "$SCRATCH/before.sqlite"
node -e "const D=require('better-sqlite3');const d=new D(process.env.SCRATCH+'/before.sqlite',{readonly:true});for(const t of ['books','chapters','chapter_versions','characters','relationships','chapter_drafts'])console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c);" 
```
Записать числа **до** миграции: без них «после» ничего не доказывает.

```bash
cp "$SCRATCH/before.sqlite" "$SCRATCH/after.sqlite"
DB_PATH="$SCRATCH/after.sqlite" pnpm migrate
node -e "const D=require('better-sqlite3');const d=new D(process.env.SCRATCH+'/after.sqlite',{readonly:true});for(const t of ['books','chapters','chapter_versions','characters','relationships','chapter_drafts'])console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c);console.log('revision', d.prepare('SELECT COUNT(*) c FROM characters WHERE revision=0').get().c);"
```
Expected: все счётчики совпадают с «до»; у всех персонажей `revision = 0`. Использовать копию, а не рабочую базу.

- [ ] **Step 2: AC-32/AC-35 — открыть книгу на мигрированной копии**

```bash
DB_PATH="$SCRATCH/after.sqlite" pnpm dev:server &
sleep 4
curl -s localhost:3001/api/books/3/characters | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log(a.length, a.map(c=>[c.canonicalName,c.revision,c.profile.role??'—',c.profile.schemaVersion].join('|')).join('\n'));});"
curl -s localhost:3001/api/books/3/relationships | head -c 400
kill %1
```
Expected: шесть героев книги 3 (id 22–27), у каждого `schemaVersion: 2`, `revision: 0`, и у материализованных — непустой `role`. Это AC-35 на реальных данных: поля лежали в `profile_json` и раньше, теперь они видны.

- [ ] **Step 3: AC-31 — импортированный состав и план**

На той же копии проверить книгу, куда интейк уже клал кандидатов: состав читается, аспект сюжета на месте, второго плана не появилось (`SELECT json_array_length(json_extract(outline_json,'$.variants')) FROM books WHERE id = 3`). Если такой книги в базе нет — отметить в отчёте, что AC-31 подтверждён только тестами `intake-landing.test.ts`, и не выдавать это за проверку на реальных данных.

- [ ] **Step 4: Полный прогон**

```bash
pnpm typecheck
pnpm test
pnpm build
```
Expected: всё зелёное, вывод без предупреждений.

- [ ] **Step 5: Абзац в `CLAUDE.md`**

Дописать после абзаца «Один план книги», в той же манере (плотный русский, причины, а не перечень файлов):

> **Персонажи V2 (2026-09-17, этап 2 индивидуальности персонажей):** профиль персонажа получил `schemaVersion: 2` и разъехался на две схемы. `characterProfileV2Schema` — схема чтения: без пределов длины, без обязательных полей, с `extra`, куда уезжает всё, чего она не знает. `characterProfileWriteSchema` — схема записи, с пределами, применяется только в маршрутах создания и изменения. Разделение не косметическое: `toCharacter` звал `schema.parse`, и одна кривая строка роняла `GET /books/:id/characters` на всю книгу, а срезанные неизвестные ключи и были той потерей `role/age/background`, которую искали (поля всё это время лежали в `profile_json` — терялись они на чтении, не на записи). Миграция 0022 поэтому чисто структурная: `revision` у персонажей и отношений, `profile_json` у отношений, общая полиморфная история `entity_profile_versions` и банк `character_voice_samples`; ни одна строка `profile_json` не переписана. `PATCH /characters/:id` и `PATCH /relationships/:id` требуют `expectedRevision` **обязательно** — переходного режима не заводили, потому что с необязательным полем два изменения с одной базой молча перезаписывают друг друга; несовпадение — 409 `revision_conflict` с текущей ревизией в `details`. Ревизия никогда не растёт без строки истории: обе записи идут одной транзакцией [entity-revisions.ts](apps/server/src/utils/entity-revisions.ts). Отношения остались направленными: A → B и B → A — две независимые строки со своими качествами (доверие, уважение, привязанность, зависимость, страх, долг, обида, ожидания, разногласия, умолчания, регистр), и ни одно из них не вычисляется из `tension` — «-0.9» и «боится» разные сведения. Образцы речи отбираются [`selectVoiceSamples`](packages/shared/src/character-voice.ts) детерминированно: только принятые, только не из будущих глав относительно границы сцены, дальше вес по ситуации и адресату и стабильный порядок по id. `ORDER BY random()` здесь запрещён по той же причине, что и в подборе стилевых примеров: образцы едут в кэшируемый префикс промпта. Материализация состава перестала быть `INSERT`-ом: кандидат с `materializedEntityId` обновляет свою строку и наращивает ревизию, поэтому второе «Добавить в канон» правит героев, а не удваивает их. `resolveEntity` на двух героях с одинаковым нормализованным именем возвращает `null` вместо первого попавшегося — тихий выбор пришивал факт чужому герою и всплывал только в готовой главе. Отдельного экрана карточки в этом этапе нет намеренно: он проектируется один раз под «составы» фазы 4 конвейера, а авторское редактирование V2 пока живёт во вкладках `KnowledgePanel`.

- [ ] **Step 6: Отметить этап в ТЗ**

В `docs/superpowers/specs/2026-09-05-character-individuality.md`, таблица раздела 18, строка этапа 2 — дописать в третью колонку: `Выполнено 2026-09-17, план: docs/superpowers/plans/2026-09-17-character-stage-2-characters-v2.md`.

- [ ] **Step 7: Коммит**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-05-character-individuality.md
git commit -m "docs: персонажи V2"
```

---

## Что этот этап сознательно не делает

- **Экрана карточки персонажа нет.** Раздел 18 ТЗ: проектировать один раз под «составы» фазы 4 конвейера. Пункты раздела 13 «Состав персонажей», «Карточка» и «Предложение карточки» закрываются вместе с фазой 4, не здесь.
- **Обогащения профиля моделью нет.** Раздел 5.1 описывает предложение с различиями относительно исходника; агент, который его порождает, — это работа этапа 5 (генерация и критика). Здесь есть только место, куда такое предложение ляжет: `entity_profile_versions` и `origin: "llm"`.
- **События и знания персонажей (раздел 5.4) — этап 3.** `character_knowledge` в этом этапе не трогается совсем: перенос в события идёт вместе с `character_events`, иначе получится две несовместимые половины одного переезда.
- **Промпты Writer'а не меняются.** Задача 10 меняет только то, что собирается в контекст и как оно отрисовано. Правила «не копировать реплику дословно» и проверка состава — этап 5.
- **AC-07–29, AC-33–34, AC-36–37 сюда не входят** и проверяются на своих этапах.
