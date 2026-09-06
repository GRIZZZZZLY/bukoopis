# Фаза 5 «Один план книги»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У книги появляется один экран плана: варианты с поглавными строками, «Утвердить план» создаёт главы с намерениями, авторское оглавление из материалов становится планом, а не прозой, и одна кнопка готовит черновики всех этапов разом.

**Architecture:** Этап `plot` сохраняет идентификатор и теряет markdown-природу: его экран становится «Планом». Вариант `books.outline_json` получает необязательный поглавный список и пометку происхождения, поэтому старые записи читаются без миграции. Утверждение плана — один маршрут, который сопоставляет строки с существующими главами по порядку. Быстрый сбор — раннер по образцу приёма материала: реестр в памяти, SSE, отмена, память о пройденных этапах.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Hono + SSE, better-sqlite3, zod 4, React 18 + Vite, vitest.

**Spec:** [docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md](../specs/2026-09-04-author-pipeline-redesign.md), раздел «Фаза 5. Один план книги».

## Global Constraints

- Русский в интерфейсе, комментариях и сообщениях; английские идентификаторы.
- TypeScript strict с `noUncheckedIndexedAccess`. ESM: относительные импорты внутри пакета оканчиваются на `.js`.
- Новых зависимостей не добавлять.
- **Проект только для настольного экрана.** Вёрстка уже 768px не важна, адаптивную работу не добавлять.
- Ничего не утверждается без автора. Быстрый сбор готовит черновики в статусе `reviewing` и не создаёт глав.
- `plot` **остаётся** в `STAGE_IDS`. `studioStateSchema` проверяет, что ключи сохранённых этапов входят в этот список, и книга с уже приземлённым аспектом сюжета перестала бы читаться в тот же миг, когда идентификатор исчезнет.
- Написанный текст главы не трогается никогда. Утверждение плана меняет намерения и создаёт недостающие главы, но не переписывает названия существующих и не касается версий.
- Миграций базы в этой фазе нет: всё новое лежит в уже существующих JSON-колонках.
- Новые серверные тесты делают `delete process.env.ANTHROPIC_API_KEY;` в `beforeEach` — `createApp` поднимает настоящий воркер памяти.
- Ставить в коммит только файлы своей задачи. Никогда `git add -A`.

---

## Порядок и промежуточные состояния

Задачи 1–2 расширяют схемы, 3–5 дают серверу всё, что нужно плану, 6–7 переносят интерфейс, 8 чинит подсчёт готовности этапа, 9–10 добавляют быстрый сбор, 11 закрывает документацией и проверкой на реальной книге.

После задачи 6 и до задачи 7 экран плана уже работает, а старая панель outline ещё висит на «Главах» — две двери в одно место на один-два коммита. Это ожидаемо; не пытаться сгладить временной заглушкой.

## File Structure

**Создаются:**

| Файл | Ответственность |
|---|---|
| `apps/server/src/utils/plan-approve.ts` | Сопоставление поглавных строк с существующими главами и создание недостающих; вся транзакция утверждения |
| `apps/server/src/utils/__tests__/plan-approve.test.ts` | Тесты сопоставления: совпадение, добавление, повтор, целостность текста |
| `apps/server/src/utils/quick-start-run.ts` | Раннер быстрого сбора: последовательность этапов, события, остановка |
| `apps/server/src/utils/quick-start-cancel.ts` | Реестр отменяемых прогонов быстрого сбора |
| `apps/server/src/utils/__tests__/quick-start-run.test.ts` | Тесты раннера на моках агентов |
| `apps/web/src/pages/PlanStagePage.tsx` | Экран «План»: варианты, поглавные строки, заметки из материалов, «Утвердить план» |
| `apps/web/src/pages/__tests__/PlanStagePage.test.tsx` | Тесты экрана |
| `apps/web/src/components/studio/QuickStartPanel.tsx` | Кнопка быстрого сбора и прогресс по этапам |
| `apps/web/src/components/studio/__tests__/QuickStartPanel.test.tsx` | Тесты панели |

**Меняются:**

| Файл | Что именно |
|---|---|
| `packages/shared/src/plot.ts` | `outlineChapterSchema`, `chapters?` и `source?` у варианта, ослабление обязательности повествовательных полей, `renderOutlineChapterIntent` |
| `packages/shared/src/intake.ts` | `chapters?` у фрагмента, `buildImportedPlanVariant` |
| `packages/shared/src/studio-warnings.ts` | Случай `plot` в `isStageDone` и прокидывание признака утверждённого плана |
| `packages/agents/src/plot.ts` | Тулсхема пришпиливает обязательность полей, ослабленных в хранилище |
| `packages/agents/src/intake/classifier.ts` | Правило про разбор оглавления в поглавные строки |
| `apps/server/src/utils/intake-landing.ts` | Фрагмент `plot` с разобранными главами становится вариантом плана, а не аспектом |
| `apps/server/src/utils/intake-run.ts` | Приземление вариантов плана в `outline_json` |
| `apps/server/src/routes/plot.ts` | Маршрут утверждения плана |
| `apps/server/src/routes/studio.ts` | Маршруты быстрого сбора: запуск, поток, отмена, что сейчас идёт |
| `apps/server/src/app.ts` | Реестр отмены быстрого сбора |
| `apps/web/src/App.tsx` | `plot` уходит к `PlanStagePage` |
| `apps/web/src/pages/MarkdownStagePage.tsx` | `plot` уходит из `MARKDOWN_STAGES` |
| `apps/web/src/pages/ChaptersStagePage.tsx` | `OutlinePanel` уходит со страницы |
| `apps/web/src/components/PlanPanel.tsx` | Намерение читается из главы, поле ручного ввода исчезает |
| `apps/web/src/api/client.ts` | Утверждение плана, быстрый сбор |
| `apps/web/src/pages/StudioPage.tsx` | Кнопка быстрого сбора |
| `CLAUDE.md` | Описание нового экрана и быстрого сбора |

---

### Task 1: Поглавные строки в варианте плана

Вариант плана сегодня описывает книгу целиком (логлайн, синопсис, арки) и знает только *число* глав. Авторское оглавление — это, наоборот, список глав без синопсиса. Обе формы должны лежать в одной колонке, иначе экран плана раздвоится.

**Files:**
- Modify: `packages/shared/src/plot.ts:135-154`
- Modify: `packages/shared/src/plot.test.ts`
- Modify: `packages/agents/src/plot.ts:22-27`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `outlineChapterSchema`, `OutlineChapter` — `{ title, pov?, goal?, conflict?, stakes?, hook? }`
  - `bookOutlineVariantSchema` с необязательными `chapters` и `source: "llm" | "author_material"`
  - `renderOutlineChapterIntent(ch: OutlineChapter): string`

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/shared/src/plot.test.ts`:

```ts
import {
  bookOutlineVariantSchema,
  outlineChapterSchema,
  renderOutlineChapterIntent,
} from "./plot.js";

describe("outlineChapterSchema", () => {
  it("принимает строку с одним только названием — оглавление автора бывает голым", () => {
    const parsed = outlineChapterSchema.parse({ title: "Глава 1. Порог" });
    expect(parsed.title).toBe("Глава 1. Порог");
    expect(parsed.pov).toBeUndefined();
  });

  it("принимает полную строку", () => {
    const parsed = outlineChapterSchema.parse({
      title: "Порог",
      pov: "Рин",
      goal: "Уйти незамеченной",
      conflict: "Сторож не спит",
      stakes: "Поймают — не выйдет больше никогда",
      hook: "За спиной щёлкает замок",
    });
    expect(parsed.pov).toBe("Рин");
    expect(parsed.hook).toBe("За спиной щёлкает замок");
  });

  it("пустое название отвергается", () => {
    expect(() => outlineChapterSchema.parse({ title: "  " })).toThrow();
  });
});

describe("bookOutlineVariantSchema — вариант из материалов автора", () => {
  it("принимает вариант без синопсиса и арок, но с главами", () => {
    const parsed = bookOutlineVariantSchema.parse({
      label: "из ваших материалов",
      estimatedChapters: 2,
      source: "author_material",
      chapters: [{ title: "Порог" }, { title: "Мост", pov: "Сарек" }],
    });
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.source).toBe("author_material");
    expect(parsed.logline).toBeUndefined();
  });

  it("старый сгенерированный вариант без chapters и source читается как был", () => {
    const parsed = bookOutlineVariantSchema.parse({
      label: "тёмный",
      logline: "Логлайн",
      synopsis: "Синопсис",
      themes: ["предательство"],
      protagonist: "Ратибор",
      antagonist: null,
      setting: "Лес",
      arcs: [{ title: "Арка", summary: "s", keyBeats: ["b"] }],
      estimatedChapters: 12,
    });
    expect(parsed.chapters).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });
});

describe("renderOutlineChapterIntent", () => {
  it("собирает намерение из заполненных полей и пропускает пустые", () => {
    const text = renderOutlineChapterIntent({
      title: "Порог",
      pov: "Рин",
      goal: "Уйти незамеченной",
      conflict: "Сторож не спит",
    });
    expect(text).toContain("POV: Рин");
    expect(text).toContain("Цель: Уйти незамеченной");
    expect(text).toContain("Конфликт: Сторож не спит");
    expect(text).not.toContain("Ставки:");
    expect(text).not.toContain("Крючок:");
  });

  it("строка с одним названием даёт непустое намерение", () => {
    expect(renderOutlineChapterIntent({ title: "Порог" }).trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/shared test -- src/plot.test.ts`
Ожидаемо: FAIL, `outlineChapterSchema is not exported`.

- [ ] **Step 3: Написать реализацию**

В `packages/shared/src/plot.ts` заменить `bookOutlineVariantSchema` (строки 135-147) на:

```ts
/** Строка поглавного плана. Всё, кроме названия, необязательно: оглавление
 *  автора бывает голым списком, и выдумывать за него POV или конфликт — ровно
 *  то, чего фаза 5 не должна делать. */
export const outlineChapterSchema = z.object({
  title: z.string().trim().min(1).max(300),
  pov: z.string().trim().min(1).max(200).optional(),
  goal: z.string().trim().min(1).max(2000).optional(),
  conflict: z.string().trim().min(1).max(2000).optional(),
  stakes: z.string().trim().min(1).max(2000).optional(),
  hook: z.string().trim().min(1).max(2000).optional(),
});
export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

/** Намерение главы для Plot-агента: то, что автор раньше набирал руками в
 *  `PlanPanel`. Пустые поля пропускаются — строка «Конфликт: » ничего не
 *  сообщает и только сбивает модель. */
export function renderOutlineChapterIntent(ch: OutlineChapter): string {
  const lines: string[] = [ch.title];
  if (ch.pov) lines.push(`POV: ${ch.pov}`);
  if (ch.goal) lines.push(`Цель: ${ch.goal}`);
  if (ch.conflict) lines.push(`Конфликт: ${ch.conflict}`);
  if (ch.stakes) lines.push(`Ставки: ${ch.stakes}`);
  if (ch.hook) lines.push(`Крючок: ${ch.hook}`);
  return lines.join("\n");
}

/** Откуда взялся вариант плана. Автор должен видеть, что перед ним его
 *  собственное оглавление, а не выдумка модели. */
export const outlineSourceSchema = z.enum(["llm", "author_material"]);
export type OutlineSource = z.infer<typeof outlineSourceSchema>;

/** Повествовательные поля здесь необязательны, а в тулсхеме агента —
 *  обязательны. Тот же приём, что уже применён к `architecture` выше: схема
 *  хранения описывает всё, что может лежать в колонке, включая вариант из
 *  авторского оглавления, у которого нет ни синопсиса, ни арок; тулсхема
 *  описывает, что обязан вернуть генератор. Ослаблять требования к генерации
 *  это не должно — см. `bookOutlineToolSchema` в packages/agents/src/plot.ts. */
export const bookOutlineVariantSchema = z.object({
  label: z.string().min(1),
  logline: z.string().min(1).optional(),
  synopsis: z.string().min(1).optional(),
  themes: z.array(z.string()).max(8).optional(),
  protagonist: z.string().min(1).optional(),
  antagonist: z.string().nullable().optional(),
  setting: z.string().min(1).optional(),
  arcs: z.array(arcOutlineSchema).max(7).optional(),
  estimatedChapters: z.number().int().positive().max(120),
  architecture: narrativeArchitectureSchema.optional(),
  /** Поглавные строки. Есть у варианта из материалов автора и у любого
   *  варианта, который автор дополнил руками. */
  chapters: z.array(outlineChapterSchema).max(200).optional(),
  source: outlineSourceSchema.optional(),
});
export type BookOutlineVariant = z.infer<typeof bookOutlineVariantSchema>;
```

- [ ] **Step 4: Пришпилить обязательность в тулсхеме агента**

В `packages/agents/src/plot.ts` заменить `bookOutlineToolSchema` (строки 22-27) так, чтобы генератор по-прежнему обязан отдавать полный вариант:

```ts
/** Схема хранения ослаблена ради варианта из авторского оглавления (см.
 *  комментарий у `bookOutlineVariantSchema`). Генератору послаблений нет:
 *  здесь всё, что он должен вернуть, снова обязательно. */
const bookOutlineToolSchema = z.object({
  variants: z
    .array(
      bookOutlineVariantSchema.extend({
        logline: z.string().min(1),
        synopsis: z.string().min(1),
        themes: z.array(z.string()).min(1).max(8),
        protagonist: z.string().min(1),
        antagonist: z.string().nullable(),
        setting: z.string().min(1),
        arcs: z.array(arcOutlineSchema).min(2).max(7),
        architecture: narrativeArchitectureSchema,
      }),
    )
    .min(1)
    .max(5),
});
```

Импорт `arcOutlineSchema` и `narrativeArchitectureSchema` из `@book-forge/shared` добавить, если их там ещё нет.

- [ ] **Step 5: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/shared test -- src/plot.test.ts`
Ожидаемо: PASS, 7 новых тестов.

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0. Ослабление полей делает их `string | undefined` у потребителей — компилятор укажет каждое место (`OutlinePanel`, `loadBookContext`, промпты). Поправить их защитой от `undefined`, не меняя поведения для полного варианта.

Выполнить: `pnpm --filter @book-forge/shared test && pnpm --filter @book-forge/agents test`
Ожидаемо: PASS.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/plot.ts packages/shared/src/plot.test.ts packages/agents/src/plot.ts
git commit -m "feat(plot): an outline variant can carry the author's own chapter list

A generated variant describes the book and knows only how many chapters it
will have; the author's table of contents is the opposite — a list of chapters
with no synopsis. Both have to live in one column or the plan screen splits in
two. The storage schema relaxes the narrative fields and the agent's tool
schema pins them back, the same split the architecture sheet already uses."
```

---

### Task 2: Разобранные главы во фрагменте интейка

У фрагмента уже есть необязательное поле сущностей для персонажей и предметов. Поглавные строки устроены так же: то же одно поле, тот же один вызов классификатора.

**Files:**
- Modify: `packages/shared/src/intake.ts:36-45`
- Modify: `packages/shared/src/intake.test.ts`

**Interfaces:**
- Consumes: `outlineChapterSchema`, `BookOutlineVariant`, `renderOutlineChapterIntent` (задача 1).
- Produces:
  - `intakeFragmentSchema` с `chapters?: OutlineChapter[]`
  - `buildImportedPlanVariant(fragment: IntakeFragment): BookOutlineVariant | undefined`

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/shared/src/intake.test.ts`:

```ts
import { buildImportedPlanVariant, intakeFragmentSchema } from "./intake.js";

describe("фрагмент с разобранным оглавлением", () => {
  const fragment = {
    target: "plot" as const,
    title: "Оглавление",
    body: "Глава 1. Порог\nГлава 2. Мост",
    chapters: [
      { title: "Порог", pov: "Рин", goal: "Уйти незамеченной" },
      { title: "Мост" },
    ],
  };

  it("схема принимает поглавные строки", () => {
    const parsed = intakeFragmentSchema.parse(fragment);
    expect(parsed.chapters).toHaveLength(2);
  });

  it("схема принимает фрагмент без глав — так приходит обычная проза", () => {
    const parsed = intakeFragmentSchema.parse({
      target: "plot",
      title: "Заметки о сюжете",
      body: "текст",
    });
    expect(parsed.chapters).toBeUndefined();
  });

  it("строит вариант плана, помеченный авторским, с числом глав по списку", () => {
    const variant = buildImportedPlanVariant(fragment);
    expect(variant).toBeDefined();
    expect(variant!.source).toBe("author_material");
    expect(variant!.estimatedChapters).toBe(2);
    expect(variant!.chapters?.[0]).toMatchObject({ title: "Порог", pov: "Рин" });
    expect(variant!.label).toContain("Оглавление");
  });

  it("не выдумывает синопсис и арки за автора", () => {
    const variant = buildImportedPlanVariant(fragment);
    expect(variant!.synopsis).toBeUndefined();
    expect(variant!.arcs).toBeUndefined();
  });

  it("фрагмент без глав вариантом не становится", () => {
    expect(
      buildImportedPlanVariant({ target: "plot", title: "t", body: "b" }),
    ).toBeUndefined();
  });

  it("пустой список глав вариантом не становится", () => {
    expect(
      buildImportedPlanVariant({ target: "plot", title: "t", body: "b", chapters: [] }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/shared test -- src/intake.test.ts`
Ожидаемо: FAIL, `buildImportedPlanVariant is not exported`.

- [ ] **Step 3: Написать реализацию**

В `packages/shared/src/intake.ts` дополнить импорт и схему фрагмента:

```ts
import {
  outlineChapterSchema,
  type BookOutlineVariant,
  type OutlineChapter,
} from "./plot.js";
```

в `intakeFragmentSchema` после поля `entities` добавить:

```ts
  /** Только для цели `plot`: оглавление, разобранное на строки. Пусто, если в
   *  тексте не было поглавного списка — тогда фрагмент останется заметкой. */
  chapters: z.array(outlineChapterSchema).max(200).optional(),
```

и в конец файла:

```ts
/** Авторское оглавление как вариант плана рядом со сгенерированными.
 *  Ничего не досочиняет: ни синопсиса, ни арок, ни архитектуры — только то,
 *  что автор написал сам. `estimatedChapters` берётся из длины списка, а не
 *  из догадки. */
export function buildImportedPlanVariant(
  fragment: IntakeFragment,
): BookOutlineVariant | undefined {
  const chapters: OutlineChapter[] = fragment.chapters ?? [];
  if (chapters.length === 0) return undefined;
  return {
    label: `${VARIANT_LABEL}: ${fragment.title}`,
    estimatedChapters: chapters.length,
    source: "author_material",
    chapters,
  };
}
```

- [ ] **Step 4: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/shared test -- src/intake.test.ts`
Ожидаемо: PASS, 6 новых тестов.

Выполнить: `pnpm --filter @book-forge/shared typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 5: Коммит**

```bash
git add packages/shared/src/intake.ts packages/shared/src/intake.test.ts
git commit -m "feat(intake): a fragment can carry the author's table of contents

The same shape the entities field already has for characters and items: one
optional field, one classifier call. A fragment without chapters stays a note,
which is what prose about the plot should be."
```

---

### Task 3: Классификатор разбирает оглавление

Схему фрагмента классификатор берёт из общего пакета, поэтому поле у него уже есть после задачи 2. Не хватает единственного — инструкции его заполнять.

**Files:**
- Modify: `packages/agents/src/intake/classifier.ts:32-53`
- Create: `packages/agents/src/__tests__/classifier-plot-chapters.test.ts`

**Interfaces:**
- Consumes: `intakeFragmentSchema` с полем глав (задача 2).
- Produces: ничего нового наружу; меняется только системный промпт.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/agents/src/__tests__/classifier-plot-chapters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildClassifierPrompt } from "../intake/classifier.js";
import { registerMaterialClassifierContract } from "../intake/classifier.js";
import { getAgentContract } from "@book-forge/llm";

describe("классификатор и поглавное оглавление", () => {
  it("системный промпт велит разбирать оглавление на строки", () => {
    registerMaterialClassifierContract();
    const contract = getAgentContract("material_classifier");
    const system = contract.systemPrompt;
    expect(system).toContain("chapters");
    // Перечислены именно те поля, которые ждёт outlineChapterSchema.
    expect(system).toMatch(/pov/i);
    expect(system).toMatch(/goal/i);
    expect(system).toMatch(/conflict/i);
    expect(system).toMatch(/stakes/i);
    expect(system).toMatch(/hook/i);
  });

  it("промпт запрещает досочинять поля, которых автор не написал", () => {
    registerMaterialClassifierContract();
    const system = getAgentContract("material_classifier").systemPrompt;
    expect(system).toMatch(/не выдумывай|не досочиняй|только то, что написано/i);
  });

  it("промпт файла по-прежнему несёт содержимое и имя", () => {
    const prompt = buildClassifierPrompt({ filename: "план.md", content: "Глава 1" });
    expect(prompt).toContain("план.md");
    expect(prompt).toContain("Глава 1");
  });
});
```

Если `getAgentContract` в `@book-forge/llm` называется иначе, взять имя из `packages/llm/src/index.ts` — контракты там регистрируются и читаются одной парой функций.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/agents test -- src/__tests__/classifier-plot-chapters.test.ts`
Ожидаемо: FAIL — в промпте нет ни `chapters`, ни запрета досочинять.

- [ ] **Step 3: Дописать правило в системный промпт**

В `packages/agents/src/intake/classifier.ts` в константе `SYSTEM` заменить строку про `plot` (строка 47) на:

```
  - plot: оглавление, поглавные планы, арки, матрицы раскрытия тайн, порядок событий.
```

и добавить отдельным правилом после строки про `entities` (строка 50):

```
- chapters заполняй ТОЛЬКО для цели plot и только когда в тексте действительно есть поглавный список: строка на главу, поля title, pov, goal, conflict, stakes, hook. Заполняй лишь те поля, которые автор написал сам; ничего не выдумывай и не достраивай по смыслу — пустое поле честнее придуманного. Если поглавного списка нет и текст про сюжет идёт сплошной прозой, chapters оставь пустым: фрагмент станет заметкой, и это правильно.
```

- [ ] **Step 4: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/agents test -- src/__tests__/classifier-plot-chapters.test.ts`
Ожидаемо: PASS, 3 теста.

Выполнить: `pnpm --filter @book-forge/agents test`
Ожидаемо: PASS.

- [ ] **Step 5: Коммит**

```bash
git add packages/agents/src/intake/classifier.ts packages/agents/src/__tests__/classifier-plot-chapters.test.ts
git commit -m "feat(intake): teach the classifier to read a table of contents as rows

The field arrived with the shared schema; what was missing was the instruction
to fill it, and the instruction not to invent what the author never wrote. A
plot fragment with no chapter list stays a note on purpose."
```

---

### Task 4: Авторское оглавление приземляется планом

Сейчас фрагмент с целью `plot` всегда становится markdown-аспектом. С этой задачи разобранное оглавление идёт в `outline_json` вариантом, а неразобранная проза по-прежнему ложится заметкой.

**Files:**
- Modify: `apps/server/src/utils/intake-landing.ts:55-112`
- Modify: `apps/server/src/utils/intake-run.ts`
- Modify: `apps/server/src/utils/__tests__/intake-landing.test.ts` (если файла нет — создать)
- Modify: `apps/server/src/routes/__tests__/intake.test.ts`

**Interfaces:**
- Consumes: `buildImportedPlanVariant` (задача 2).
- Produces:
  - `LandFragmentsResult` получает поле `planVariants: BookOutlineVariant[]`
  - `IntakeRunResult` получает `planVariants: number` (сколько вариантов легло) для сводки

- [ ] **Step 1: Написать падающий тест**

Дописать в `apps/server/src/utils/__tests__/intake-landing.test.ts` (создать файл с этим содержимым, если его нет):

```ts
import { describe, it, expect } from "vitest";
import { landFragments } from "../intake-landing.js";
import { emptyStudioState, type IntakeFragment } from "@book-forge/shared";

const NOW = "2026-09-06T10:00:00.000Z";

describe("landFragments и цель plot", () => {
  it("разобранное оглавление становится вариантом плана, а не аспектом", () => {
    const fragment: IntakeFragment = {
      target: "plot",
      title: "Оглавление",
      body: "Глава 1. Порог",
      chapters: [{ title: "Порог", pov: "Рин" }],
    };
    const result = landFragments(emptyStudioState(), [fragment], NOW);

    expect(result.planVariants).toHaveLength(1);
    expect(result.planVariants[0]?.chapters?.[0]?.title).toBe("Порог");
    expect(result.next.stages["plot"]?.aspects ?? []).toHaveLength(0);
    expect(result.landed[0]).toMatchObject({ target: "plot", kind: "plan" });
  });

  it("проза о сюжете без списка глав по-прежнему ложится заметкой", () => {
    const fragment: IntakeFragment = {
      target: "plot",
      title: "Мысли о структуре",
      body: "Хочу три части.",
    };
    const result = landFragments(emptyStudioState(), [fragment], NOW);

    expect(result.planVariants).toHaveLength(0);
    expect(result.next.stages["plot"]?.aspects).toHaveLength(1);
    expect(result.landed[0]).toMatchObject({ target: "plot", kind: "aspect" });
  });

  it("два оглавления в одной папке дают два варианта", () => {
    const mk = (title: string): IntakeFragment => ({
      target: "plot",
      title,
      body: "b",
      chapters: [{ title: "Глава" }],
    });
    const result = landFragments(emptyStudioState(), [mk("Первое"), mk("Второе")], NOW);
    expect(result.planVariants).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-landing.test.ts`
Ожидаемо: FAIL, `planVariants` не существует в результате.

- [ ] **Step 3: Развести две судьбы фрагмента plot**

В `apps/server/src/utils/intake-landing.ts` дополнить импорт `buildImportedPlanVariant` и тип `BookOutlineVariant`, расширить результат и добавить ветку:

```ts
export interface LandFragmentsResult {
  next: StudioState;
  landed: IntakeLanded[];
  /** Главы route обрабатывает сам — у них своя таблица, а не studio_state. */
  chapterFragments: IntakeFragment[];
  /** Варианты плана из авторских оглавлений: их кладёт в books.outline_json
   *  вызывающая сторона, потому что это колонка книги, а не studio_state. */
  planVariants: BookOutlineVariant[];
}
```

в теле `landFragments` завести `const planVariants: BookOutlineVariant[] = [];` рядом с `chapterFragments`, а внутри цикла — сразу после проверки `isAspectTarget` — добавить:

```ts
    // Разобранное оглавление — это план, а не заметка о плане. Аспектом оно
    // становиться не должно: приземлившись абзацем прозы, самый
    // структурированный файл в материалах обесценивается, а список глав автор
    // всё равно заводит руками.
    if (fragment.target === "plot") {
      const variant = buildImportedPlanVariant(fragment);
      if (variant) {
        planVariants.push(variant);
        landed.push({ target: "plot", title: fragment.title, kind: "plan" });
        continue;
      }
      // Списка глав в тексте не было — пусть остаётся заметкой на экране плана.
    }
```

и вернуть `planVariants` из функции.

В `packages/shared/src/intake.ts` расширить `IntakeLanded["kind"]`:

```ts
  kind: "aspect" | "chapter" | "idea" | "plan";
```

- [ ] **Step 4: Приземлить варианты в колонку книги**

В `apps/server/src/utils/intake-run.ts` после вызова `landFragments` и рядом с местом, где вставляются главы, добавить слияние вариантов в `outline_json`:

```ts
    // Варианты из авторских оглавлений дописываются к уже существующим, а не
    // заменяют их: сгенерированные варианты автор мог отбирать неделю.
    // Выбор не сдвигается — новый вариант ничего за автора не решает.
    if (planVariants.length > 0) {
      const row = sqlite
        .prepare("SELECT outline_json FROM books WHERE id = ?")
        .get(bookId) as { outline_json: string | null } | undefined;
      let outline: BookOutline = { variants: [], selectedIndex: null, generatedAt: now };
      if (row?.outline_json) {
        const parsed = bookOutlineSchema.safeParse(JSON.parse(row.outline_json));
        if (parsed.success) outline = parsed.data;
      }
      // Схема держит не больше пяти вариантов: место освобождают самые старые
      // сгенерированные, авторские не вытесняются никогда.
      const merged = [...outline.variants, ...planVariants];
      const trimmed =
        merged.length <= 5
          ? merged
          : [
              ...merged.filter((v) => v.source === "author_material"),
              ...merged.filter((v) => v.source !== "author_material"),
            ].slice(0, 5);
      sqlite
        .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
        .run(
          JSON.stringify({ ...outline, variants: trimmed, generatedAt: now }),
          now,
          bookId,
        );
    }
```

Импортировать `bookOutlineSchema` и тип `BookOutline` из `@book-forge/shared`. Число приземлившихся вариантов положить в результат прогона рядом с `chapters`, чтобы сводка могла о нём сказать.

- [ ] **Step 5: Дописать тест маршрута**

Дописать в `apps/server/src/routes/__tests__/intake.test.ts` случай, где мок классификатора возвращает фрагмент `plot` с двумя главами, и проверить, что после запроса `GET /api/books/:id` в `outlineJson` появился вариант с `source: "author_material"` и двумя строками, а на этапе `plot` аспектов не прибавилось.

- [ ] **Step 6: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-landing.test.ts`
Ожидаемо: PASS, 3 теста.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 7: Коммит**

```bash
git add packages/shared/src/intake.ts apps/server/src/utils/intake-landing.ts apps/server/src/utils/intake-run.ts apps/server/src/utils/__tests__/intake-landing.test.ts apps/server/src/routes/__tests__/intake.test.ts
git commit -m "feat(intake): the author's table of contents lands as a plan, not as prose

This is the seam between phase 2 and phase 5 that belonged to neither. A plot
fragment with parsed chapters becomes an outline variant marked as the
author's; one without stays a note, and the note is now visible on the plan
screen rather than lost with the stage that used to hold it."
```

---

### Task 5: Утверждение плана создаёт главы с намерениями

Единственное место, где план превращается в главы. Сегодня главы заводятся печатанием названия в форме, а намерение сохраняется только побочным эффектом генерации поглавного плана — отдельного маршрута сохранить намерение не существует.

**Files:**
- Create: `apps/server/src/utils/plan-approve.ts`
- Create: `apps/server/src/utils/__tests__/plan-approve.test.ts`
- Modify: `apps/server/src/routes/plot.ts:183-207` (рядом с `outline/select`)

**Interfaces:**
- Consumes: `bookOutlineSchema`, `renderOutlineChapterIntent`, `OutlineChapter` (задача 1).
- Produces:
  - `approvePlan(sqlite, bookId): ApprovePlanResult` где `ApprovePlanResult = { created: number; updated: number }`
  - `class PlanApproveError extends Error { reason: "no_outline" | "no_selection" | "no_chapters" }`
  - `POST /api/books/:id/plan/approve`

- [ ] **Step 1: Написать падающий тест**

Создать `apps/server/src/utils/__tests__/plan-approve.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { approvePlan, PlanApproveError } from "../plan-approve.js";
import type { BookOutline } from "@book-forge/shared";

let t: TestApp;
let db: DatabaseType;
let bookId: number;

function setOutline(outline: BookOutline): void {
  db.prepare("UPDATE books SET outline_json = ? WHERE id = ?").run(
    JSON.stringify(outline),
    bookId,
  );
}

function planWith(chapters: Array<{ title: string; pov?: string }>): BookOutline {
  return {
    variants: [
      {
        label: "план",
        estimatedChapters: chapters.length,
        source: "author_material",
        chapters,
      },
    ],
    selectedIndex: 0,
    generatedAt: "2026-09-06T10:00:00.000Z",
  };
}

function chapterRows(): Array<{ id: number; title: string; intent: string | null; order_index: number }> {
  return db
    .prepare("SELECT id, title, intent, order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC")
    .all(bookId) as Array<{ id: number; title: string; intent: string | null; order_index: number }>;
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "План",
    premise: "p",
  });
  bookId = b.id;
  db = new Database(`${t.dbDir}/test.sqlite`);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("approvePlan", () => {
  it("создаёт главы из плана с намерениями", () => {
    setOutline(planWith([{ title: "Порог", pov: "Рин" }, { title: "Мост" }]));
    const out = approvePlan(db, bookId);

    expect(out).toEqual({ created: 2, updated: 0 });
    const rows = chapterRows();
    expect(rows.map((r) => r.title)).toEqual(["Порог", "Мост"]);
    expect(rows[0]?.intent).toContain("POV: Рин");
    expect(rows[1]?.intent).toContain("Мост");
    // Разрежённая нумерация сохранена.
    expect(rows[0]!.order_index).toBeLessThan(rows[1]!.order_index);
  });

  it("сопоставляет по порядку: существующая глава получает намерение, лишняя строка создаётся", async () => {
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Моя первая" });
    setOutline(planWith([{ title: "Порог", pov: "Рин" }, { title: "Мост" }]));

    const out = approvePlan(db, bookId);
    expect(out).toEqual({ created: 1, updated: 1 });

    const rows = chapterRows();
    expect(rows).toHaveLength(2);
    // Название автора не тронуто, намерение проставлено.
    expect(rows[0]?.title).toBe("Моя первая");
    expect(rows[0]?.intent).toContain("POV: Рин");
    expect(rows[1]?.title).toBe("Мост");
  });

  it("повторное утверждение обновляет намерения и не плодит главы", () => {
    setOutline(planWith([{ title: "Порог" }]));
    approvePlan(db, bookId);
    setOutline(planWith([{ title: "Порог", pov: "Сарек" }]));
    const out = approvePlan(db, bookId);

    expect(out).toEqual({ created: 0, updated: 1 });
    expect(chapterRows()).toHaveLength(1);
    expect(chapterRows()[0]?.intent).toContain("POV: Сарек");
  });

  it("написанный текст не трогается", async () => {
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Написанная" },
    );
    await sendJson(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Текст автора." }] }],
      },
    });
    const before = db
      .prepare("SELECT current_version_id FROM chapters WHERE id = ?")
      .get(ch.id) as { current_version_id: number | null };

    setOutline(planWith([{ title: "Совсем другое название" }]));
    approvePlan(db, bookId);

    const after = db
      .prepare("SELECT title, current_version_id FROM chapters WHERE id = ?")
      .get(ch.id) as { title: string; current_version_id: number | null };
    expect(after.current_version_id).toBe(before.current_version_id);
    expect(after.title).toBe("Написанная");
  });

  it("больше глав, чем строк плана — лишние остаются нетронутыми", async () => {
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Первая" });
    await sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Вторая" });
    setOutline(planWith([{ title: "Порог", pov: "Рин" }]));

    const out = approvePlan(db, bookId);
    expect(out).toEqual({ created: 0, updated: 1 });
    const rows = chapterRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.intent).toBeNull();
  });

  it("без выбранного варианта — отказ с причиной", () => {
    setOutline({ ...planWith([{ title: "Порог" }]), selectedIndex: null });
    expect(() => approvePlan(db, bookId)).toThrow(PlanApproveError);
    try {
      approvePlan(db, bookId);
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_selection");
    }
  });

  it("выбранный вариант без поглавных строк — отказ с причиной", () => {
    setOutline({
      variants: [{ label: "только синопсис", estimatedChapters: 10 }],
      selectedIndex: 0,
      generatedAt: "2026-09-06T10:00:00.000Z",
    });
    try {
      approvePlan(db, bookId);
      throw new Error("должно было бросить");
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_chapters");
    }
  });

  it("книга без плана вовсе — отказ с причиной", () => {
    try {
      approvePlan(db, bookId);
      throw new Error("должно было бросить");
    } catch (e) {
      expect((e as PlanApproveError).reason).toBe("no_outline");
    }
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/plan-approve.test.ts`
Ожидаемо: FAIL, `Failed to resolve import "../plan-approve.js"`.

- [ ] **Step 3: Написать реализацию**

Создать `apps/server/src/utils/plan-approve.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookOutlineSchema,
  renderOutlineChapterIntent,
  type OutlineChapter,
} from "@book-forge/shared";

export type PlanApproveReason = "no_outline" | "no_selection" | "no_chapters";

export class PlanApproveError extends Error {
  constructor(
    public readonly reason: PlanApproveReason,
    message: string,
  ) {
    super(message);
    this.name = "PlanApproveError";
  }
}

export interface ApprovePlanResult {
  created: number;
  updated: number;
}

/** Превращает выбранный вариант плана в главы.
 *
 *  Сопоставление — строго по порядку: первая строка плана к первой главе,
 *  вторая ко второй. Совпадать по названию было бы соблазнительно и неверно:
 *  автор переименовывает главы, а план — нет, и одно переименование рассыпало
 *  бы всё сопоставление.
 *
 *  Что не делается никогда: не меняется название существующей главы (её назвал
 *  автор), не трогается текст, не удаляются главы, которых в плане больше нет.
 *  Утверждение плана — это про намерения, а не про уборку. */
export function approvePlan(
  sqlite: DatabaseType,
  bookId: number,
): ApprovePlanResult {
  const row = sqlite
    .prepare("SELECT outline_json FROM books WHERE id = ?")
    .get(bookId) as { outline_json: string | null } | undefined;
  if (!row?.outline_json) {
    throw new PlanApproveError("no_outline", "у книги ещё нет плана");
  }
  const parsed = bookOutlineSchema.safeParse(JSON.parse(row.outline_json));
  if (!parsed.success) {
    throw new PlanApproveError("no_outline", "план не читается");
  }
  const outline = parsed.data;
  if (outline.selectedIndex === null) {
    throw new PlanApproveError("no_selection", "вариант плана не выбран");
  }
  const variant = outline.variants[outline.selectedIndex];
  if (!variant) {
    throw new PlanApproveError("no_selection", "выбранного варианта нет в плане");
  }
  const rows: OutlineChapter[] = variant.chapters ?? [];
  if (rows.length === 0) {
    throw new PlanApproveError(
      "no_chapters",
      "в выбранном варианте нет поглавного плана",
    );
  }

  const tx = sqlite.transaction((): ApprovePlanResult => {
    const existing = sqlite
      .prepare(
        "SELECT id, order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
      )
      .all(bookId) as Array<{ id: number; order_index: number }>;

    const now = new Date().toISOString();
    const updateIntent = sqlite.prepare(
      "UPDATE chapters SET intent = ?, updated_at = ? WHERE id = ?",
    );
    const insertChapter = sqlite.prepare(
      `INSERT INTO chapters (book_id, order_index, title, intent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    );

    // Продолжаем ту же разрежённую нумерацию, что и остальные пути создания
    // глав: следующий индекс — максимум плюс десять.
    const max = sqlite
      .prepare("SELECT MAX(order_index) as m FROM chapters WHERE book_id = ?")
      .get(bookId) as { m: number | null };
    let nextOrder = (max.m ?? 0) + 10;

    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const planRow = rows[i]!;
      const intent = renderOutlineChapterIntent(planRow);
      const match = existing[i];
      if (match) {
        updateIntent.run(intent, now, match.id);
        updated++;
      } else {
        insertChapter.run(bookId, nextOrder, planRow.title, intent, now, now);
        nextOrder += 10;
        created++;
      }
    }
    sqlite.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(now, bookId);
    return { created, updated };
  });
  return tx.immediate();
}
```

- [ ] **Step 4: Добавить маршрут**

В `apps/server/src/routes/plot.ts` после обработчика `outline/select` (строка 206) добавить:

```ts
  r.post("/books/:id/plan/approve", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    try {
      const result = approvePlan(sqlite, id);
      const chapters = sqlite
        .prepare(
          "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
        )
        .all(id) as ChapterRow[];
      return c.json({ ...result, chapters: chapters.map(toChapter) });
    } catch (e) {
      if (e instanceof PlanApproveError) {
        return c.json(
          { error: "plan_not_approvable", details: { reason: e.reason, message: e.message } },
          400,
        );
      }
      throw e;
    }
  });
```

и импорт:

```ts
import { approvePlan, PlanApproveError } from "../utils/plan-approve.js";
```

- [ ] **Step 5: Дописать тест маршрута**

Дописать в `apps/server/src/routes/__tests__/plot.test.ts` два случая: успешное утверждение возвращает `created`, `updated` и список глав; книга без плана отвечает 400 с `details.reason === "no_outline"`.

- [ ] **Step 6: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/plan-approve.test.ts`
Ожидаемо: PASS, 8 тестов.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 7: Коммит**

```bash
git add apps/server/src/utils/plan-approve.ts apps/server/src/utils/__tests__/plan-approve.test.ts apps/server/src/routes/plot.ts apps/server/src/routes/__tests__/plot.test.ts
git commit -m "feat(plan): approving a plan creates chapters carrying their intent

Matching is by order, not by title: the author renames chapters and the plan
does not, and one rename would scatter the whole matching. An existing
chapter keeps its name and its text and gains an intent; a row with no chapter
yet creates one. Nothing is ever deleted — approving a plan is about intent,
not tidying up."
```

---

### Task 6: Экран «План»

Этап `plot` перестаёт быть markdown-аспектами и получает свой экран. Прежние аспекты никуда не деваются: они показываются здесь же, отдельным блоком, как заметки автора.

**Files:**
- Create: `apps/web/src/pages/PlanStagePage.tsx`
- Create: `apps/web/src/pages/__tests__/PlanStagePage.test.tsx`
- Modify: `apps/web/src/App.tsx:47-53`
- Modify: `apps/web/src/pages/MarkdownStagePage.tsx:33-43`
- Modify: `apps/web/src/api/client.ts`

**Interfaces:**
- Consumes: `POST /api/books/:id/plan/approve` (задача 5), `bookOutlineSchema` с поглавными строками (задача 1).
- Produces:
  - `api.approvePlan(bookId)` → `{ created: number; updated: number; chapters: Chapter[] }`
  - `<PlanStagePage />` по маршруту `/books/:bookId/studio/plot`

- [ ] **Step 1: Написать падающий тест**

Создать `apps/web/src/pages/__tests__/PlanStagePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlanStagePage } from "../PlanStagePage";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
    generateBookOutline: vi.fn(),
    selectBookOutline: vi.fn(),
    approvePlan: vi.fn(),
  },
}));

import { api } from "@/api/client";

const BOOK = {
  id: 3,
  title: "Инженеры тишины",
  language: "ru",
  premise: "p",
  outlineJson: JSON.stringify({
    variants: [
      {
        label: "из ваших материалов: Оглавление",
        estimatedChapters: 2,
        source: "author_material",
        chapters: [
          { title: "Порог", pov: "Рин", goal: "Уйти незамеченной" },
          { title: "Мост" },
        ],
      },
      { label: "сгенерированный", logline: "Логлайн", estimatedChapters: 12 },
    ],
    selectedIndex: 0,
    generatedAt: "2026-09-06T10:00:00.000Z",
  }),
  styleProfileId: null,
  status: "draft",
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

const STUDIO_WITH_NOTE = {
  schemaVersion: 1 as const,
  revision: 4,
  stages: {
    plot: {
      status: "in_progress" as const,
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "Мысли о структуре",
          status: "reviewing" as const,
          order: 0,
          required: false,
          source: "import" as const,
          payloadKind: "markdown" as const,
          variants: [
            {
              id: "v1",
              label: "из ваших материалов",
              payloadKind: "markdown" as const,
              payload: "Хочу три части.",
              status: "generated" as const,
              editSource: "manual" as const,
              generatedAt: "2026-09-06T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/plot"]}>
      <Routes>
        <Route path="/books/:bookId/studio/:stageId" element={<PlanStagePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getBook).mockResolvedValue(BOOK as never);
  vi.mocked(api.getConcept).mockResolvedValue({ schemaVersion: 1, pitches: [] } as never);
  vi.mocked(api.getStudioState).mockResolvedValue(STUDIO_WITH_NOTE as never);
  vi.mocked(api.approvePlan).mockResolvedValue({ created: 2, updated: 0, chapters: [] } as never);
});

describe("PlanStagePage", () => {
  it("показывает поглавные строки выбранного варианта", async () => {
    renderPage();
    expect(await screen.findByText("Порог")).toBeInTheDocument();
    expect(screen.getByText(/Рин/)).toBeInTheDocument();
    expect(screen.getByText("Мост")).toBeInTheDocument();
  });

  it("помечает вариант, пришедший из материалов автора", async () => {
    renderPage();
    expect(await screen.findByText(/из ваших материалов/i)).toBeInTheDocument();
  });

  it("показывает заметки, приземлённые интейком на этап сюжета", async () => {
    renderPage();
    expect(await screen.findByText("Мысли о структуре")).toBeInTheDocument();
    expect(screen.getByText(/Хочу три части/)).toBeInTheDocument();
  });

  it("утверждает план и сообщает, сколько глав создано", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Утвердить план" }));
    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/создано глав: 2/i)).toBeInTheDocument();
  });

  it("без поглавных строк кнопка утверждения недоступна и сказано почему", async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...BOOK,
      outlineJson: JSON.stringify({
        variants: [{ label: "только синопсис", estimatedChapters: 10 }],
        selectedIndex: 0,
        generatedAt: "2026-09-06T10:00:00.000Z",
      }),
    } as never);
    renderPage();
    expect(await screen.findByRole("button", { name: "Утвердить план" })).toBeDisabled();
    expect(screen.getByText(/нет поглавных строк/i)).toBeInTheDocument();
  });

  it("без выбранного варианта утверждать нечего", async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...BOOK,
      outlineJson: JSON.stringify({
        variants: [{ label: "в", estimatedChapters: 2, chapters: [{ title: "Порог" }] }],
        selectedIndex: null,
        generatedAt: "2026-09-06T10:00:00.000Z",
      }),
    } as never);
    renderPage();
    expect(await screen.findByRole("button", { name: "Утвердить план" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/web test -- src/pages/__tests__/PlanStagePage.test.tsx`
Ожидаемо: FAIL, `Failed to resolve import "../PlanStagePage"`.

- [ ] **Step 3: Добавить функцию клиента**

В `apps/web/src/api/client.ts` рядом с `selectBookOutline` дописать:

```ts
  approvePlan: (bookId: number) =>
    req<{ created: number; updated: number; chapters: Chapter[] }>(
      `/api/books/${bookId}/plan/approve`,
      { method: "POST", body: JSON.stringify({}) },
    ),
```

- [ ] **Step 4: Написать экран**

Создать `apps/web/src/pages/PlanStagePage.tsx`. Структуру страницы (шапка, `StageStepper`, ссылка «К Studio», карточки) копировать с `MarkdownStagePage` — это её сосед по маршруту, и расхождение в раскладке будет заметно автору:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { StageStepper } from "@/components/studio/StageStepper";
import { toast } from "@/lib/toast";
import type {
  Book,
  BookConcept,
  BookOutline,
  BookOutlineVariant,
  StudioState,
} from "@book-forge/shared";

function parseOutline(json: string | null): BookOutline | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BookOutline;
  } catch {
    return null;
  }
}

/** Заметки, приземлённые приёмом материала на этап сюжета до появления этого
 *  экрана. Аспектами они и остаются — просто показываются здесь, а не на
 *  markdown-странице, которой у этапа больше нет. */
function planNotes(studio: StudioState | null): Array<{ id: string; name: string; text: string }> {
  const stage = studio?.stages["plot"];
  if (!stage) return [];
  return stage.aspects.flatMap((a) => {
    const variant = a.variants[0];
    const text = typeof variant?.payload === "string" ? variant.payload : "";
    if (text.length === 0) return [];
    return [{ id: a.id, name: a.name, text }];
  });
}

export function PlanStagePage() {
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const bookId = Number(rawBookId);

  const [book, setBook] = useState<Book | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState<{ created: number; updated: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, c, s] = await Promise.all([
        api.getBook(bookId),
        api.getConcept(bookId),
        api.getStudioState(bookId),
      ]);
      setBook(b);
      setConcept(c);
      setStudio(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bookId]);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    void load();
  }, [bookId, load]);

  const outline = parseOutline(book?.outlineJson ?? null);
  const selected =
    outline && outline.selectedIndex !== null
      ? outline.variants[outline.selectedIndex]
      : undefined;
  const rows = selected?.chapters ?? [];
  const canApprove = rows.length > 0 && !approving;

  async function onGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateBookOutline(bookId, { variants: 2 });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes("premise required")
          ? "Сначала утвердите замысел книги в Мастерской."
          : message,
      );
    } finally {
      setGenerating(false);
    }
  }

  async function onSelect(idx: number) {
    setSelecting(idx);
    setError(null);
    try {
      await api.selectBookOutline(bookId, idx);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  }

  async function onApprove() {
    setApproving(true);
    setError(null);
    try {
      const result = await api.approvePlan(bookId);
      setApproved({ created: result.created, updated: result.updated });
      toast.success("План утверждён");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  if (error && !book) {
    return (
      <div className="route">
        <div className="page">
          <p role="alert" className="card" style={{ borderLeft: "3px solid var(--color-ink-red)" }}>
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  }
  if (!book || !concept || !studio) {
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );
  }

  const notes = planNotes(studio);

  return (
    <div className="route" data-screen-label="stage-plot">
      <div className="page page-stage">
        <StageStepper bookId={bookId} concept={concept} studioState={studio} activeStageId="plot" />

        <div className="page-head">
          <div>
            <h1>План</h1>
            <p className="muted page-sub">
              Поглавный костяк книги. «Утвердить план» создаёт главы с намерениями.
            </p>
          </div>
          <Link to={`/books/${bookId}/studio`} className="btn btn-ghost btn-sm">
            ← К Studio
          </Link>
        </div>

        {error && <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>Ошибка: {error}</p>}

        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div className="panel-head">
            <h3>Варианты плана</h3>
            <Button onClick={() => void onGenerate()} disabled={generating}>
              {generating ? "Генерация…" : "Сгенерировать варианты"}
            </Button>
          </div>

          {!outline && (
            <p className="muted" style={{ fontSize: 13 }}>
              Плана ещё нет. Сгенерируйте варианты или перетащите своё оглавление в
              Мастерской — оно станет вариантом плана.
            </p>
          )}

          {outline?.variants.map((v, i) => (
            <VariantCard
              key={i}
              variant={v}
              isSelected={outline.selectedIndex === i}
              busy={selecting === i}
              onSelect={() => void onSelect(i)}
            />
          ))}
        </div>

        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div className="panel-head">
            <h3>Главы по плану</h3>
            <Button onClick={() => void onApprove()} disabled={!canApprove}>
              {approving ? "Утверждаю…" : "Утвердить план"}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              У выбранного варианта нет поглавных строк — утверждать нечего. Такой
              вариант описывает книгу целиком; поглавный список приходит из ваших
              материалов или дописывается руками.
            </p>
          ) : (
            <ol style={{ display: "grid", gap: 6, paddingLeft: 20 }}>
              {rows.map((ch, i) => (
                <li key={i}>
                  <strong>{ch.title}</strong>
                  {(ch.pov || ch.goal || ch.conflict || ch.stakes || ch.hook) && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {[
                        ch.pov && `POV: ${ch.pov}`,
                        ch.goal && `Цель: ${ch.goal}`,
                        ch.conflict && `Конфликт: ${ch.conflict}`,
                        ch.stakes && `Ставки: ${ch.stakes}`,
                        ch.hook && `Крючок: ${ch.hook}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {approved && (
            <p className="text-sm">
              Создано глав: {approved.created}. Обновлено намерений: {approved.updated}.
            </p>
          )}
        </div>

        {notes.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div className="panel-head">
              <h3>Заметки из ваших материалов</h3>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Текст о сюжете, в котором не было поглавного списка. Он не стал планом,
              но и не потерялся.
            </p>
            {notes.map((n) => (
              <details key={n.id}>
                <summary>{n.name}</summary>
                <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{n.text}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  isSelected,
  busy,
  onSelect,
}: {
  variant: BookOutlineVariant;
  isSelected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        borderColor: isSelected ? "var(--color-ring)" : undefined,
        display: "grid",
        gap: 6,
      }}
    >
      <div className="panel-head">
        <h4>{variant.label}</h4>
        {variant.source === "author_material" && (
          <span className="cap mono faint">из ваших материалов</span>
        )}
      </div>
      {variant.logline && (
        <p className="text-sm">
          <strong>Логлайн:</strong> {variant.logline}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Глав: {variant.estimatedChapters}
        {variant.chapters ? ` · поглавных строк: ${variant.chapters.length}` : " · поглавных строк нет"}
      </p>
      <Button
        onClick={onSelect}
        disabled={busy || isSelected}
        variant={isSelected ? "secondary" : "default"}
        className="self-start"
      >
        {isSelected ? "Выбран" : busy ? "…" : "Выбрать этот вариант"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Развести маршрут и убрать plot из markdown-этапов**

В `apps/web/src/App.tsx` в `StagePageDispatch`:

```tsx
function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  // Этап сюжета сохранил идентификатор, но перестал быть markdown-аспектами:
  // его экран — план книги.
  if (stageId === "plot") {
    return <PlanStagePage />;
  }
  return <MarkdownStagePage />;
}
```

с импортом `PlanStagePage`.

В `apps/web/src/pages/MarkdownStagePage.tsx` убрать `plot` из `MARKDOWN_STAGES` (строка 39), из `STAGE_HINTS` (строка 33-37) и сузить тип с `"world" | "lore" | "plot"` до `"world" | "lore"` в трёх местах (строки 33, 41, 55). `STAGE_LABELS` оставить как есть — он покрывает все этапы.

- [ ] **Step 6: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/web test -- src/pages/__tests__/PlanStagePage.test.tsx`
Ожидаемо: PASS, 6 тестов.

Выполнить: `pnpm --filter @book-forge/web test`
Ожидаемо: PASS. Тест `apps/web/src/lib/studio-routes.test.ts` проверяет маршрут `plot` — он не меняется, путь тот же.

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 7: Коммит**

```bash
git add apps/web/src/pages/PlanStagePage.tsx apps/web/src/pages/__tests__/PlanStagePage.test.tsx apps/web/src/App.tsx apps/web/src/pages/MarkdownStagePage.tsx apps/web/src/api/client.ts
git commit -m "feat(web): the plot stage becomes the plan screen

The stage keeps its id — studioStateSchema validates stored stage keys against
STAGE_IDS, and every book the intake has touched would stop parsing the moment
plot left the list. What it loses is its markdown nature. The aspects already
landed there are shown on the same screen as the author's own notes, so the
material that arrived before this phase is visible rather than orphaned."
```

---

### Task 7: Одна дверь в план и намерение без ручного ввода

Панель outline уходит со страницы «Главы» — у плана теперь свой экран. `PlanPanel` перестаёт спрашивать намерение: оно приходит из главы, куда его положило утверждение плана.

**Files:**
- Modify: `apps/web/src/pages/ChaptersStagePage.tsx:21,170-173`
- Modify: `apps/web/src/components/PlanPanel.tsx:26-107`
- Modify: `apps/web/src/components/__tests__/PlanPanel.test.tsx`
- Modify: `apps/web/src/pages/ChaptersStagePage.test.tsx`

**Interfaces:**
- Consumes: намерение в `chapter.intent`, проставленное `approvePlan` (задача 5).
- Produces: `PlanPanel` без поля ввода; при пустом намерении — ссылка на `/books/:bookId/studio/plot`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `apps/web/src/components/__tests__/PlanPanel.test.tsx`:

```tsx
describe("PlanPanel — намерение приходит из плана", () => {
  it("показывает намерение главы и не даёт поля ввода", () => {
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: "Порог\nPOV: Рин", planJson: null })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/POV: Рин/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("без намерения отправляет автора на экран плана, а не просит печатать", () => {
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: null, planJson: null, bookId: 7 })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /план/i });
    expect(link).toHaveAttribute("href", "/books/7/studio/plot");
    expect(screen.getByRole("button", { name: /Сгенерировать план/ })).toBeDisabled();
  });

  it("генерация плана передаёт намерение главы", async () => {
    vi.mocked(api.generateChapterPlan).mockResolvedValue({
      variants: [],
      selectedIndex: null,
      generatedAt: "2026-09-06T00:00:00.000Z",
    } as never);
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: "Порог", planJson: null })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Сгенерировать план/ }));
    expect(api.generateChapterPlan).toHaveBeenCalledWith(expect.any(Number), "Порог", {
      variants: 2,
    });
  });
});
```

Хелпер `makeChapter` в этом файле уже есть — дополнить его полями `intent` и `bookId`, если их там нет.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/__tests__/PlanPanel.test.tsx`
Ожидаемо: FAIL — в панели есть `textbox`.

- [ ] **Step 3: Переписать верх PlanPanel**

В `apps/web/src/components/PlanPanel.tsx` убрать состояние `intent` (строка 29) и заменить блок ввода (строки 82-88) на показ намерения:

```tsx
  const intent = (chapter.intent ?? "").trim();
```

```tsx
      {intent.length > 0 ? (
        <div>
          <div className="caption">Намерение главы (из плана книги)</div>
          <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{intent}</p>
        </div>
      ) : (
        <p className="text-sm">
          У главы нет намерения. Оно приходит из плана книги — откройте{" "}
          <Link to={`/books/${chapter.bookId}/studio/plot`}>план</Link> и утвердите его.
        </p>
      )}
```

В `onGenerate` (строки 44-49) заменить проверку и вызов:

```ts
  async function onGenerate() {
    setError(null);
    if (intent.length === 0) {
      setError("У главы нет намерения — утвердите план книги.");
      return;
    }
    setGenerating(true);
    try {
      const result = await api.generateChapterPlan(chapter.id, intent, { variants });
```

Кнопку генерации сделать `disabled={generating || intent.length === 0}`. Добавить импорт `Link` из `react-router-dom`.

- [ ] **Step 4: Убрать OutlinePanel со страницы «Главы»**

В `apps/web/src/pages/ChaptersStagePage.tsx` удалить импорт `OutlinePanel` (строка 21) и блок с ним (строки 170-173), а на его место поставить ссылку на экран плана:

```tsx
          {/* Plan */}
          <div className="card">
            <div className="panel-head">
              <h3>План книги</h3>
              <Link to={`/books/${id}/studio/plot`} className="btn btn-ghost btn-sm">
                Открыть план →
              </Link>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Поглавный костяк и создание глав переехали на отдельный экран.
            </p>
          </div>
```

В `apps/web/src/pages/ChaptersStagePage.test.tsx` убрать мок `OutlinePanel` (строка 20) — он больше не импортируется.

- [ ] **Step 5: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/__tests__/PlanPanel.test.tsx`
Ожидаемо: PASS, 3 новых теста.

Выполнить: `pnpm --filter @book-forge/web test`
Ожидаемо: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/web/src/pages/ChaptersStagePage.tsx apps/web/src/pages/ChaptersStagePage.test.tsx apps/web/src/components/PlanPanel.tsx apps/web/src/components/__tests__/PlanPanel.test.tsx
git commit -m "feat(web): one door into the plan, and an intent nobody retypes

The outline panel lived on the chapters page while the plot tile opened
markdown aspects — the pipeline was split in two, and this is the seam
closing. The chapter's intent now comes from the approved plan; a chapter
without one gets a link to the plan screen instead of an empty textarea."
```

---

### Task 8: Готовность этапа плана

`isStageDone` знает про `concept` и `chapters` и ничего не знает про план: этап `plot` считается пройденным, только когда явно помечен `complete` или `skipped`. С этой задачи он пройден, когда план утверждён.

**Files:**
- Modify: `packages/shared/src/studio-warnings.ts:127-219`
- Modify: `packages/shared/src/studio-warnings.test.ts`
- Modify: `apps/web/src/components/studio/StageStepper.tsx`, `apps/web/src/pages/StudioPage.tsx` (передать признак)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `PlanProgress = { approved: boolean }`
  - `computeStudioProgress(concept, studioState, chapters?, plan?)` и `computeRecommendedNextStage({..., plan?})` принимают его; отсутствие признака сохраняет прежнее поведение.

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/shared/src/studio-warnings.test.ts`:

```ts
describe("готовность этапа плана", () => {
  const concept = conceptFixture(); // хелпер файла: утверждённый замысел
  const emptyState = { schemaVersion: 1 as const, revision: 0, stages: {} };

  it("план не утверждён — этап не пройден", () => {
    const progress = computeStudioProgress(concept, emptyState, undefined, {
      approved: false,
    });
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(false);
  });

  it("план утверждён — этап пройден, даже если аспектов на нём нет", () => {
    const progress = computeStudioProgress(concept, emptyState, undefined, {
      approved: true,
    });
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(true);
  });

  it("без признака плана поведение прежнее: этап не пройден", () => {
    const progress = computeStudioProgress(concept, emptyState);
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(false);
  });

  it("утверждённый план сдвигает рекомендацию на главы", () => {
    const done = {
      schemaVersion: 1 as const,
      revision: 0,
      stages: {
        world: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
        lore: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
        characters: { status: "complete" as const, playbookGenerated: true, aspects: [] },
        items: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
      },
    };
    expect(
      computeRecommendedNextStage({ concept, studioState: done, plan: { approved: true } }),
    ).toBe("chapters");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/shared test -- src/studio-warnings.test.ts`
Ожидаемо: FAIL — четвёртый аргумент не принимается, этап `plot` не пройден никогда.

- [ ] **Step 3: Написать реализацию**

В `packages/shared/src/studio-warnings.ts` добавить тип рядом с `ChapterProgress`:

```ts
/** У этапа плана, как и у глав, нет аспектов: его правда живёт в
 *  `books.outline_json`. Признак приходит снаружи — общий пакет книгу не
 *  читает. */
export interface PlanProgress {
  /** Выбран вариант плана и по нему созданы главы. */
  approved: boolean;
}
```

в `isStageDone` добавить случай перед `return false`:

```ts
  if (id === "plot") return plan?.approved === true;
```

и провести `plan?: PlanProgress` через сигнатуры `isStageDone`, `RecommendedNextInput`, `computeRecommendedNextStage` и `computeStudioProgress` — параметр необязательный, чтобы вызовы без него сохраняли прежнее поведение.

- [ ] **Step 4: Передать признак из интерфейса**

Признак вычисляется одинаково в двух местах, поэтому вынести его в `packages/shared/src/plot.ts` рядом с остальным про план:

```ts
/** План утверждён, если вариант выбран и в нём есть поглавные строки. Само
 *  наличие глав в книге признаком не служит: главы бывают заведены руками. */
export function isPlanApproved(outlineJson: string | null | undefined): boolean {
  if (!outlineJson) return false;
  try {
    const parsed = bookOutlineSchema.safeParse(JSON.parse(outlineJson));
    if (!parsed.success || parsed.data.selectedIndex === null) return false;
    const variant = parsed.data.variants[parsed.data.selectedIndex];
    return (variant?.chapters?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
```

и вызывать её в `StudioPage` и `StageStepper` там, где они уже считают прогресс, передавая `{ approved: isPlanApproved(book.outlineJson) }`. Если у `StageStepper` книги нет в пропсах, добавить необязательный проп `planApproved?: boolean` и передать его со страниц, которые книгу держат; страницы без книги оставляют его пустым и получают прежнее поведение.

- [ ] **Step 5: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/shared test -- src/studio-warnings.test.ts`
Ожидаемо: PASS, 4 новых теста.

Выполнить: `pnpm typecheck && pnpm --filter @book-forge/shared test && pnpm --filter @book-forge/web test`
Ожидаемо: PASS.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/studio-warnings.ts packages/shared/src/studio-warnings.test.ts packages/shared/src/plot.ts apps/web/src/components/studio/StageStepper.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(studio): the plot stage is done when the plan is approved

Its truth lives in books.outline_json, not in aspects, so the flag comes from
outside — the shared package does not read the book. Callers that pass nothing
keep the old behaviour."
```

---

### Task 9: Раннер быстрого сбора

Одна кнопка готовит черновики мира, лора, персонажей, предметов и плана. Ничего не утверждает и глав не создаёт: это делает автор.

**Files:**
- Create: `apps/server/src/utils/quick-start-cancel.ts`
- Create: `apps/server/src/utils/quick-start-run.ts`
- Create: `apps/server/src/utils/__tests__/quick-start-run.test.ts`

**Interfaces:**
- Consumes: `mergeAspectsIntoStage` и построители аспектов из `@book-forge/shared`; агентные вызовы — те же, что уже делают обработчики Мастерской.
- Produces:
  - `createQuickStartCancelRegistry(): QuickStartCancelRegistry` с `begin(bookId)`, `requestStop(bookId): boolean`, `shouldStop(bookId): boolean`, `end(bookId)`, `size()`
  - `QUICK_START_STAGES: readonly ["world","lore","characters","items","plot"]`
  - `runQuickStart(deps, input): Promise<QuickStartResult>` где `input = { onStage?, shouldStop? }`
  - `QuickStartStageEvent = { index: number; total: number; stageId: StageId; status: "started" | "done" | "skipped" | "failed"; message?: string }`
  - `QuickStartResult = { stages: QuickStartStageEvent[]; cancelled: boolean; revision: number }`

- [ ] **Step 0: Прочитать, как это делают действующие обработчики**

Перед кодом прочитать в `apps/server/src/routes/studio.ts` обработчики `POST /books/:id/stages/:stageId/playbook` и следующий за ним обработчик генерации вариантов аспекта, а также ветку сущностей. Раннер должен звать **те же функции агентов с теми же аргументами** — не свою копию логики. Выписать в отчёт, какие именно функции вызываются для markdown-этапа, для этапа сущностей и для плана.

Это единственный шаг плана, где код не приведён дословно: имена агентных функций и форма их входа живут в тех обработчиках, и копия из плана разошлась бы с ними при первом же изменении. Всё остальное ниже — дословно.

- [ ] **Step 1: Написать падающий тест реестра и раннера**

Создать `apps/server/src/utils/__tests__/quick-start-run.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runBookPlanning: vi.fn(),
}));

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { createQuickStartCancelRegistry } from "../quick-start-cancel.js";
import { QUICK_START_STAGES, runQuickStart } from "../quick-start-run.js";
import { createStudioRepository } from "../../db/studio.js";

let t: TestApp;
let db: DatabaseType;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Быстрый сбор",
    premise: "p",
  });
  bookId = b.id;
  db = new Database(`${t.dbDir}/test.sqlite`);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("createQuickStartCancelRegistry", () => {
  it("незарегистрированный прогон остановить нельзя", () => {
    const reg = createQuickStartCancelRegistry();
    expect(reg.requestStop(1)).toBe(false);
  });

  it("зарегистрированный помечается на остановку", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.requestStop(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(true);
  });

  it("остановка одной книги не задевает другую", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    reg.begin(2);
    reg.requestStop(1);
    expect(reg.shouldStop(2)).toBe(false);
  });

  it("завершённый прогон исчезает из реестра", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    reg.end(1);
    expect(reg.size()).toBe(0);
    expect(reg.requestStop(1)).toBe(false);
  });
});

describe("runQuickStart", () => {
  it("сообщает о каждом этапе по порядку", async () => {
    const seen: string[] = [];
    const result = await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      { onStage: (e) => seen.push(`${e.stageId}:${e.status}`) },
    );
    expect(result.stages.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.endsWith(":started")).map((s) => s.split(":")[0])).toEqual([
      ...QUICK_START_STAGES,
    ]);
  });

  it("ничего не утверждает: аспекты приходят на рассмотрение", async () => {
    await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {},
    );
    const row = db
      .prepare("SELECT studio_state FROM books WHERE id = ?")
      .get(bookId) as { studio_state: string | null };
    const state = JSON.parse(row.studio_state ?? "{}") as {
      stages?: Record<string, { aspects?: Array<{ status: string }> }>;
    };
    for (const stage of Object.values(state.stages ?? {})) {
      for (const aspect of stage.aspects ?? []) {
        expect(aspect.status).not.toBe("accepted");
      }
    }
  });

  it("глав не создаёт", async () => {
    await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {},
    );
    const count = db
      .prepare("SELECT COUNT(*) c FROM chapters WHERE book_id = ?")
      .get(bookId) as { c: number };
    expect(count.c).toBe(0);
  });

  it("остановка прекращает прогон между этапами", async () => {
    let calls = 0;
    const result = await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {
        shouldStop: () => {
          calls++;
          return calls > 1;
        },
      },
    );
    expect(result.cancelled).toBe(true);
    expect(result.stages.filter((s) => s.status === "started").length).toBeLessThan(
      QUICK_START_STAGES.length,
    );
  });

  it("падение одного этапа не уносит остальные", async () => {
    const { runBookPlanning } = await import("@book-forge/agents");
    vi.mocked(runBookPlanning).mockRejectedValue(new Error("бэкенд недоступен"));
    const result = await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {},
    );
    const failed = result.stages.filter((s) => s.status === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.message).toContain("бэкенд недоступен");
    // Прогон дошёл до конца списка, а не оборвался на первом отказе.
    expect(result.cancelled).toBe(false);
  });

  it("этап, на котором уже что-то лежит, пропускается", async () => {
    // Первый прогон наполняет этапы, второй должен их не трогать.
    await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {},
    );
    const second = await runQuickStart(
      { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId },
      {},
    );
    expect(second.stages.some((s) => s.status === "skipped")).toBe(true);
  });
});
```

Тесты идут без ключа к API: агенты падают на старте, и это ровно тот путь, который проверяют случаи «падение не уносит остальные» и «ничего не утверждается». Случай с успешной генерацией на моках добавить, если после чтения обработчиков в шаге 0 окажется, что мокировать нужно больше одной функции — тогда мокировать их все и проверить, что аспект пришёл в `reviewing`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/quick-start-run.test.ts`
Ожидаемо: FAIL, `Failed to resolve import "../quick-start-cancel.js"`.

- [ ] **Step 3: Написать реестр отмены**

Создать `apps/server/src/utils/quick-start-cancel.ts`:

```ts
/** Кто сейчас собирает черновики и кого попросили остановиться.
 *
 *  В памяти процесса, а не в БД: сбор живёт внутри одного запроса, и после
 *  перезапуска останавливать уже нечего. Ключ — книга: два одновременных
 *  сбора одной книги смысла не имеют, а разные книги друг другу не мешают. */
export interface QuickStartCancelRegistry {
  begin: (bookId: number) => void;
  /** true, если такой сбор идёт и его пометили на остановку. */
  requestStop: (bookId: number) => boolean;
  shouldStop: (bookId: number) => boolean;
  end: (bookId: number) => void;
  size: () => number;
}

export function createQuickStartCancelRegistry(): QuickStartCancelRegistry {
  const stopping = new Map<number, boolean>();
  return {
    begin: (bookId) => {
      stopping.set(bookId, false);
    },
    requestStop: (bookId) => {
      if (!stopping.has(bookId)) return false;
      stopping.set(bookId, true);
      return true;
    },
    shouldStop: (bookId) => stopping.get(bookId) === true,
    end: (bookId) => {
      stopping.delete(bookId);
    },
    size: () => stopping.size,
  };
}
```

- [ ] **Step 4: Написать раннер**

Создать `apps/server/src/utils/quick-start-run.ts` со следующим скелетом; тела `generateStage` заполнить вызовами, выписанными на шаге 0:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import type { StageId, StudioState } from "@book-forge/shared";
import type { StudioRepository } from "../db/studio.js";

/** Порядок сбора — порядок этапов конвейера без замысла (его утверждает автор
 *  до всего) и без глав (они появляются из утверждённого плана). */
export const QUICK_START_STAGES = [
  "world",
  "lore",
  "characters",
  "items",
  "plot",
] as const satisfies readonly StageId[];

export interface QuickStartStageEvent {
  index: number;
  total: number;
  stageId: StageId;
  status: "started" | "done" | "skipped" | "failed";
  /** Причина отказа или пропуска. */
  message?: string;
}

export interface QuickStartResult {
  stages: QuickStartStageEvent[];
  cancelled: boolean;
  revision: number;
}

export interface QuickStartDeps {
  sqlite: DatabaseType;
  hasVec: boolean;
  repo: StudioRepository;
  bookId: number;
}

export interface QuickStartInput {
  onStage?: (e: QuickStartStageEvent) => void;
  shouldStop?: () => boolean;
}

/** Событие не должно ронять сбор: кривой потребитель — его беда, не наша. */
function emit(
  onStage: ((e: QuickStartStageEvent) => void) | undefined,
  e: QuickStartStageEvent,
): void {
  if (!onStage) return;
  try {
    onStage(e);
  } catch {
    /* consumer's problem, not ours */
  }
}

function log(message: string): void {
  console.warn(`[quick-start] ${message}`);
}

/** Готовит черновики всех подготовительных этапов подряд.
 *
 *  Ничего не утверждает: аспекты приходят `reviewing`, как из приёма
 *  материала, и глав не создаёт — их делает «Утвердить план», которое жмёт
 *  автор. Правило «без автора ничего не утверждается» держит и интейк, и
 *  предложения прозы; кнопка быстрого сбора его не отменяет.
 *
 *  Этап, на котором уже что-то лежит, пропускается: повторный сбор не должен
 *  удваивать черновики, а автор мог половину уже разобрать.
 *
 *  Отказ одного этапа не уносит остальные — как отказ одного файла в приёме
 *  материала. Останов проверяется между этапами: прервать идущий вызов агента
 *  нечем. */
export async function runQuickStart(
  deps: QuickStartDeps,
  input: QuickStartInput,
): Promise<QuickStartResult> {
  const { sqlite, repo, bookId } = deps;
  const { onStage, shouldStop } = input;
  const stages: QuickStartStageEvent[] = [];
  const total = QUICK_START_STAGES.length;
  let cancelled = false;

  for (let index = 0; index < total; index++) {
    const stageId = QUICK_START_STAGES[index]!;
    if (shouldStop?.()) {
      cancelled = true;
      log(`book ${bookId}: остановлен перед этапом ${stageId}`);
      break;
    }

    const started: QuickStartStageEvent = { index, total, stageId, status: "started" };
    stages.push(started);
    emit(onStage, started);

    const state: StudioState = repo.loadStudioState(bookId);
    const already = stageId === "plot" ? planAlreadyThere(sqlite, bookId) : (state.stages[stageId]?.aspects.length ?? 0) > 0;
    if (already) {
      const skipped: QuickStartStageEvent = {
        index,
        total,
        stageId,
        status: "skipped",
        message: "здесь уже есть черновики",
      };
      stages.push(skipped);
      emit(onStage, skipped);
      continue;
    }

    const startedAt = Date.now();
    try {
      await generateStage(deps, stageId);
      const done: QuickStartStageEvent = { index, total, stageId, status: "done" };
      stages.push(done);
      emit(onStage, done);
      log(`book ${bookId}: ${stageId} готов за ${Math.round((Date.now() - startedAt) / 1000)} с`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failed: QuickStartStageEvent = { index, total, stageId, status: "failed", message };
      stages.push(failed);
      emit(onStage, failed);
      log(`book ${bookId}: ${stageId} не собрался — ${message}`);
    }
  }

  const revision = repo.loadStudioState(bookId).revision;
  return { stages, cancelled, revision };
}

/** У плана нет аспектов: его наличие видно по колонке книги. */
function planAlreadyThere(sqlite: DatabaseType, bookId: number): boolean {
  const row = sqlite
    .prepare("SELECT outline_json FROM books WHERE id = ?")
    .get(bookId) as { outline_json: string | null } | undefined;
  return Boolean(row?.outline_json);
}

/** Один этап. Вызовы агентов здесь — те же, что делают обработчики Мастерской:
 *  playbook и варианты для markdown-этапов, варианты сущностей для персонажей
 *  и предметов, планирование книги для плана. Аспекты кладутся `reviewing`
 *  через mergeAspectsIntoStage — так же, как их кладёт приём материала. */
async function generateStage(deps: QuickStartDeps, stageId: StageId): Promise<void> {
  // Заполнить по результатам шага 0.
}
```

- [ ] **Step 5: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/quick-start-run.test.ts`
Ожидаемо: PASS, 11 тестов.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/server/src/utils/quick-start-cancel.ts apps/server/src/utils/quick-start-run.ts apps/server/src/utils/__tests__/quick-start-run.test.ts
git commit -m "feat(quick-start): one runner prepares every preparatory stage

Modelled on the material intake: a stage at a time, a stop checked between
stages because an agent call cannot be interrupted, one stage's failure not
carrying off the others, and a stage that already holds drafts left alone. It
approves nothing and creates no chapters — that is the author's click."
```

---

### Task 10: Маршруты и кнопка быстрого сбора

Раннер есть; не хватает того, чем его запускают и как автор видит ход дела.

**Files:**
- Modify: `apps/server/src/routes/studio.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/web/src/components/studio/QuickStartPanel.tsx`
- Create: `apps/web/src/components/studio/__tests__/QuickStartPanel.test.tsx`
- Modify: `apps/web/src/pages/StudioPage.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/server/src/routes/__tests__/studio.test.ts`

**Interfaces:**
- Consumes: `runQuickStart`, `QUICK_START_STAGES`, `createQuickStartCancelRegistry` (задача 9).
- Produces:
  - `POST /api/books/:id/quick-start` — SSE: `begin`, `stage` на каждое событие, `done` или `error`, `ping` раз в 20 с
  - `POST /api/books/:id/quick-start/cancel` — `{ stopping: true }` или 404
  - `GET /api/books/:id/quick-start/inflight` — снимок или 404 «ничего не идёт»
  - `streamQuickStart(bookId, handlers)`, `api.cancelQuickStart(bookId)`, `api.getQuickStartInflight(bookId)`
  - `<QuickStartPanel bookId onFinished />`

- [ ] **Step 1: Написать падающий тест панели**

Создать `apps/web/src/components/studio/__tests__/QuickStartPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickStartPanel } from "../QuickStartPanel";

vi.mock("@/api/client", () => ({
  api: { cancelQuickStart: vi.fn(), getQuickStartInflight: vi.fn() },
  streamQuickStart: vi.fn(),
}));

import { api, streamQuickStart } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.getQuickStartInflight).mockResolvedValue(null as never);
  vi.mocked(streamQuickStart).mockReset();
});

describe("QuickStartPanel", () => {
  it("говорит, что ничего не будет утверждено без автора", () => {
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    expect(screen.getByText(/ничего не утверд/i)).toBeInTheDocument();
  });

  it("показывает этапы по мере их прохождения", async () => {
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      handlers.onStage({ index: 0, total: 5, stageId: "world", status: "started" });
      handlers.onStage({ index: 0, total: 5, stageId: "world", status: "done" });
      handlers.onDone({ stages: [], cancelled: false, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    expect(await screen.findByText("Мир")).toBeInTheDocument();
  });

  it("отказавший этап назван вместе с причиной", async () => {
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      handlers.onStage({
        index: 4,
        total: 5,
        stageId: "plot",
        status: "failed",
        message: "бэкенд недоступен",
      });
      handlers.onDone({ stages: [], cancelled: false, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    expect(await screen.findByText(/бэкенд недоступен/)).toBeInTheDocument();
  });

  it("останавливает сбор по кнопке", async () => {
    vi.mocked(api.cancelQuickStart).mockResolvedValue({ stopping: true } as never);
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      await new Promise((r) => setTimeout(r, 50));
      handlers.onDone({ stages: [], cancelled: true, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(api.cancelQuickStart).toHaveBeenCalledWith(3));
  });

  it("подхватывает идущий сбор при монтировании", async () => {
    vi.mocked(api.getQuickStartInflight).mockResolvedValue({
      total: 5,
      startedAt: "2026-09-06T10:00:00.000Z",
      rows: [{ stageId: "world", status: "done" }],
    } as never);
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    expect(await screen.findByText(/идёт/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/studio/__tests__/QuickStartPanel.test.tsx`
Ожидаемо: FAIL, `Failed to resolve import "../QuickStartPanel"`.

- [ ] **Step 3: Написать серверные маршруты**

В `apps/server/src/routes/studio.ts` завести рядом с реестрами интейка (строки 243-258) реестр и снимок сбора:

```ts
  const quickStartCancels = createQuickStartCancelRegistry();
  /** Что сейчас собирается для книги — для GET .../quick-start/inflight.
   *  В памяти процесса, как и у приёма материала: переживший перезапуск
   *  прогон всё равно мёртв. */
  const quickStartInFlight = new Map<
    number,
    { total: number; startedAt: string; rows: Array<{ stageId: string; status: string; message?: string }> }
  >();
```

и три обработчика, скопировав устройство потока с `POST /books/:id/intake-stream` (строки 567-691) — включая очередь записи, `ping` раз в 20 секунд и снятие регистрации в `finally`:

```ts
  r.post("/books/:id/quick-start", async (c) => {
    const id = Number(c.req.param("id"));
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    return streamSSE(c, async (stream) => {
      let pending: Promise<void> = Promise.resolve();
      const queue = (event: string, data: unknown): void => {
        pending = pending
          .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
          .catch(() => {});
      };
      const keepalive = setInterval(() => queue("ping", { at: Date.now() }), 20_000);
      quickStartCancels.begin(id);
      quickStartInFlight.set(id, {
        total: QUICK_START_STAGES.length,
        startedAt: new Date().toISOString(),
        rows: [],
      });
      queue("begin", { total: QUICK_START_STAGES.length });

      try {
        const result = await runQuickStart(
          { sqlite, hasVec, repo, bookId: id },
          {
            onStage: (e) => {
              const run = quickStartInFlight.get(id);
              if (run) {
                run.rows[e.index] = {
                  stageId: e.stageId,
                  status: e.status,
                  ...(e.message !== undefined ? { message: e.message } : {}),
                };
              }
              queue("stage", e);
            },
            shouldStop: () => quickStartCancels.shouldStop(id),
          },
        );
        await pending;
        await stream.writeSSE({ event: "done", data: JSON.stringify(result) });
      } catch (e) {
        await pending;
        const message = e instanceof Error ? e.message : String(e);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: "quick_start_failed", details: { message } }),
        });
      } finally {
        clearInterval(keepalive);
        quickStartCancels.end(id);
        quickStartInFlight.delete(id);
      }
    });
  });

  r.get("/books/:id/quick-start/inflight", (c) => {
    const id = Number(c.req.param("id"));
    const run = quickStartInFlight.get(id);
    if (run === undefined) return notFound(c, "quick_start_run");
    return c.json(run);
  });

  r.post("/books/:id/quick-start/cancel", (c) => {
    const id = Number(c.req.param("id"));
    if (!quickStartCancels.requestStop(id)) return notFound(c, "quick_start_run");
    return c.json({ stopping: true });
  });
```

Импортировать `createQuickStartCancelRegistry`, `runQuickStart`, `QUICK_START_STAGES`.

- [ ] **Step 4: Написать клиент и панель**

В `apps/web/src/api/client.ts` дописать функции. Читатель потока — копия `streamRepair` по устройству (те же чтение по кускам, разбор `event:`/`data:`, игнорирование неизвестных событий):

```ts
export interface QuickStartStreamHandlers {
  onBegin: (payload: { total: number }) => void;
  onStage: (e: {
    index: number;
    total: number;
    stageId: string;
    status: "started" | "done" | "skipped" | "failed";
    message?: string;
  }) => void;
  onDone: (payload: { stages: unknown[]; cancelled: boolean; revision: number }) => void;
  onError: (message: string) => void;
}

export async function streamQuickStart(
  bookId: number,
  handlers: QuickStartStreamHandlers,
): Promise<void> {
  // Разбор потока — как в streamRepair выше: читать куски, резать по "\n\n",
  // доставать event: и data:, неизвестные события игнорировать.
}
```

и в объект `api`:

```ts
  cancelQuickStart: (bookId: number) =>
    req<{ stopping: boolean }>(`/api/books/${bookId}/quick-start/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getQuickStartInflight: (bookId: number) =>
    req<{
      total: number;
      startedAt: string;
      rows: Array<{ stageId: string; status: string; message?: string }>;
    } | null>(`/api/books/${bookId}/quick-start/inflight`).catch(() => null),
```

Создать `apps/web/src/components/studio/QuickStartPanel.tsx` — кнопка «Собрать всё до первой главы», строка на этап с русским названием из общего словаря подписей, кнопка «Остановить» во время сбора, часы «идёт N мин» (один вызов агента молчит минутами, и без бегущего времени экран неотличим от зависшего), подхват идущего прогона при монтировании через `getQuickStartInflight` с опросом раз в 2 секунды. Под кнопкой — строка: «Готовит черновики. Ничего не утверждает и глав не создаёт — это ваш выбор.»

Вставить панель в `apps/web/src/pages/StudioPage.tsx` рядом с зоной приёма материала, передав `onFinished` = перезагрузка состояния страницы.

- [ ] **Step 5: Дописать серверный тест**

Дописать в `apps/server/src/routes/__tests__/studio.test.ts`: `GET /quick-start/inflight` на книге без сбора отвечает 404; `POST /quick-start/cancel` без идущего сбора отвечает 404.

- [ ] **Step 6: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/studio/__tests__/QuickStartPanel.test.tsx`
Ожидаемо: PASS, 5 тестов.

Выполнить: `pnpm --filter @book-forge/server test && pnpm --filter @book-forge/web test && pnpm typecheck`
Ожидаемо: PASS.

- [ ] **Step 7: Коммит**

```bash
git add apps/server/src/routes/studio.ts apps/server/src/app.ts apps/server/src/routes/__tests__/studio.test.ts apps/web/src/api/client.ts apps/web/src/components/studio/QuickStartPanel.tsx apps/web/src/components/studio/__tests__/QuickStartPanel.test.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(quick-start): one button, a stage at a time, stoppable

The stream, the in-flight snapshot and the cancel registry follow the material
intake exactly, down to the twenty-second ping and the running clock: an agent
call is silent for minutes, and without the clock the screen is
indistinguishable from a hung one. The panel says out loud that nothing is
approved."
```

---

### Task 11: Документация и полный прогон

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md`

- [ ] **Step 1: Описать фазу в CLAUDE.md**

В `CLAUDE.md` после абзаца «Предложения прозы» добавить абзац в том же регистре — плотно, с объяснением решений, а не перечнем возможностей:

```markdown
**Один план книги (2026-09-06, фаза 5 конвейера):** этап `plot` сохранил идентификатор и потерял markdown-природу. Убрать его из `STAGE_IDS` было нельзя: `studioStateSchema` проверяет ключи сохранённых этапов по этому списку, и книга, куда интейк уже положил аспект сюжета, перестала бы читаться в тот же миг. Экран этапа — `PlanStagePage`: варианты `books.outline_json` рядом, поглавные строки выбранного, «Утвердить план» и отдельный блок «Заметки из ваших материалов» с прежними аспектами, которые никуда не делись. Вариант плана получил необязательные `chapters` (строка на главу: `title`, `pov?`, `goal?`, `conflict?`, `stakes?`, `hook?`) и `source: "llm" | "author_material"`; повествовательные поля варианта (логлайн, синопсис, арки) стали необязательными **в хранилище** и остались обязательными в тулсхеме агента — тот же приём, что у `architecture`, потому что авторское оглавление синопсиса не имеет, а генератор обязан его дать. Утверждение — `POST /books/:id/plan/approve` ([utils/plan-approve.ts](apps/server/src/utils/plan-approve.ts)): строки сопоставляются с существующими главами **по порядку**, не по названию (автор переименовывает главы, план — нет, и одно переименование рассыпало бы сопоставление); совпавшая глава получает намерение и сохраняет своё имя и текст, лишняя строка создаёт главу обычной разрежённой нумерацией, лишние главы не удаляются. Повторное утверждение обновляет намерения и не плодит глав. `PlanPanel` читает намерение из главы, поля ручного ввода больше нет; `OutlinePanel` со страницы «Главы» ушёл. Готовность этапа `plot` считается не по аспектам, а по `isPlanApproved(book.outlineJson)` — признак приходит в `computeStudioProgress` снаружи, потому что общий пакет книгу не читает. Стык с фазой 2 закрыт: фрагмент интейка получил необязательные `chapters`, разобранное оглавление становится вариантом плана с пометкой авторского, а проза о сюжете без списка глав по-прежнему ложится заметкой — и заметка видна на экране плана. Быстрый сбор — `POST /books/:id/quick-start` ([utils/quick-start-run.ts](apps/server/src/utils/quick-start-run.ts)): раннер по образцу приёма материала (SSE, `ping` раз в 20 с, реестр отмены в памяти, снимок для `inflight`, останов между этапами — прервать идущий вызов агента нечем). Он готовит черновики мира, лора, персонажей, предметов и плана в статусе `reviewing`, **ничего не утверждает и глав не создаёт**: правило «без автора ничего не утверждается» держит интейк и предложения прозы, и кнопка быстрого сбора его не отменяет. Этап, где уже есть черновики, пропускается; отказ одного этапа не уносит остальные.
```

- [ ] **Step 2: Отметить фазу в спеке**

В `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md` в начало раздела «Фаза 5» дописать строку о выполнении с датой и путём к этому плану.

- [ ] **Step 3: Полный прогон**

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0.

Выполнить: `pnpm test`
Ожидаемо: все пакеты зелёные.

Выполнить: `pnpm build`
Ожидаемо: код возврата 0.

- [ ] **Step 4: Проверить книгу с уже приземлённым сюжетом**

Миграций в этой фазе нет, но проверить надо главное — что книга, куда интейк положил аспекты сюжета до фазы 5, читается и показывает их. На копии рабочей базы:

```bash
cp data/db.sqlite data/phase5-check.sqlite
cd apps/server && node -e "const D=require('better-sqlite3');const d=new D('../../data/phase5-check.sqlite',{readonly:true});const rows=d.prepare('SELECT id,title,studio_state,outline_json FROM books').all();for(const b of rows){let plot=0;try{plot=(JSON.parse(b.studio_state||'{}').stages?.plot?.aspects||[]).length}catch{};console.log(b.id,b.title,'plot-аспектов:',plot,'план:',b.outline_json?'есть':'нет')}" && cd ../..
```

Ожидаемо: команда отрабатывает без ошибок разбора, и книги с аспектами на этапе `plot` перечислены. Затем открыть такую книгу в приложении (`pnpm dev`) на `/books/:id/studio/plot` и убедиться, что блок «Заметки из ваших материалов» показывает их. Копию удалить: `rm data/phase5-check.sqlite`.

- [ ] **Step 5: Коммит**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md
git commit -m "docs: one book plan"
```

---

## Карта соответствия приёмке

Спека фазы 5 требует, задачи закрывают:

| Требование спеки | Где |
|---|---|
| Markdown-этап «Сюжет» перестаёт быть markdown-этапом, идентификатор остаётся | Задача 6 |
| Экран «План»: варианты рядом, правка порядка и названий, «Утвердить план» | Задачи 6, 5 |
| `PlanPanel` берёт намерение из главы, ручного ввода нет | Задача 7 |
| `OutlinePanel` уходит со страницы «Главы» | Задача 7 |
| Классификатор отдаёт для `plot` разобранные главы | Задачи 2, 3 |
| Разобранное оглавление ложится вариантом плана с пометкой авторского | Задача 4 |
| Утверждение создаёт главы с намерениями автора, а не модели | Задача 5 |
| Прежние аспекты этапа сохранены и видны | Задачи 6, 11 (шаг 4) |
| Готовность этапа считается по утверждённому плану | Задача 8 |
| Быстрый сбор: очередь этапов, восстановление после сбоя, ничего не утверждает | Задачи 9, 10 |
| После «Утвердить план» список глав совпадает с планом | Задача 5, тесты сопоставления |
| Открытие главы показывает предзаполненный план главы | Задача 7 |
| «Написать главу» доступна без ручного ввода | Задача 7 (намерение из главы) + существующий маршрут генерации |

## Самопроверка плана

- **Покрытие спеки.** Все двенадцать требований раздела «Фаза 5» имеют задачу, включая оба, добавленных проектом 2026-09-06 (перепрофилирование вместо удаления; быстрый сбор, который ничего не утверждает).
- **Заглушек нет,** с одним названным исключением: тело `generateStage` в задаче 9 заполняется по результатам чтения действующих обработчиков Мастерской, и шаг 0 этой задачи прямо это предписывает. Копия их логики в плане разошлась бы с оригиналом при первом же изменении, а раннер обязан звать те же функции, а не свою версию.
- **Согласованность имён.** `outlineChapterSchema`, `OutlineChapter`, `renderOutlineChapterIntent`, `isPlanApproved` из задач 1 и 8 используются под теми же именами в задачах 2, 4, 5, 6, 7. `buildImportedPlanVariant` объявлен в задаче 2 и вызывается в задаче 4. `approvePlan`/`PlanApproveError` объявлены в задаче 5 и вызываются её же маршрутом. `QUICK_START_STAGES`, `runQuickStart`, `createQuickStartCancelRegistry` объявлены в задаче 9 и вызываются в задаче 10. `api.approvePlan` объявлен в задаче 6 и используется её экраном.
- **Известные риски.** Задача 1 ослабляет обязательность полей общего типа — компилятор перечислит всех потребителей, и шаг 5 этой задачи прямо на него опирается. Задача 4 меняет форму `LandFragmentsResult`, которую читает `intake-run.ts`; обе правки в одной задаче. Задача 8 добавляет необязательный параметр в две публичные функции общего пакета — вызовы без него сохраняют прежнее поведение, и на это есть тест.
