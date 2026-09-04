# Конвейер автора, фаза 2 «Приём материала» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автор перетаскивает папку своих заметок и черновиков, один проход раскладывает их по этапам студии черновиками на утверждение, и каталог `import/` заезжает целиком за один шаг.

**Architecture:** Веб читает файлы в текст и отправляет их пачкой на `POST /books/:id/intake`. Сервер прогоняет каждый файл через новый структурный агент `material_classifier`, который режет файл на фрагменты и приписывает каждому этап. Фрагменты приземляются по назначению: задумка — в `concept.idea`; мир, лор и сюжет — аспектами `payloadKind: "markdown"` с одним вариантом и `source: "import"`; персонажи и предметы — аспектами `entity_set` с кандидатами; готовые главы — через существующий `parseChapters` и вставку глав. Ничего не утверждается автоматически: аспект приходит в статусе `reviewing` без `finalPayload`, и автор принимает его существующим `AspectRunner`. Миграции нет — `payloadKind: "import_candidate"`, `source: "import"` и тип события `import_merge` уже объявлены в схеме и до сих пор не использовались.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Node 22, zod 4.4.3, Hono, better-sqlite3, jszip (уже в `apps/server`), React 18, Vite 6, vitest, @testing-library/react, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md` — раздел 3 «Вход с материалом», раздел 6 «Фаза 2. Приём материала». Фаза 1 «Замысел» влита (`26549f8`).

## Global Constraints

- Node 22 LTS, ESM only, TypeScript strict с `noUncheckedIndexedAccess`. Индекс массива, `.find()` и `Map.get` дают `T | undefined` — обрабатывать всегда.
- Импорты между пакетами только через `workspace:*` и поле `exports`. Новый файл агента = новая строка в `packages/agents/package.json` `exports`.
- **Миграции БД нет.** Всё пишется в существующие колонки: `books.studio_state`, `books.concept`, `chapters`, `chapter_versions`, `studio_events`. `schemaVersion` студии остаётся `1`.
- Новый агент = имя в `AGENT_NAMES` и в `STRUCTURED_AGENT_NAMES` (`packages/llm/src/types.ts`), строка в `DEFAULT_AGENT_BACKEND` (`packages/llm/src/router.ts`, исчерпывающий `Record<AgentName, LLMBackend>`), контракт, регистрация в `packages/agents/src/bootstrap.ts`. Тест `packages/llm/src/__tests__/structured-agents-parity.test.ts` падает при расхождении списков.
- Агент по умолчанию на `"sonnet"`, `maxTokens` явно, `temperature` только условно: `...(options.temperature !== undefined ? { temperature: options.temperature } : {})`.
- **Инварианты `studio_state`** (`packages/shared/src/studio-invariants.ts`) проверяются перед каждой записью. Ключевые для этой фазы: `payloadKind` каждого варианта обязан совпадать с `payloadKind` аспекта; аспект в статусе `accepted` обязан иметь `finalPayload`; принятый вариант в аспекте не более одного.
- **Ничто не утверждается автоматически.** Импортированный аспект приходит `status: "reviewing"`, `finalPayload` отсутствует, единственный вариант `status: "generated"`. Это ровно то состояние, из которого `AspectRunner` умеет принимать.
- `contextRef` требует все четыре поля непустыми (`hash`, `summary`, `includedAspectIds`, `includedEntityIds`) — либо заполнять целиком, либо не задавать.
- Все строки интерфейса на русском. Слова «Концепт», «Премиса», «Логлайн», «Протагонист», «Ставки» в интерфейс не попадают; подписи берутся из `PITCH_FIELD_LABELS`.
- Десктоп-only: мобильную вёрстку не делать и не проверять.
- Серверные тесты мокают модуль агента `vi.mock("@book-forge/agents/...")` ДО импорта `./_helpers.js` — `studio.ts` импортирует раннеры на загрузке модуля. Веб-тесты мокают `@/api/client`; msw в проекте нет.
- Каждая задача заканчивается зелёными `pnpm typecheck` и `pnpm test` и своим коммитом.
- Команды из корня репозитория:
  - shared: `pnpm --filter @book-forge/shared test -- src/intake.test.ts`
  - agents: `pnpm --filter @book-forge/agents test -- src/intake/__tests__/classifier.test.ts`
  - llm: `pnpm --filter @book-forge/llm test`
  - server: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake.test.ts`
  - web: `pnpm --filter @book-forge/web test -- src/components/studio/intake/__tests__/DropZone.test.tsx`

---

## Карта файлов

**Создать**
- `packages/shared/src/intake.ts` — типы фрагмента и приёмки, `INTAKE_TARGETS`, `INTAKE_TARGET_LABELS`, `buildImportedMarkdownAspect`, `buildImportedEntityAspect`, `mergeAspectsIntoStage`, `summarizeIntake`.
- `packages/shared/src/intake.test.ts`.
- `packages/agents/src/intake/classifier.ts` — контракт и раннер `material_classifier`, `buildClassifierPrompt`, `toFragments`.
- `packages/agents/src/intake/__tests__/classifier.test.ts`.
- `apps/server/src/utils/intake-landing.ts` — приземление фрагментов: `landFragments`, `landChapterFragments`, `intakeRequestKey`.
- `apps/server/src/utils/__tests__/intake-landing.test.ts`.
- `apps/server/src/utils/docx.ts` — `docxToPlainText` на jszip.
- `apps/server/src/utils/__tests__/docx.test.ts`.
- `apps/server/src/routes/__tests__/intake.test.ts`.
- `apps/web/src/components/studio/intake/DropZone.tsx`, `IntakeSummary.tsx`, `IntakePanel.tsx`.
- `apps/web/src/components/studio/intake/__tests__/DropZone.test.tsx`, `IntakeSummary.test.tsx`, `IntakePanel.test.tsx`.

**Изменить**
- `packages/shared/src/index.ts` — экспорт `./intake.js`.
- `packages/llm/src/types.ts`, `router.ts`; `packages/agents/src/bootstrap.ts`, `package.json`.
- `apps/server/src/routes/studio.ts` — маршрут `POST /books/:id/intake`.
- `apps/server/src/routes/import-export.ts` — вынести вставку глав в переиспользуемую функцию.
- `apps/web/src/api/client.ts`, `apps/web/src/pages/StudioPage.tsx` (+ тест), `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx` (+ тест).
- `CLAUDE.md`.

---

### Task 1: Типы и построители аспектов в shared

**Files:**
- Create: `packages/shared/src/intake.ts`
- Test: `packages/shared/src/intake.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `INTAKE_TARGETS`, `type IntakeTarget`, `INTAKE_TARGET_LABELS`, `intakeFragmentSchema`, `type IntakeFragment`, `type IntakeLanded`, `buildImportedMarkdownAspect(fragment, order, now)`, `buildImportedEntityAspect(fragment, order, now)`, `mergeAspectsIntoStage(stage, aspects, now)`, `summarizeIntake(landed)`.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/shared/src/intake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  INTAKE_TARGETS,
  INTAKE_TARGET_LABELS,
  intakeFragmentSchema,
  buildImportedMarkdownAspect,
  buildImportedEntityAspect,
  mergeAspectsIntoStage,
  summarizeIntake,
  type IntakeFragment,
} from "./intake.js";
import { assertStudioStateInvariants } from "./studio-invariants.js";
import { emptyStudioState } from "./studio-state.js";

const NOW = "2026-09-05T10:00:00.000Z";

const WORLD: IntakeFragment = {
  target: "world",
  title: "Карта и маршруты",
  body: "Барьер делит два мира. Караваны идут ритуальными коридорами.",
  note: "география и логистика",
};

const PEOPLE: IntakeFragment = {
  target: "characters",
  title: "Связи и конфликты",
  body: "Нейла — проводница каравана.\nРахир — пустынный метролог.",
  note: "два героя",
  entities: [
    { name: "Нейла", summary: "Проводница каравана, верит карте больше, чем себе." },
    { name: "Рахир", summary: "Пустынный метролог, читает соляные пласты." },
  ],
};

describe("INTAKE_TARGETS", () => {
  it("covers every stage the author can receive material into, plus skip", () => {
    expect([...INTAKE_TARGETS]).toEqual([
      "concept", "world", "lore", "characters", "items", "plot", "chapters", "skip",
    ]);
  });

  it("every target has a Russian label", () => {
    for (const t of INTAKE_TARGETS) {
      expect(INTAKE_TARGET_LABELS[t].length).toBeGreaterThan(0);
    }
    expect(INTAKE_TARGET_LABELS.chapters).toBe("Готовые главы");
    expect(INTAKE_TARGET_LABELS.skip).toBe("Не пригодилось");
  });
});

describe("intakeFragmentSchema", () => {
  it("accepts a markdown fragment without entities", () => {
    expect(intakeFragmentSchema.safeParse(WORLD).success).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(intakeFragmentSchema.safeParse({ ...WORLD, body: "  " }).success).toBe(false);
  });

  it("accepts entities only as name plus summary", () => {
    expect(intakeFragmentSchema.safeParse(PEOPLE).success).toBe(true);
    expect(
      intakeFragmentSchema.safeParse({ ...PEOPLE, entities: [{ name: "", summary: "x" }] }).success,
    ).toBe(false);
  });
});

describe("buildImportedMarkdownAspect", () => {
  it("produces a reviewing draft with one generated variant and no finalPayload", () => {
    const a = buildImportedMarkdownAspect(WORLD, 3, NOW);
    expect(a.status).toBe("reviewing");
    expect(a.finalPayload).toBeUndefined();
    expect(a.source).toBe("import");
    expect(a.payloadKind).toBe("markdown");
    expect(a.required).toBe(false);
    expect(a.order).toBe(3);
    expect(a.name).toBe("Карта и маршруты");
    expect(a.variants).toHaveLength(1);
    const v = a.variants[0]!;
    expect(v.payloadKind).toBe("markdown");
    expect(v.payload).toBe(WORLD.body);
    expect(v.status).toBe("generated");
    expect(v.editSource).toBe("manual");
    expect(v.generatedAt).toBe(NOW);
    expect(v.label).toBe("из ваших материалов");
    expect(a.selectedVariantId).toBeUndefined();
  });

  it("carries the classifier's note into the aspect description", () => {
    expect(buildImportedMarkdownAspect(WORLD, 0, NOW).description).toBe("география и логистика");
  });

  it("gives each aspect and variant distinct ids", () => {
    const a = buildImportedMarkdownAspect(WORLD, 0, NOW);
    const b = buildImportedMarkdownAspect(WORLD, 1, NOW);
    expect(a.id).not.toBe(b.id);
    expect(a.variants[0]!.id).not.toBe(b.variants[0]!.id);
    expect(a.id).not.toBe(a.variants[0]!.id);
  });
});

describe("buildImportedEntityAspect", () => {
  it("produces an entity_set draft whose variant payload holds proposed candidates", () => {
    const a = buildImportedEntityAspect(PEOPLE, 0, NOW);
    expect(a.payloadKind).toBe("entity_set");
    expect(a.status).toBe("reviewing");
    expect(a.finalPayload).toBeUndefined();
    const v = a.variants[0]!;
    expect(v.payloadKind).toBe("entity_set");
    const payload = v.payload as { candidates: Array<Record<string, unknown>> };
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates[0]).toMatchObject({ kind: "character", status: "proposed" });
    expect(payload.candidates[0]!.profile).toEqual({
      name: "Нейла",
      summary: "Проводница каравана, верит карте больше, чем себе.",
    });
    expect(new Set(payload.candidates.map((c) => c.tempId)).size).toBe(2);
  });

  it("uses the item kind for the items stage", () => {
    const a = buildImportedEntityAspect({ ...PEOPLE, target: "items" }, 0, NOW);
    const payload = a.variants[0]!.payload as { candidates: Array<{ kind: string }> };
    expect(payload.candidates.every((c) => c.kind === "item")).toBe(true);
  });

  it("returns undefined when the fragment carries no entities", () => {
    expect(buildImportedEntityAspect({ ...PEOPLE, entities: [] }, 0, NOW)).toBeUndefined();
  });
});

describe("mergeAspectsIntoStage", () => {
  it("appends after existing aspects, continues the order and never lowers the stage status", () => {
    const stage = {
      status: "complete" as const,
      playbookGenerated: true,
      aspects: [
        {
          id: "old", name: "Уже принято", status: "accepted" as const, order: 0,
          required: true, source: "llm" as const, payloadKind: "markdown" as const,
          variants: [], finalPayload: "текст",
        },
      ],
    };
    const fresh = [buildImportedMarkdownAspect(WORLD, 0, NOW)];
    const next = mergeAspectsIntoStage(stage, fresh, NOW);
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[1]!.order).toBe(1);
    expect(next.aspects[0]!.id).toBe("old");
    expect(next.status).toBe("complete");
    expect(next.updatedAt).toBe(NOW);
  });

  it("moves an untouched stage into in_progress", () => {
    const next = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedMarkdownAspect(WORLD, 0, NOW)],
      NOW,
    );
    expect(next.status).toBe("in_progress");
    expect(next.aspects[0]!.order).toBe(0);
  });

  it("produces a state the studio invariants accept", () => {
    const state = emptyStudioState();
    state.stages.world = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedMarkdownAspect(WORLD, 0, NOW)],
      NOW,
    );
    state.stages.characters = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedEntityAspect(PEOPLE, 0, NOW)!],
      NOW,
    );
    expect(() => assertStudioStateInvariants(state)).not.toThrow();
  });
});

describe("summarizeIntake", () => {
  it("counts what landed where and keeps the order of INTAKE_TARGETS", () => {
    const s = summarizeIntake([
      { target: "world", title: "Карта", kind: "aspect" },
      { target: "world", title: "Кухня", kind: "aspect" },
      { target: "chapters", title: "Глава 01", kind: "chapter" },
      { target: "concept", title: "Задумка", kind: "idea" },
    ]);
    expect(s.map((row) => [row.target, row.count])).toEqual([
      ["concept", 1], ["world", 2], ["chapters", 1],
    ]);
    expect(s[1]!.titles).toEqual(["Карта", "Кухня"]);
    expect(s[0]!.label).toBe(INTAKE_TARGET_LABELS.concept);
  });

  it("returns an empty list when nothing landed", () => {
    expect(summarizeIntake([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/intake.test.ts`
Expected: FAIL — модуль `./intake.js` не найден.

- [ ] **Step 3: Реализовать**

Создать `packages/shared/src/intake.ts`:

```ts
import { z } from "zod";
import type { AspectVariant, StageAspect, StageState } from "./studio-state.js";

/** Куда классификатор может отправить фрагмент. `skip` — «не пригодилось»:
 *  автор видит, что файл прочитан, но в этапы ничего не легло. */
export const INTAKE_TARGETS = [
  "concept",
  "world",
  "lore",
  "characters",
  "items",
  "plot",
  "chapters",
  "skip",
] as const;
export type IntakeTarget = (typeof INTAKE_TARGETS)[number];

/** Названия для автора. Внутренние id этапов ему не показываются. */
export const INTAKE_TARGET_LABELS: Record<IntakeTarget, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "План книги",
  chapters: "Готовые главы",
  skip: "Не пригодилось",
};

export const intakeEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
});
export type IntakeEntity = z.infer<typeof intakeEntitySchema>;

export const intakeFragmentSchema = z.object({
  target: z.enum(INTAKE_TARGETS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(60000),
  /** Одна строка, почему фрагмент отнесён сюда; становится описанием аспекта. */
  note: z.string().trim().max(400).optional(),
  /** Только для characters/items. Пусто для остальных целей. */
  entities: z.array(intakeEntitySchema).max(40).optional(),
});
export type IntakeFragment = z.infer<typeof intakeFragmentSchema>;

/** Что именно легло — для сводки автору. */
export interface IntakeLanded {
  target: IntakeTarget;
  title: string;
  kind: "aspect" | "chapter" | "idea";
}

const VARIANT_LABEL = "из ваших материалов";

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function importedVariant(
  payloadKind: AspectVariant["payloadKind"],
  payload: unknown,
  now: string,
): AspectVariant {
  return {
    id: newId(),
    label: VARIANT_LABEL,
    payloadKind,
    payload,
    status: "generated",
    editSource: "manual",
    generatedAt: now,
  };
}

/** Черновик из материалов автора: аспект в `reviewing` без `finalPayload`, с
 *  единственным непринятым вариантом. Ровно то состояние, из которого
 *  `AspectRunner` умеет принять текст одной кнопкой. */
export function buildImportedMarkdownAspect(
  fragment: IntakeFragment,
  order: number,
  now: string,
): StageAspect {
  return {
    id: newId(),
    name: fragment.title,
    ...(fragment.note !== undefined ? { description: fragment.note } : {}),
    status: "reviewing",
    order,
    required: false,
    source: "import",
    payloadKind: "markdown",
    variants: [importedVariant("markdown", fragment.body, now)],
  };
}

/** То же для этапов сущностей. Кандидаты приходят `proposed` — материализация
 *  в канон остаётся отдельным решением автора. */
export function buildImportedEntityAspect(
  fragment: IntakeFragment,
  order: number,
  now: string,
): StageAspect | undefined {
  const entities = fragment.entities ?? [];
  if (entities.length === 0) return undefined;
  const kind = fragment.target === "items" ? "item" : "character";
  const candidates = entities.map((e) => ({
    tempId: newId(),
    kind,
    profile: { name: e.name, summary: e.summary },
    status: "proposed" as const,
  }));
  return {
    id: newId(),
    name: fragment.title,
    ...(fragment.note !== undefined ? { description: fragment.note } : {}),
    status: "reviewing",
    order,
    required: false,
    source: "import",
    payloadKind: "entity_set",
    variants: [importedVariant("entity_set", { candidates }, now)],
  };
}

/** Дописывает импортированные аспекты в конец этапа, продолжая нумерацию.
 *  Статус этапа не понижается: уже завершённый этап остаётся завершённым,
 *  нетронутый переходит в работу. */
export function mergeAspectsIntoStage(
  stage: StageState,
  fresh: StageAspect[],
  now: string,
): StageState {
  const base = stage.aspects.length;
  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: [
      ...stage.aspects,
      ...fresh.map((a, i) => ({ ...a, order: base + i })),
    ],
    updatedAt: now,
  };
}

export interface IntakeSummaryRow {
  target: IntakeTarget;
  label: string;
  count: number;
  titles: string[];
}

/** Сводка «что и куда легло», в порядке этапов конвейера. */
export function summarizeIntake(landed: IntakeLanded[]): IntakeSummaryRow[] {
  const rows: IntakeSummaryRow[] = [];
  for (const target of INTAKE_TARGETS) {
    const mine = landed.filter((l) => l.target === target);
    if (mine.length === 0) continue;
    rows.push({
      target,
      label: INTAKE_TARGET_LABELS[target],
      count: mine.length,
      titles: mine.map((l) => l.title),
    });
  }
  return rows;
}
```

В `packages/shared/src/index.ts` добавить рядом с остальными студийными экспортами:

```ts
export * from "./intake.js";
```

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @book-forge/shared test -- src/intake.test.ts && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/intake.ts packages/shared/src/intake.test.ts packages/shared/src/index.ts
git commit -m "feat(intake): fragment types and builders that land author material as drafts"
```

---

### Task 2: Агент `material_classifier`

**Files:**
- Create: `packages/agents/src/intake/classifier.ts`
- Test: `packages/agents/src/intake/__tests__/classifier.test.ts`
- Modify: `packages/llm/src/types.ts` (`AGENT_NAMES`, `STRUCTURED_AGENT_NAMES`), `packages/llm/src/router.ts` (`DEFAULT_AGENT_BACKEND`), `packages/agents/src/bootstrap.ts`, `packages/agents/package.json`

**Interfaces:**
- Consumes: `INTAKE_TARGETS`, `INTAKE_TARGET_LABELS`, `intakeFragmentSchema`, `IntakeFragment`, `ModelChoice` из `@book-forge/shared`; `registerAgentContract`, `dispatchStructured`, `AgentStructuredContract` из `@book-forge/llm`.
- Produces: `interface MaterialClassifierInput { filename: string; content: string; bookIdea?: string; existingStages?: string[] }`, `type MaterialClassifierOutput = { fragments: IntakeFragment[]; bookIdea?: string }`, `buildClassifierPrompt(input): string`, `registerMaterialClassifierContract(): void`, `runMaterialClassifier(input, options?: { model?: ModelChoice; temperature?: number }): Promise<MaterialClassifierOutput>`.

- [ ] **Step 1: Падающий тест**

Создать `packages/agents/src/intake/__tests__/classifier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildClassifierPrompt } from "../classifier.js";

const CONTENT = "# Оглавление\n\n## Логлайн\nШестеро героев из двух миров.\n\n## Глава 01\nPOV: Нейла.";

describe("buildClassifierPrompt", () => {
  it("carries the filename and the file content", () => {
    const p = buildClassifierPrompt({ filename: "00_Оглавление.md", content: CONTENT });
    expect(p).toContain("00_Оглавление.md");
    expect(p).toContain("Шестеро героев из двух миров.");
  });

  it("lists every target with its Russian label", () => {
    const p = buildClassifierPrompt({ filename: "x.md", content: CONTENT });
    for (const pair of ["world — Мир", "lore — Лор", "chapters — Готовые главы", "skip — Не пригодилось"]) {
      expect(p).toContain(pair);
    }
  });

  it("includes the book's existing idea when there is one, and says not to replace it", () => {
    const p = buildClassifierPrompt({
      filename: "x.md",
      content: CONTENT,
      bookIdea: "Уже записанная задумка",
    });
    expect(p).toContain("Уже записанная задумка");
    expect(p).toContain("уже есть");
  });

  it("omits the idea block when the book has none", () => {
    expect(buildClassifierPrompt({ filename: "x.md", content: CONTENT })).not.toContain("ЗАДУМКА КНИГИ");
  });

  it("names the stages that already hold material, so the model can match them", () => {
    const p = buildClassifierPrompt({
      filename: "x.md",
      content: CONTENT,
      existingStages: ["Мир: география, климат", "Лор: барьер"],
    });
    expect(p).toContain("Мир: география, климат");
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/intake/__tests__/classifier.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Зарегистрировать имя агента**

В `packages/llm/src/types.ts` дописать в `AGENT_NAMES` после `"reranker",`:

```ts
  "material_classifier",
```

и в `STRUCTURED_AGENT_NAMES` после `"reranker",`:

```ts
  "material_classifier",
```

В `packages/llm/src/router.ts` в `DEFAULT_AGENT_BACKEND` после `reranker: "subscription",`:

```ts
  material_classifier: "subscription",
```

Run: `pnpm --filter @book-forge/llm test`
Expected: PASS (страж паритета доволен, оба списка выросли).

- [ ] **Step 4: Реализовать агент**

Создать `packages/agents/src/intake/classifier.ts`:

```ts
import { z } from "zod";
import {
  INTAKE_TARGETS,
  INTAKE_TARGET_LABELS,
  intakeFragmentSchema,
  type IntakeFragment,
  type ModelChoice,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

export interface MaterialClassifierInput {
  filename: string;
  content: string;
  /** Задумка книги, если она уже записана: помогает не спутать чужой мир со своим. */
  bookIdea?: string;
  /** Короткие описания того, что уже лежит на этапах, по строке на этап. */
  existingStages?: string[];
}

const materialClassifierOutputSchema = z.object({
  fragments: z.array(intakeFragmentSchema).max(40),
  /** Заполняется только если файл содержит формулировку замысла целиком. */
  bookIdea: z.string().trim().max(8000).optional(),
});
export type MaterialClassifierOutput = z.infer<typeof materialClassifierOutputSchema>;
export type { IntakeFragment };

const SYSTEM = `Ты — редактор, который разбирает рабочие материалы автора и раскладывает их по этапам подготовки книги. Работаешь на русском.

Автор даёт один файл своих заметок: это может быть оглавление, описание мира, свод правил, список персонажей, экономика, карта, готовая глава — что угодно. Твоя задача — разрезать файл на осмысленные фрагменты и каждому назначить этап.

Правила:
- Не пересказывай и не сокращай. Тело фрагмента — текст автора, перенесённый как есть, с сохранением разметки. Ты решаешь, где границы, а не что написано.
- Один фрагмент — одна тема. Файл про кухню двух регионов — два фрагмента, если регионы описаны отдельно, и один, если текст сплошной.
- Заголовок фрагмента бери из заголовка автора. Если его нет — назови коротко и по делу, 2–5 слов.
- note — одна строка, почему фрагмент отнесён именно сюда. Она станет подписью под черновиком.
- Куда что относить:
  - concept: формулировка замысла книги целиком — логлайн, центральный вопрос, тема. Не отдельные факты мира.
  - world: устройство мира — география, климат, общество, технологии, экономика, быт.
  - lore: история, мифы, происхождение, свод правил и ограничений, тайны.
  - characters: люди. Заполняй entities: имя и одна фраза о человеке, по записи на каждого.
  - items: предметы, артефакты, вещества, техника как объекты. entities заполняй так же.
  - plot: оглавление, поглавные планы, арки, матрицы раскрытия тайн, порядок событий.
  - chapters: готовая проза — сцены, написанные главы. Не планы о них.
  - skip: служебное, устаревшее, дубли, заметки «себе на память». Тело всё равно верни — автор увидит, что файл прочитан.
- entities заполняй ТОЛЬКО для characters и items. Для остальных целей оставляй пустым.
- Если файл целиком об одном — верни один фрагмент на весь файл. Дробить ради дробления не нужно.
- bookIdea заполняй только если в файле есть готовая формулировка замысла, и только если у книги её ещё нет.`;

function targetCatalogue(): string {
  return INTAKE_TARGETS.map((t) => `${t} — ${INTAKE_TARGET_LABELS[t]}`).join("\n");
}

export function buildClassifierPrompt(input: MaterialClassifierInput): string {
  const parts: string[] = [`ФАЙЛ: ${input.filename}`, ""];
  if (input.bookIdea && input.bookIdea.trim().length > 0) {
    parts.push(
      "ЗАДУМКА КНИГИ (уже есть, не заменяй её — bookIdea оставь пустым):",
      input.bookIdea.trim(),
      "",
    );
  }
  if (input.existingStages && input.existingStages.length > 0) {
    parts.push(
      "НА ЭТАПАХ УЖЕ ЛЕЖИТ (по возможности продолжай эти темы, а не дублируй их):",
      ...input.existingStages.map((s) => `- ${s}`),
      "",
    );
  }
  parts.push(
    "ЭТАПЫ (id — название):",
    targetCatalogue(),
    "",
    "СОДЕРЖИМОЕ ФАЙЛА:",
    input.content,
    "",
    "ИНСТРУКЦИЯ:",
    "Разрежь файл на фрагменты и назначь каждому этап. Тело фрагмента переноси дословно.",
  );
  return parts.join("\n");
}

const materialClassifierContract: AgentStructuredContract<
  MaterialClassifierInput,
  MaterialClassifierOutput
> = {
  agentName: "material_classifier",
  getOutputSchema: () => materialClassifierOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildClassifierPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_material_fragments",
    toolDescription:
      "Submit the author's file cut into fragments, each assigned to a book-preparation stage, with the body carried over verbatim.",
  },
};

export function registerMaterialClassifierContract(): void {
  registerAgentContract(materialClassifierContract);
}

export interface RunMaterialClassifierOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runMaterialClassifier(
  input: MaterialClassifierInput,
  options: RunMaterialClassifierOptions = {},
): Promise<MaterialClassifierOutput> {
  const { raw } = await dispatchStructured<
    MaterialClassifierInput,
    MaterialClassifierOutput
  >({
    agentName: "material_classifier",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 16000,
  });
  return raw;
}
```

- [ ] **Step 5: Экспорт и регистрация**

В `packages/agents/package.json` в `exports` после строки с `"./concept/pitch-blend"`:

```json
    "./intake/classifier": "./src/intake/classifier.ts",
```

В `packages/agents/src/bootstrap.ts` добавить импорт:

```ts
import { registerMaterialClassifierContract } from "./intake/classifier.js";
```

вызов внутри `registerAllAgentContracts()` после `registerPitchBlenderContract();`:

```ts
  registerMaterialClassifierContract();
```

и строку в докблок фазы:

```
 * Приём материала: material_classifier.
```

- [ ] **Step 6: Прогнать**

Run: `pnpm --filter @book-forge/agents test && pnpm --filter @book-forge/llm test && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/intake packages/agents/package.json packages/agents/src/bootstrap.ts packages/llm/src/types.ts packages/llm/src/router.ts
git commit -m "feat(intake): material_classifier cuts a file into stage-assigned fragments"
```

---

### Task 3: Приземление фрагментов (чистые функции сервера)

**Files:**
- Create: `apps/server/src/utils/intake-landing.ts`
- Test: `apps/server/src/utils/__tests__/intake-landing.test.ts`

**Interfaces:**
- Consumes: `IntakeFragment`, `IntakeLanded`, `StudioState`, `buildImportedMarkdownAspect`, `buildImportedEntityAspect`, `mergeAspectsIntoStage` из `@book-forge/shared`.
- Produces: `intakeRequestKey(files: Array<{ filename: string; content: string }>): string`, `landFragments(state: StudioState, fragments: IntakeFragment[], now: string): { next: StudioState; landed: IntakeLanded[]; chapterFragments: IntakeFragment[] }`, `describeExistingStages(state: StudioState): string[]`.

- [ ] **Step 1: Падающий тест**

Создать `apps/server/src/utils/__tests__/intake-landing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  intakeRequestKey,
  landFragments,
  describeExistingStages,
} from "../intake-landing.js";
import {
  emptyStudioState,
  assertStudioStateInvariants,
  type IntakeFragment,
  type StudioState,
} from "@book-forge/shared";

const NOW = "2026-09-05T10:00:00.000Z";

function frag(over: Partial<IntakeFragment> = {}): IntakeFragment {
  return { target: "world", title: "Карта", body: "Барьер делит два мира.", ...over };
}

describe("intakeRequestKey", () => {
  it("is stable regardless of file order", () => {
    const a = [{ filename: "b.md", content: "два" }, { filename: "a.md", content: "один" }];
    const b = [{ filename: "a.md", content: "один" }, { filename: "b.md", content: "два" }];
    expect(intakeRequestKey(a)).toBe(intakeRequestKey(b));
  });

  it("changes when a file's content changes", () => {
    const a = [{ filename: "a.md", content: "один" }];
    const b = [{ filename: "a.md", content: "один и ещё" }];
    expect(intakeRequestKey(a)).not.toBe(intakeRequestKey(b));
  });
});

describe("landFragments", () => {
  it("lands a markdown fragment as a reviewing draft on its stage", () => {
    const { next, landed, chapterFragments } = landFragments(emptyStudioState(), [frag()], NOW);
    const stage = next.stages.world!;
    expect(stage.aspects).toHaveLength(1);
    expect(stage.aspects[0]!.status).toBe("reviewing");
    expect(stage.aspects[0]!.finalPayload).toBeUndefined();
    expect(stage.status).toBe("in_progress");
    expect(landed).toEqual([{ target: "world", title: "Карта", kind: "aspect" }]);
    expect(chapterFragments).toEqual([]);
    expect(() => assertStudioStateInvariants(next)).not.toThrow();
  });

  it("groups several fragments for one stage and numbers them in order", () => {
    const { next } = landFragments(
      emptyStudioState(),
      [frag({ title: "Карта" }), frag({ title: "Кухня" }), frag({ target: "lore", title: "Барьер" })],
      NOW,
    );
    expect(next.stages.world!.aspects.map((a) => [a.name, a.order])).toEqual([
      ["Карта", 0], ["Кухня", 1],
    ]);
    expect(next.stages.lore!.aspects).toHaveLength(1);
  });

  it("appends after aspects a stage already has", () => {
    const state: StudioState = emptyStudioState();
    state.stages.world = {
      status: "in_progress",
      playbookGenerated: true,
      aspects: [{
        id: "old", name: "Старое", status: "accepted", order: 0, required: true,
        source: "llm", payloadKind: "markdown", variants: [], finalPayload: "текст",
      }],
    };
    const { next } = landFragments(state, [frag()], NOW);
    expect(next.stages.world!.aspects.map((a) => a.order)).toEqual([0, 1]);
    expect(next.stages.world!.aspects[0]!.id).toBe("old");
  });

  it("lands people as entity candidates, not markdown", () => {
    const { next, landed } = landFragments(
      emptyStudioState(),
      [frag({
        target: "characters", title: "Связи",
        entities: [{ name: "Нейла", summary: "Проводница." }],
      })],
      NOW,
    );
    const aspect = next.stages.characters!.aspects[0]!;
    expect(aspect.payloadKind).toBe("entity_set");
    const payload = aspect.variants[0]!.payload as { candidates: unknown[] };
    expect(payload.candidates).toHaveLength(1);
    expect(landed[0]!.kind).toBe("aspect");
    expect(() => assertStudioStateInvariants(next)).not.toThrow();
  });

  it("falls back to a markdown draft when an entity fragment carries no entities", () => {
    const { next } = landFragments(
      emptyStudioState(),
      [frag({ target: "characters", title: "Связи", entities: [] })],
      NOW,
    );
    expect(next.stages.characters!.aspects[0]!.payloadKind).toBe("markdown");
  });

  it("hands chapter fragments back untouched instead of making aspects of them", () => {
    const { next, landed, chapterFragments } = landFragments(
      emptyStudioState(),
      [frag({ target: "chapters", title: "Глава 01", body: "Караван вышел на рассвете." })],
      NOW,
    );
    expect(next.stages.chapters).toBeUndefined();
    expect(landed).toEqual([]);
    expect(chapterFragments).toHaveLength(1);
  });

  it("ignores concept and skip fragments — the route owns the idea, and skip lands nowhere", () => {
    const { next, landed } = landFragments(
      emptyStudioState(),
      [frag({ target: "concept", title: "Замысел" }), frag({ target: "skip", title: "Черновик" })],
      NOW,
    );
    expect(Object.keys(next.stages)).toEqual([]);
    expect(landed).toEqual([]);
  });

  it("leaves the incoming state untouched", () => {
    const state = emptyStudioState();
    const before = JSON.stringify(state);
    landFragments(state, [frag()], NOW);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("describeExistingStages", () => {
  it("names each stage that holds aspects, with their titles", () => {
    const state = emptyStudioState();
    state.stages.world = {
      status: "in_progress", playbookGenerated: true,
      aspects: [
        { id: "a", name: "География", status: "accepted", order: 0, required: true,
          source: "llm", payloadKind: "markdown", variants: [], finalPayload: "x" },
        { id: "b", name: "Климат", status: "pending", order: 1, required: false,
          source: "llm", payloadKind: "markdown", variants: [] },
      ],
    };
    expect(describeExistingStages(state)).toEqual(["Мир: География, Климат"]);
  });

  it("returns an empty list for a fresh book", () => {
    expect(describeExistingStages(emptyStudioState())).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-landing.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `apps/server/src/utils/intake-landing.ts`:

```ts
import { createHash } from "node:crypto";
import {
  INTAKE_TARGET_LABELS,
  buildImportedEntityAspect,
  buildImportedMarkdownAspect,
  mergeAspectsIntoStage,
  type IntakeFragment,
  type IntakeLanded,
  type StageAspect,
  type StageId,
  type StageState,
  type StudioState,
} from "@book-forge/shared";

/** Этапы, на которые интейк кладёт аспекты. `concept` идёт в задумку, а не в
 *  studio_state; `chapters` — через существующий импортёр глав; `skip` никуда. */
const ASPECT_TARGETS = ["world", "lore", "characters", "items", "plot"] as const;
type AspectTarget = (typeof ASPECT_TARGETS)[number];

function isAspectTarget(t: IntakeFragment["target"]): t is AspectTarget {
  return (ASPECT_TARGETS as readonly string[]).includes(t);
}

function emptyStage(): StageState {
  return { status: "not_started", playbookGenerated: false, aspects: [] };
}

/** Один и тот же набор файлов даёт один и тот же ключ независимо от порядка,
 *  поэтому повторное перетаскивание той же папки не создаёт дублей. */
export function intakeRequestKey(
  files: Array<{ filename: string; content: string }>,
): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    h.update(f.filename);
    h.update(" ");
    h.update(f.content);
    h.update(" ");
  }
  return h.digest("hex").slice(0, 32);
}

export interface LandFragmentsResult {
  next: StudioState;
  landed: IntakeLanded[];
  /** Главы route обрабатывает сам — у них своя таблица, а не studio_state. */
  chapterFragments: IntakeFragment[];
}

/** Раскладывает фрагменты по этапам, ничего не утверждая. Входное состояние не
 *  мутируется: результат — новый объект, который вызывающая сторона отдаёт в
 *  patchStudioState вместе с ожидаемой ревизией. */
export function landFragments(
  state: StudioState,
  fragments: IntakeFragment[],
  now: string,
): LandFragmentsResult {
  const landed: IntakeLanded[] = [];
  const chapterFragments: IntakeFragment[] = [];
  const byStage = new Map<AspectTarget, StageAspect[]>();

  for (const fragment of fragments) {
    if (fragment.target === "chapters") {
      chapterFragments.push(fragment);
      continue;
    }
    if (!isAspectTarget(fragment.target)) continue; // concept и skip
    const bucket = byStage.get(fragment.target) ?? [];
    const isEntityStage =
      fragment.target === "characters" || fragment.target === "items";
    const aspect = isEntityStage
      ? buildImportedEntityAspect(fragment, bucket.length, now) ??
        buildImportedMarkdownAspect(fragment, bucket.length, now)
      : buildImportedMarkdownAspect(fragment, bucket.length, now);
    bucket.push(aspect);
    byStage.set(fragment.target, bucket);
    landed.push({ target: fragment.target, title: fragment.title, kind: "aspect" });
  }

  const stages: StudioState["stages"] = { ...state.stages };
  for (const [target, aspects] of byStage) {
    stages[target] = mergeAspectsIntoStage(
      stages[target] ?? emptyStage(),
      aspects,
      now,
    );
  }

  return { next: { ...state, stages }, landed, chapterFragments };
}

/** Короткая опись того, что уже лежит на этапах, для промпта классификатора. */
export function describeExistingStages(state: StudioState): string[] {
  const out: string[] = [];
  for (const target of ASPECT_TARGETS) {
    const stage = state.stages[target as StageId];
    if (!stage || stage.aspects.length === 0) continue;
    const names = stage.aspects.map((a) => a.name).join(", ");
    out.push(`${INTAKE_TARGET_LABELS[target]}: ${names}`);
  }
  return out;
}
```

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/intake-landing.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/utils/intake-landing.ts apps/server/src/utils/__tests__/intake-landing.test.ts
git commit -m "feat(intake): land classified fragments onto stages without accepting anything"
```

---

### Task 4: Переиспользуемая вставка глав

**Files:**
- Modify: `apps/server/src/routes/import-export.ts`
- Test: `apps/server/src/routes/__tests__/import-export.test.ts`

**Interfaces:**
- Produces: `insertChapters(sqlite, hasVec, bookId, chapters: ParsedChapter[]): Array<{ chapterId: number; title: string; words: number }>` — экспортируется из `import-export.ts`, содержит транзакцию вставки и лучшее-усилие индексацию, которые сегодня встроены в обработчик маршрута. Обработчик `POST /books/:id/import` после правки вызывает её и ничего не теряет.

- [ ] **Step 1: Тест, закрепляющий поведение маршрута до и после**

В `apps/server/src/routes/__tests__/import-export.test.ts` добавить:

```ts
  it("importing twice appends chapters instead of renumbering from scratch", async () => {
    const id = await createBook();
    await sendJson(t.app, `/api/books/${id}/import`, "POST", {
      filename: "часть1.md",
      content: "# Глава A\nтекст A\n\n# Глава B\nтекст B",
    });
    const second = await sendJson<{ created: Array<{ title: string }> }>(
      t.app, `/api/books/${id}/import`, "POST",
      { filename: "часть2.md", content: "# Глава C\nтекст C" },
    );
    expect(second.created.map((c) => c.title)).toEqual(["Глава C"]);
    const chapters = await sendJson<Array<{ title: string; orderIndex: number }>>(
      t.app, `/api/books/${id}/chapters`, "GET",
    );
    expect(chapters.map((c) => c.title)).toEqual(["Глава A", "Глава B", "Глава C"]);
    expect(chapters.map((c) => c.orderIndex)).toEqual([10, 20, 30]);
  });
```

(`createBook` уже есть в этом файле; если нет — добавить как в `concept-pitches.test.ts`.)

- [ ] **Step 2: Прогнать — тест должен пройти на текущем коде**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/import-export.test.ts`
Expected: PASS. Это страховочная сеть: она обязана оставаться зелёной после извлечения функции. Если она красная уже сейчас — остановиться и доложить, значит текущее поведение не такое, как думает план.

- [ ] **Step 3: Извлечь функцию**

В `apps/server/src/routes/import-export.ts` вынести тело вставки из обработчика в экспортируемую функцию, объявленную над `createImportExportRoute`:

```ts
export interface InsertedChapter {
  chapterId: number;
  title: string;
  words: number;
}

/** Вставка разобранных глав в конец книги. Транзакция охватывает только записи
 *  в БД; индексация чанков идёт после неё и намеренно best-effort — сбой
 *  поиска не должен отменять уже сохранённый текст автора. */
export function insertChapters(
  sqlite: DatabaseType,
  hasVec: boolean,
  bookId: number,
  chapters: ParsedChapter[],
): InsertedChapter[] {
  // ← сюда переносится код из текущего обработчика: расчёт nextOrder,
  //   подготовленные запросы insertChapter / insertVersion, транзакция,
  //   UPDATE chapters SET current_version_id, bumpBook, затем блок индексации
  //   с try/catch и UPDATE chapters SET memory_version_id.
  //   Ничего не меняем по существу — только переносим и возвращаем created.
}
```

Обработчик `r.post("/books/:id/import", ...)` после проверки расширения и `parseChapters` становится:

```ts
    const created = insertChapters(sqlite, hasVec, id, chapters);
    return c.json({ created });
```

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/import-export.test.ts && pnpm typecheck && pnpm test`
Expected: PASS, включая добавленный в шаге 1 тест — поведение маршрута не изменилось.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/import-export.ts apps/server/src/routes/__tests__/import-export.test.ts
git commit -m "refactor(import): extract chapter insertion so intake can reuse it"
```

---

### Task 5: Маршрут `POST /books/:id/intake`

**Files:**
- Modify: `apps/server/src/routes/studio.ts`
- Create: `apps/server/src/routes/__tests__/intake.test.ts`

**Interfaces:**
- Consumes: `runMaterialClassifier` (`@book-forge/agents/intake/classifier`), `landFragments`, `describeExistingStages`, `intakeRequestKey` (`../utils/intake-landing.js`), `insertChapters`, `parseChapters` (`./import-export.js`).
- Produces HTTP: `POST /api/books/:id/intake`, тело `{ files: Array<{ filename: string; content: string }> }` (1–50 файлов, каждый ≤ 400000 символов). Ответ `200 { summary: IntakeSummaryRow[]; ideaSet: boolean; chapters: InsertedChapter[]; failures: Array<{ filename: string; message: string }>; revision: number }`. `404` неизвестная книга; `400` пустой список или файл без содержимого; `409` при конфликте ревизии studio_state. Повторная отправка того же набора возвращает прошлый ответ, не создавая дублей.

- [ ] **Step 1: Падающий тест**

Создать `apps/server/src/routes/__tests__/intake.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// studio.ts imports the runner at module load — mock before importing the app.
vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookConcept, StudioState } from "@book-forge/shared";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runMaterialClassifier).mockReset();
});
afterEach(() => t.cleanup());

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Приём" });
  return r.id;
}

interface IntakeResponse {
  summary: Array<{ target: string; label: string; count: number; titles: string[] }>;
  ideaSet: boolean;
  chapters: Array<{ chapterId: number; title: string; words: number }>;
  failures: Array<{ filename: string; message: string }>;
  revision: number;
}

const WORLD_FILE = { filename: "Карта.md", content: "# Карта\nБарьер делит два мира." };
const PEOPLE_FILE = { filename: "Связи.md", content: "# Связи\nНейла — проводница." };

describe("POST /api/books/:id/intake", () => {
  it("404 for an unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/intake", "POST", { files: [WORLD_FILE] });
    expect(r.status).toBe(404);
  });

  it("400 for an empty file list", async () => {
    const id = await createBook();
    expect((await send(t.app, `/api/books/${id}/intake`, "POST", { files: [] })).status).toBe(400);
    expect(vi.mocked(runMaterialClassifier)).not.toHaveBeenCalled();
  });

  it("lands markdown fragments as reviewing drafts and reports what went where", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "world", title: "Карта", body: "Барьер делит два мира.", note: "география" },
        { target: "lore", title: "Барьер", body: "Барьер поставили древние." },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 1], ["lore", 1]]);
    expect(out.failures).toEqual([]);

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    const world = state.stages.world!;
    expect(world.aspects[0]!.status).toBe("reviewing");
    expect(world.aspects[0]!.finalPayload).toBeUndefined();
    expect(world.aspects[0]!.source).toBe("import");
    expect(world.aspects[0]!.variants[0]!.payload).toBe("Барьер делит два мира.");
    expect(state.revision).toBe(out.revision);
  });

  it("calls the classifier once per file and passes the book's idea along", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({ fragments: [] });
    const id = await createBook();
    const concept = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", { ...concept, idea: "Шестеро героев из двух миров." });
    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE, PEOPLE_FILE] });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(2);
    const names = vi.mocked(runMaterialClassifier).mock.calls.map((c) => c[0].filename).sort();
    expect(names).toEqual(["Карта.md", "Связи.md"]);
    expect(vi.mocked(runMaterialClassifier).mock.calls[0]![0].bookIdea).toBe("Шестеро героев из двух миров.");
  });

  it("writes the idea when the book has none and the classifier found one", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [],
      bookIdea: "Шестеро героев из двух враждующих миров.",
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.ideaSet).toBe(true);
    const c = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    expect(c.idea).toBe("Шестеро героев из двух враждующих миров.");
  });

  it("never overwrites an idea the author already has", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({ fragments: [], bookIdea: "Другая задумка" });
    const id = await createBook();
    const concept = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", { ...concept, idea: "Моя задумка" });
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.ideaSet).toBe(false);
    expect((await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET")).idea).toBe("Моя задумка");
  });

  it("turns chapter fragments into real chapters", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "chapters", title: "Глава 01", body: "Караван вышел на рассвете." },
        { target: "chapters", title: "Глава 02", body: "Песок слышал металл." },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [{ filename: "черновик.md", content: "текст" }],
    });
    expect(out.chapters.map((c) => c.title)).toEqual(["Глава 01", "Глава 02"]);
    const chapters = await sendJson<Array<{ title: string }>>(t.app, `/api/books/${id}/chapters`, "GET");
    expect(chapters.map((c) => c.title)).toEqual(["Глава 01", "Глава 02"]);
  });

  it("reports a per-file failure and still lands the files that worked", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce({ fragments: [{ target: "world", title: "Карта", body: "Барьер." }] })
      .mockRejectedValueOnce(new Error("LLM failure"));
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE, PEOPLE_FILE],
    });
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
    expect(out.failures).toEqual([{ filename: "Связи.md", message: "LLM failure" }]);
  });

  it("replays the same answer when the same files are dropped twice", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const id = await createBook();
    const first = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    const again = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(again).toEqual(first);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages.world!.aspects).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake.test.ts`
Expected: FAIL — 404 на неизвестном маршруте.

- [ ] **Step 3: Реализовать маршрут**

В `apps/server/src/routes/studio.ts` добавить импорты:

```ts
import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import {
  describeExistingStages,
  intakeRequestKey,
  landFragments,
} from "../utils/intake-landing.js";
import { insertChapters } from "./import-export.js";
import { summarizeIntake, type IntakeLanded } from "@book-forge/shared";
```

схему тела рядом с остальными:

```ts
const intakeBodySchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(400),
        content: z.string().min(1).max(400_000),
      }),
    )
    .min(1)
    .max(50),
});
```

и маршрут после `/concept/unlock`:

```ts
  r.post("/books/:id/intake", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = intakeBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    let state;
    try {
      concept = repo.loadConcept(id);
      state = repo.loadStudioState(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    // Повторное перетаскивание той же папки не должно удваивать черновики.
    const requestKey = intakeRequestKey(parsed.data.files);
    const prior = sqlite
      .prepare(
        `SELECT payload FROM studio_events
         WHERE book_id = ? AND event_type = 'import_merge'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(id) as { payload: string } | undefined;
    if (prior) {
      try {
        const p = JSON.parse(prior.payload) as { note?: string; after?: unknown };
        if (p.note === requestKey && p.after) return c.json(p.after);
      } catch {
        /* повреждённое старое событие — просто разбираем заново */
      }
    }

    const existingStages = describeExistingStages(state);
    const idea = (concept.idea ?? "").trim();
    const failures: Array<{ filename: string; message: string }> = [];
    const fragments = [];
    let foundIdea: string | undefined;

    // Последовательно, а не пачкой: один файл — один вызов, и падение одного
    // не уносит остальные.
    for (const file of parsed.data.files) {
      try {
        const out = await runMaterialClassifier({
          filename: file.filename,
          content: file.content,
          ...(idea.length > 0 ? { bookIdea: idea } : {}),
          ...(existingStages.length > 0 ? { existingStages } : {}),
        });
        fragments.push(...out.fragments);
        if (foundIdea === undefined && out.bookIdea && out.bookIdea.trim().length > 0) {
          foundIdea = out.bookIdea.trim();
        }
      } catch (e) {
        failures.push({
          filename: file.filename,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const now = new Date().toISOString();
    const { next, landed, chapterFragments } = landFragments(state, fragments, now);

    let revision = state.revision;
    if (landed.length > 0) {
      try {
        const saved = repo.patchStudioState(id, {
          expectedRevision: state.revision,
          next,
        });
        revision = saved.revision;
      } catch (e) {
        if (e instanceof StudioConflictError) {
          return c.json(
            { error: "revision_conflict", details: { expected: state.revision } },
            409,
          );
        }
        throw e;
      }
    }

    const chapters = chapterFragments.length
      ? insertChapters(
          sqlite,
          hasVec,
          id,
          chapterFragments.map((f) => ({ title: f.title, body: f.body })),
        )
      : [];

    let ideaSet = false;
    if (idea.length === 0 && foundIdea !== undefined) {
      repo.patchConcept(id, { ...concept, idea: foundIdea });
      ideaSet = true;
    }

    const allLanded: IntakeLanded[] = [
      ...(ideaSet ? [{ target: "concept" as const, title: "Задумка", kind: "idea" as const }] : []),
      ...landed,
      ...chapters.map((ch) => ({
        target: "chapters" as const,
        title: ch.title,
        kind: "chapter" as const,
      })),
    ];

    const response = {
      summary: summarizeIntake(allLanded),
      ideaSet,
      chapters,
      failures,
      revision,
    };

    repo.events.log({
      bookId: id,
      eventType: "import_merge",
      payload: { note: requestKey, after: response },
      revisionBefore: state.revision,
      revisionAfter: revision,
    });

    return c.json(response);
  });
```

`createStudioRoute` должен принимать `hasVec` — если сегодня он его не получает, добавить параметр `hasVec: boolean` в сигнатуру и передать его из `app.ts` там, где маршрут монтируется, тем же способом, каким его получает `createImportExportRoute`.

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/intake.test.ts && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/intake.test.ts apps/server/src/app.ts
git commit -m "feat(intake): one route reads dropped files and lands them across the stages"
```

---

### Task 6: Зона перетаскивания и сводка в вебе

**Files:**
- Create: `apps/web/src/components/studio/intake/DropZone.tsx`, `IntakeSummary.tsx`
- Test: `apps/web/src/components/studio/intake/__tests__/DropZone.test.tsx`, `IntakeSummary.test.tsx`
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/styles/library-warm.css`

**Interfaces:**
- Produces в `api`: `intake(bookId: number, files: Array<{ filename: string; content: string }>) => Promise<IntakeResponse>` где `IntakeResponse = { summary: IntakeSummaryRow[]; ideaSet: boolean; chapters: Array<{ chapterId: number; title: string; words: number }>; failures: Array<{ filename: string; message: string }>; revision: number }`.
- `DropZone` props: `{ onFiles: (files: File[]) => void; busy: boolean; disabled?: boolean }`. Принимает перетаскивание и выбор через диалог, фильтрует по расширению, отдаёт наверх только годные файлы.
- `IntakeSummary` props: `{ result: IntakeResponse; bookId: number; onDismiss: () => void }`. Показывает, что и куда легло, ссылками на этапы.

- [ ] **Step 1: Падающие тесты**

Создать `apps/web/src/components/studio/intake/__tests__/DropZone.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropZone, ACCEPTED_EXTENSIONS } from "../DropZone";

function file(name: string, text = "содержимое"): File {
  return new File([text], name, { type: "text/plain" });
}

function drop(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

describe("DropZone", () => {
  it("accepts the extensions the intake can read", () => {
    expect([...ACCEPTED_EXTENSIONS]).toEqual([".md", ".markdown", ".txt", ".docx"]);
  });

  it("hands dropped files up", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md"), file("Связи.md")]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(["Карта.md", "Связи.md"]);
  });

  it("filters out extensions it cannot read and says so", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md"), file("схема.png")]);
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(["Карта.md"]);
    expect(screen.getByRole("status")).toHaveTextContent("схема.png");
  });

  it("does not call up when nothing usable was dropped", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("схема.png")]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("схема.png");
  });

  it("ignores drops while busy", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={true} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md")]);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
```

Создать `apps/web/src/components/studio/intake/__tests__/IntakeSummary.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { IntakeSummary } from "../IntakeSummary";

const RESULT = {
  summary: [
    { target: "world" as const, label: "Мир", count: 2, titles: ["Карта", "Кухня"] },
    { target: "chapters" as const, label: "Готовые главы", count: 1, titles: ["Глава 01"] },
  ],
  ideaSet: true,
  chapters: [{ chapterId: 1, title: "Глава 01", words: 120 }],
  failures: [{ filename: "битый.md", message: "LLM failure" }],
  revision: 4,
};

function renderSummary() {
  const onDismiss = vi.fn();
  render(
    <MemoryRouter>
      <IntakeSummary result={RESULT} bookId={3} onDismiss={onDismiss} />
    </MemoryRouter>,
  );
  return onDismiss;
}

describe("IntakeSummary", () => {
  it("shows every stage that received material, with its titles", () => {
    renderSummary();
    expect(screen.getByText("Мир")).toBeInTheDocument();
    expect(screen.getByText(/Карта/)).toBeInTheDocument();
    expect(screen.getByText(/Кухня/)).toBeInTheDocument();
  });

  it("links a stage row to that stage", () => {
    renderSummary();
    expect(screen.getByRole("link", { name: /Мир/ })).toHaveAttribute("href", "/books/3/studio/world");
  });

  it("says plainly that nothing was approved automatically", () => {
    renderSummary();
    expect(screen.getByText(/ничего не утверждено/i)).toBeInTheDocument();
  });

  it("names the files it could not read", () => {
    renderSummary();
    expect(screen.getByRole("alert")).toHaveTextContent("битый.md");
  });

  it("dismisses", async () => {
    const onDismiss = renderSummary();
    await userEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/intake`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: API-клиент**

В `apps/web/src/api/client.ts` добавить тип и метод рядом со студийными:

```ts
export interface IntakeResponse {
  summary: IntakeSummaryRow[];
  ideaSet: boolean;
  chapters: Array<{ chapterId: number; title: string; words: number }>;
  failures: Array<{ filename: string; message: string }>;
  revision: number;
}
```

(`IntakeSummaryRow` добавить в импорт типов из `@book-forge/shared`.)

```ts
  /** Файлы уже прочитаны в текст на стороне браузера; сервер сам решает,
   *  что куда положить. */
  intake: (bookId: number, files: Array<{ filename: string; content: string }>) =>
    req<IntakeResponse>(`/api/books/${bookId}/intake`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
```

- [ ] **Step 4: `DropZone`**

Создать `apps/web/src/components/studio/intake/DropZone.tsx`:

```tsx
import { useRef, useState, type DragEvent } from "react";

export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".txt", ".docx"] as const;

interface Props {
  onFiles: (files: File[]) => void;
  busy: boolean;
  disabled?: boolean;
}

function isAccepted(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Приём материалов автора: перетаскивание папки или выбор файлов диалогом.
 *  Чтение и отправку делает родитель — здесь только отбор годных файлов. */
export function DropZone({ onFiles, busy, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  function take(list: FileList | File[] | null) {
    if (busy || disabled || !list) return;
    const all = Array.from(list);
    const good = all.filter((f) => isAccepted(f.name));
    setRejected(all.filter((f) => !isAccepted(f.name)).map((f) => f.name));
    if (good.length > 0) onFiles(good);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files ?? null);
  }

  return (
    <div className="intake-drop-wrap">
      <div
        className={"intake-drop" + (over ? " is-over" : "") + (busy ? " is-busy" : "")}
        aria-label="Перетащите файлы с материалами"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className="intake-drop-title">
          {busy ? "Разбираем материалы…" : "Перетащите сюда заметки и черновики"}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Файлы {ACCEPTED_EXTENSIONS.join(", ")}. Их можно бросить папкой — прочитается всё
          подходящее. Ничего не утверждается: всё ляжет черновиками на этапы.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          Выбрать файлы
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
      </div>
      {rejected.length > 0 && (
        <p role="status" className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Пропущено, читать такое пока не умею: {rejected.join(", ")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `IntakeSummary`**

Создать `apps/web/src/components/studio/intake/IntakeSummary.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { IntakeTarget } from "@book-forge/shared";
import type { IntakeResponse } from "@/api/client";

interface Props {
  result: IntakeResponse;
  bookId: number;
  onDismiss: () => void;
}

function targetHref(bookId: number, target: IntakeTarget): string | undefined {
  if (target === "concept") return `/books/${bookId}/studio`;
  if (target === "chapters") return `/books/${bookId}/studio/chapters`;
  if (target === "skip") return undefined;
  return `/books/${bookId}/studio/${target}`;
}

/** Что и куда легло. Единственная задача — чтобы автор увидел результат и знал,
 *  что решение осталось за ним. */
export function IntakeSummary({ result, bookId, onDismiss }: Props) {
  return (
    <div className="card intake-summary" aria-label="Что легло из материалов">
      <h3>Материалы разобраны</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Всё легло черновиками — ничего не утверждено. Откройте этап и примите то, что подходит.
      </p>

      {result.summary.length === 0 ? (
        <p className="muted">В файлах не нашлось ничего, что ложится на этапы.</p>
      ) : (
        <ul className="intake-summary-list">
          {result.summary.map((row) => {
            const href = targetHref(bookId, row.target);
            return (
              <li key={row.target}>
                <span className="intake-summary-head">
                  {href ? <Link to={href}>{row.label}</Link> : row.label}
                  <span className="pill tabular">{row.count}</span>
                </span>
                <span className="muted">{row.titles.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}

      {result.failures.length > 0 && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13 }}>
          Не удалось разобрать: {result.failures.map((f) => f.filename).join(", ")}. Их можно
          перетащить ещё раз.
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Стили**

В конец `apps/web/src/styles/library-warm.css`:

```css
/* ── Приём материалов ──────────────────────────────────────────────────── */
.intake-drop { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 20px; border: 1px dashed var(--color-border-strong); border-radius: 8px; background: var(--color-surface-2); transition: border-color .12s, background .12s; }
.intake-drop.is-over { border-color: var(--color-brass); background: var(--color-brass-tint); }
.intake-drop.is-busy { opacity: .7; }
.intake-drop-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--color-text-strong); }
.intake-summary-list { display: grid; gap: 10px; margin: 12px 0; padding: 0; list-style: none; }
.intake-summary-list li { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--color-brass-soft); }
.intake-summary-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
```

- [ ] **Step 7: Прогнать**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/intake && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/studio/intake apps/web/src/api/client.ts apps/web/src/styles/library-warm.css
git commit -m "feat(web): a drop zone for author material and a summary of where it landed"
```

---

### Task 7: Панель приёма на странице студии

**Files:**
- Create: `apps/web/src/components/studio/intake/IntakePanel.tsx`
- Test: `apps/web/src/components/studio/intake/__tests__/IntakePanel.test.tsx`
- Modify: `apps/web/src/pages/StudioPage.tsx`, `apps/web/src/pages/StudioPage.test.tsx`

**Interfaces:**
- `IntakePanel` props: `{ bookId: number; onIntake: () => void }`. Держит чтение файлов, вызов `api.intake`, состояние занятости и ошибку, показывает `DropZone` до и `IntakeSummary` после.
- `StudioPage` монтирует `<IntakePanel bookId={bookId} onIntake={...} />` отдельной карточкой между блоком прогресса и карточкой замысла; `onIntake` перезагружает концепт, состояние студии, предупреждения и главы.

- [ ] **Step 1: Падающий тест**

Создать `apps/web/src/components/studio/intake/__tests__/IntakePanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IntakePanel } from "../IntakePanel";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({ api: { intake: vi.fn() } }));
const m = vi.mocked(api);

const OK = {
  summary: [{ target: "world" as const, label: "Мир", count: 1, titles: ["Карта"] }],
  ideaSet: false,
  chapters: [],
  failures: [],
  revision: 2,
};

function file(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByLabelText("Перетащите файлы с материалами"), {
    dataTransfer: { files, types: ["Files"] },
  });
}

function renderPanel() {
  const onIntake = vi.fn();
  render(
    <MemoryRouter>
      <IntakePanel bookId={3} onIntake={onIntake} />
    </MemoryRouter>,
  );
  return onIntake;
}

describe("IntakePanel", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads dropped files to text and sends filename plus content", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "Барьер делит два мира.")]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    expect(m.intake).toHaveBeenCalledWith(3, [
      { filename: "Карта.md", content: "Барьер делит два мира." },
    ]);
  });

  it("shows the summary afterwards and tells the page to reload", async () => {
    m.intake.mockResolvedValue(OK as never);
    const onIntake = renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByText("Материалы разобраны")).toBeInTheDocument());
    expect(onIntake).toHaveBeenCalled();
    expect(screen.queryByLabelText("Перетащите файлы с материалами")).toBeNull();
  });

  it("returns to the drop zone when the summary is dismissed", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => screen.getByText("Материалы разобраны"));
    fireEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("surfaces a failed request and keeps the drop zone", async () => {
    m.intake.mockRejectedValue(new Error("offline"));
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/intake/__tests__/IntakePanel.test.tsx`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `IntakePanel`**

Создать `apps/web/src/components/studio/intake/IntakePanel.tsx`:

```tsx
import { useState } from "react";
import { api, type IntakeResponse } from "@/api/client";
import { DropZone } from "./DropZone";
import { IntakeSummary } from "./IntakeSummary";

interface Props {
  bookId: number;
  onIntake: () => void;
}

/** Чтение файлов и один вызов приёма. Панель ничего не решает сама: результат
 *  показывается автору, а страница перезагружает этапы. */
export function IntakePanel({ bookId, onIntake }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResponse | null>(null);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({ filename: f.name, content: await f.text() })),
      );
      const out = await api.intake(bookId, payload);
      setResult(out);
      onIntake();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <IntakeSummary result={result} bookId={bookId} onDismiss={() => setResult(null)} />
    );
  }

  return (
    <div className="card" aria-label="Приём материалов">
      <DropZone onFiles={(f) => void handleFiles(f)} busy={busy} />
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Подключить в `StudioPage`**

В `apps/web/src/pages/StudioPage.tsx` добавить импорт:

```tsx
import { IntakePanel } from "@/components/studio/intake/IntakePanel";
```

и вставить между блоком прогресса (`.card.prog-block`) и `<WarningsFeed …>`:

```tsx
        <IntakePanel bookId={bookId} onIntake={() => void reload()} />
```

где `reload` — вынесенная из существующего `useEffect` функция загрузки (`api.getBook`, `api.listChapters`, затем `Promise.all([getConcept, getStudioState, getStudioWarnings])`). Если сегодня загрузка написана прямо внутри `useEffect`, извлечь её в `async function reload()` в теле компонента и вызывать из эффекта — тело не меняется, меняется только место объявления.

В `apps/web/src/pages/StudioPage.test.tsx` добавить в мок `@/api/client`:

```ts
    intake: vi.fn(),
```

- [ ] **Step 5: Прогнать**

Run: `pnpm --filter @book-forge/web test && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/studio/intake/IntakePanel.tsx apps/web/src/components/studio/intake/__tests__/IntakePanel.test.tsx apps/web/src/pages/StudioPage.tsx apps/web/src/pages/StudioPage.test.tsx
git commit -m "feat(web): the studio hub takes a folder of author material"
```

---

### Task 8: Импортированный черновик виден как таковой

**Files:**
- Modify: `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx`
- Test: `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx`

**Interfaces:** ничего нового не экспортируется. `AspectRunner` показывает у аспекта с `source === "import"` пометку «из ваших материалов» и не предлагает генерировать варианты для него, пока автор не отклонит импортированный.

- [ ] **Step 1: Падающий тест**

В `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx` добавить:

```tsx
  it("marks an aspect that came from the author's own material", () => {
    const stage = stageWith({
      id: "imported",
      name: "Карта",
      status: "reviewing",
      order: 0,
      required: false,
      source: "import",
      payloadKind: "markdown",
      variants: [{
        id: "v1", label: "из ваших материалов", payloadKind: "markdown",
        payload: "Барьер делит два мира.", status: "generated",
        editSource: "manual", generatedAt: "2026-09-05T10:00:00.000Z",
      }],
    });
    renderRunner(stage);
    expect(screen.getByText("из ваших материалов")).toBeInTheDocument();
    expect(screen.getByText("Барьер делит два мира.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Принять/ })).toBeEnabled();
  });
```

(`stageWith` и `renderRunner` — существующие хелперы этого файла; если их нет, собрать `StageState` литералом по образцу соседних тестов.)

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx`
Expected: FAIL — пометки нет.

- [ ] **Step 3: Реализовать**

В `AspectRunner.tsx` там, где рендерится заголовок аспекта, добавить рядом с названием:

```tsx
        {aspect.source === "import" && (
          <span className="pill pill-brass">из ваших материалов</span>
        )}
```

- [ ] **Step 4: Прогнать**

Run: `pnpm --filter @book-forge/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/AspectRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx
git commit -m "feat(web): show which drafts came from the author's own material"
```

---

### Task 9: Чтение `.docx`

**Files:**
- Create: `apps/server/src/utils/docx.ts`
- Test: `apps/server/src/utils/__tests__/docx.test.ts`
- Modify: `apps/server/src/routes/studio.ts` (тело `intakeBodySchema`), `apps/web/src/components/studio/intake/IntakePanel.tsx`

**Interfaces:**
- Produces: `docxToPlainText(bytes: Uint8Array): Promise<string>` — распаковывает `word/document.xml` через jszip и возвращает текст, где `</w:p>` становится переводом строки. Тело запроса приёма расширяется: у файла может быть `contentBase64` вместо `content`, и сервер сам превращает его в текст.

- [ ] **Step 1: Падающий тест**

Создать `apps/server/src/utils/__tests__/docx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxToPlainText } from "../docx.js";

async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return await zip.generateAsync({ type: "uint8array" });
}

describe("docxToPlainText", () => {
  it("returns one line per paragraph", async () => {
    const bytes = await makeDocx(["Первый абзац.", "Второй абзац."]);
    expect(await docxToPlainText(bytes)).toBe("Первый абзац.\nВторой абзац.");
  });

  it("joins runs inside one paragraph without a break", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Барьер </w:t></w:r><w:r><w:t>делит мир.</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await docxToPlainText(bytes)).toBe("Барьер делит мир.");
  });

  it("unescapes XML entities", async () => {
    const bytes = await makeDocx(["Вода &amp; песок &lt;два мира&gt;"]);
    expect(await docxToPlainText(bytes)).toBe("Вода & песок <два мира>");
  });

  it("throws a clear error when the archive is not a .docx", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "не документ");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(docxToPlainText(bytes)).rejects.toThrow(/word\/document\.xml/);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/docx.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `apps/server/src/utils/docx.ts`:

```ts
import JSZip from "jszip";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/** Достаёт текст из .docx без новых зависимостей: .docx — это zip, а весь текст
 *  лежит в word/document.xml. Абзац `w:p` становится строкой, прогоны `w:t`
 *  внутри абзаца склеиваются. Форматирование намеренно теряется — интейку
 *  нужен текст, а не вёрстка. */
export async function docxToPlainText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) {
    throw new Error("not a .docx: word/document.xml is missing");
  }
  const xml = await entry.async("string");
  const paragraphs = xml.split(/<\/w:p>/).map((chunk) => {
    const runs = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1] ?? "");
    return unescapeXml(runs.join(""));
  });
  return paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n");
}
```

- [ ] **Step 4: Принять base64 в маршруте**

В `apps/server/src/routes/studio.ts` заменить схему файла:

```ts
const intakeFileSchema = z
  .object({
    filename: z.string().trim().min(1).max(400),
    content: z.string().min(1).max(400_000).optional(),
    /** .docx приходит байтами — сервер сам достанет из него текст. */
    contentBase64: z.string().min(1).max(8_000_000).optional(),
  })
  .refine((f) => f.content !== undefined || f.contentBase64 !== undefined, {
    message: "content or contentBase64 required",
  });

const intakeBodySchema = z.object({
  files: z.array(intakeFileSchema).min(1).max(50),
});
```

и перед циклом классификации превращать файлы в текст:

```ts
    const readable: Array<{ filename: string; content: string }> = [];
    for (const f of parsed.data.files) {
      if (f.content !== undefined) {
        readable.push({ filename: f.filename, content: f.content });
        continue;
      }
      try {
        const text = await docxToPlainText(Buffer.from(f.contentBase64!, "base64"));
        if (text.trim().length === 0) throw new Error("файл пуст");
        readable.push({ filename: f.filename, content: text });
      } catch (e) {
        failures.push({
          filename: f.filename,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
```

Ключ идемпотентности считать по `readable`, а не по исходному телу, и дальше в цикле классификации итерироваться по `readable`. Объявление `failures` поднять выше этого блока.

- [ ] **Step 5: Отправлять base64 из веба**

В `IntakePanel.tsx` заменить построение полезной нагрузки:

```ts
      const payload = await Promise.all(
        files.map(async (f) =>
          f.name.toLowerCase().endsWith(".docx")
            ? {
                filename: f.name,
                contentBase64: btoa(
                  String.fromCharCode(...new Uint8Array(await f.arrayBuffer())),
                ),
              }
            : { filename: f.name, content: await f.text() },
        ),
      );
```

и расширить тип аргумента `api.intake` в `client.ts`:

```ts
  intake: (
    bookId: number,
    files: Array<{ filename: string; content?: string; contentBase64?: string }>,
  ) =>
```

Добавить в `IntakePanel.test.tsx` случай:

```tsx
  it("sends a .docx as base64 rather than as text", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    const docx = new File([new Uint8Array([80, 75, 3, 4])], "черновик.docx");
    drop([docx]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    const sent = m.intake.mock.calls[0]![1][0] as { filename: string; contentBase64?: string };
    expect(sent.filename).toBe("черновик.docx");
    expect(typeof sent.contentBase64).toBe("string");
  });
```

- [ ] **Step 6: Прогнать**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/utils/docx.ts apps/server/src/utils/__tests__/docx.test.ts apps/server/src/routes/studio.ts apps/web/src/components/studio/intake apps/web/src/api/client.ts
git commit -m "feat(intake): read .docx without a new dependency"
```

---

### Task 10: Документация и приёмка на настоящем корпусе

**Files:**
- Modify: `CLAUDE.md`
- Проверка на реальном каталоге `import/` (11 файлов, ~104 КБ)

- [ ] **Step 1: Обновить `CLAUDE.md`**

В разделе **Studio workflow**, после абзаца «Замысел», добавить:

```markdown
**Приём материала (2026-09-05, фаза 2 конвейера):** `POST /books/:id/intake` принимает пачку файлов (`.md/.markdown/.txt` текстом, `.docx` как `contentBase64` — распаковывается `docxToPlainText` на jszip, новых зависимостей нет). На каждый файл идёт один вызов агента `material_classifier`, который режет его на фрагменты и приписывает каждому цель из `INTAKE_TARGETS` (`packages/shared/src/intake.ts`). Приземление — `landFragments` ([utils/intake-landing.ts](apps/server/src/utils/intake-landing.ts)): мир/лор/сюжет ложатся аспектами `payloadKind: "markdown"`, персонажи и предметы — `entity_set` с кандидатами `proposed`, готовые главы идут через `insertChapters` из import-export, задумка попадает в `concept.idea` только если её там ещё нет. **Ничего не утверждается автоматически:** аспект приходит `status: "reviewing"`, `source: "import"`, без `finalPayload`, с одним вариантом `generated` — то самое состояние, из которого `AspectRunner` принимает одной кнопкой. Повторное перетаскивание того же набора возвращает прошлый ответ по ключу в событии `import_merge`. Миграции нет: `payloadKind: "import_candidate"`, `source: "import"` и тип события `import_merge` были объявлены в схеме с самого начала.
```

В списке subscription-агентов в **Locked decisions** добавить `material_classifier`.

- [ ] **Step 2: Прогон на настоящем корпусе**

Запустить `pnpm dev`, создать книгу из задумки, перетащить все файлы каталога `import/` в зону приёма на странице студии.

Ожидаемое (это и есть критерий приёмки фазы из спецификации):
- задумка заполнена логлайном из `00_Оглавление-книги-1.md`, если книга создавалась без неё;
- «Мир» содержит черновики из `Карта-и-маршруты`, `Пищевая-экономика`, `Повседневные-блюда`, `Связь-и-переходы`;
- «Лор» — из `Происхождение-барьера`, `Ограничения-и-цена-технологий`, `03_Тайны-и-пазлы`;
- «Персонажи» — кандидаты из `Связи-и-конфликты`;
- «План книги» — черновик из `00_Оглавление` и `05_Матрица-раскрытия-тайн`;
- ни один этап не показан «готово», все черновики ждут принятия;
- повторное перетаскивание того же набора не создаёт дублей.

Записать фактический результат: сколько фрагментов, куда легли, что классификатор отнёс не туда. Расхождения по одному-двум файлам — это настройка промпта, а не дефект кода; расхождение по большинству — дефект.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record how author material enters the studio"
```

---

## Self-review

**Покрытие спецификации (раздел 6, фаза 2):** drop-зона на входе — Task 6, 7 (на странице студии; отдельная зона на каждом этапе намеренно не делается, см. ниже); чтение `.md/.txt/.docx` — Task 6, 9; агент-классификатор — Task 2; раскладка по этапам — Task 1, 3, 5; главы через существующий `parseChapters` — Task 4, 5; «ничего не утверждено автоматически» — закреплено тестами в Task 1 (`status: "reviewing"`, `finalPayload` undefined), Task 3 и Task 5; каталог `import/` за один шаг — Task 10.

**Сознательные сужения против спецификации.** Спека говорит «drop-зона на входе и на этапах»; план ставит одну зону на странице студии. Причина: классификатор сам решает, куда что положить, поэтому зона на конкретном этапе создавала бы ложное обещание «сюда попадёт только мир». Зона на полке (создание книги сразу с материалами) тоже отложена — она требует создавать книгу до того, как есть задумка, и это отдельное решение. Оба сужения стоит вынести на подтверждение автору перед началом работы.

**Согласованность имён:** `IntakeFragment`/`IntakeTarget`/`IntakeLanded`/`IntakeSummaryRow` (Task 1) используются в Task 2, 3, 5, 6; `landFragments`/`describeExistingStages`/`intakeRequestKey` (Task 3) — в Task 5; `insertChapters`/`InsertedChapter` (Task 4) — в Task 5; `runMaterialClassifier` (Task 2) — в Task 5; `api.intake`/`IntakeResponse` (Task 6) — в Task 7 и 9; `docxToPlainText` (Task 9) — в Task 5's маршруте.

**Порядок без красных задач:** Task 1 аддитивен; Task 2 добавляет имя агента в оба списка сразу; Task 3 не трогает маршруты; Task 4 — чистое извлечение под страховочным тестом; Task 5 соединяет всё; Task 6–8 — веб поверх готового API; Task 9 расширяет тело запроса обратносовместимо (`content` остаётся); Task 10 только документация и ручная приёмка.

**Риски, которые план принимает осознанно.** Один вызов LLM на файл: одиннадцать файлов — одиннадцать вызовов, последовательно, это минуты ожидания. Параллелизм с ограничением 3 (как в `AspectRunner`) — очевидная оптимизация, но она усложняет обработку частичных отказов, поэтому вынесена за рамки фазы. Классификатор переносит тело фрагмента дословно, то есть удваивает объём токенов на входе и выходе; для файлов больше ~40 КБ это станет заметно, и тогда понадобится резка файла до вызова.
