# Фаза 3 конвейера: документные этапы (мир, лор) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** этап «Мир» (и «Лор») проходится за два клика и одно ожидание: «Собрать мир» пишет весь документ одним вызовом модели, «Утвердить мир» принимает его целиком; разделы правятся поштучно, а `skipped` ставится только явной кнопкой «Не нужен».

**Architecture:** аспектная модель `studio_state` не меняется — раздел документа по-прежнему аспект этапа. Меняется число вызовов и представление. Вместо `aspect_playbook` (список разделов) плюс `aspect_variants` на каждый раздел появляется один агент `aspect_document`, возвращающий разделы вместе с текстом. Экран этапа перестаёт быть списком карточек с вариантами и становится документом: разделы подряд, у каждого три действия — «Переписать» (refine по указанию), «Другие варианты» (существующий `aspect_variants`), «Править» (ручная правка). Внизу одна кнопка «Утвердить». Все три действия раздела бьют в уже существующие маршруты; нового там ничего нет.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), zod, Hono + SSE, React 18 + Tailwind v4, vitest.

**Spec:** [docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md](../specs/2026-09-04-author-pipeline-redesign.md), раздел 6, «Фаза 3».

## Решения, принятые до плана

1. **Предметы в фазу 3 не входят.** Спецификация 2026-09-04 называет три этапа, но предметы с тех пор стали составом кандидатов, который «Добавить в канон» материализует в таблицу `items`, а её читает агент лора ([packages/agents/src/lore.ts:93](../../../packages/agents/src/lore.ts)). Перевод предметов в прозу разорвал бы эту связь и осиротил уже заведённые предметы. Предметы закрываются фазой 4 вместе с персонажами — там тот же экран составов. Решение автора, 2026-09-22.
2. **«Собрать» не переписывает то, у чего уже есть текст.** Раздел, пришедший из материалов автора или принятый раньше, уходит в промпт как контекст и остаётся нетронутым; модель пишет только пустые разделы и добавляет недостающие. Так «Собрать» безопасно нажимать на этапе, куда интейк уже что-то положил.
3. **`skipped` только по явной кнопке.** `deriveStageStatus` перестаёт выводить его из «все разделы улажены, ни один не принят»: это ровно тот дефект, из-за которого «ничего не принял» читалось как «готово» (раздел 1 спецификации).
4. **Заметки автора хранятся.** `StageState.authorNotes` — необязательное поле JSON-состояния, миграции не нужно. Сборка идёт минутами, и потерять набранные заметки при обновлении страницы или отказе вызова недопустимо; кроме того, «Переписать» раздела должен учитывать те же заметки.
5. **`AspectRunner` удаляется.** После переезда `MarkdownStagePage` на документный экран у него не остаётся ни одного вызывающего (`PlaybookRunner` остаётся — им пользуется `EntityStagePage`). Всё, что в нём было выстрадано — слияние на 409, закрытие редактора только по факту записи, — переезжает в новый раннер вместе с тестами.

## Global Constraints

- Node 22+, ESM only, TypeScript strict с `noUncheckedIndexedAccess`. Необязательное поле пишется через `...(x !== undefined ? { k: x } : {})`, а не `k: undefined`, кроме мест, где существующий код уже делает иначе (там — как рядом).
- Межпакетные импорты только через `workspace:*` и поле `exports`; в `src/` чужого пакета не лезть.
- Миграций в этой фазе нет и быть не должно: всё живёт в JSON-колонке `books.studio_state`.
- Regexp по русскому тексту: без `\b` и без `lower()`/`toLowerCase` для сравнения имён — сравнение имён разделов идёт через `normalizeSectionName` из задачи 5 (trim + `toLocaleLowerCase("ru")` допустим, это не канон сущностей, а имена разделов одного этапа).
- Ничего не утверждается без автора. «Собрать» кладёт разделы в статусе `reviewing`, а не `accepted`.
- Русский интерфейс без имён агентов, веток и слова «аспект» на экране: раздел называется разделом.
- Тесты мокают вызовы LLM (`vi.mock("@book-forge/agents/...")`).
- Каждая задача заканчивается зелёными `pnpm typecheck` и `pnpm test` и своим коммитом.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `packages/shared/src/studio-state.ts` | +`authorNotes`, +`DOCUMENT_STAGE_IDS`; `deriveStageStatus` без неявного `skipped` |
| `packages/agents/src/aspects/document.ts` | новый агент `aspect_document`: контракт, промпт, `runAspectDocument`, `toStoredDocumentVariant` |
| `packages/agents/src/bootstrap.ts` | регистрация контракта |
| `packages/llm/src/types.ts` | `aspect_document` в `AGENT_NAMES` и `STRUCTURED_AGENT_NAMES` |
| `packages/llm/src/router.ts` | `aspect_document: "subscription"` |
| `apps/server/src/routes/studio.ts` | `POST /books/:id/stages/:stageId/document` и `…/document-stream` |
| `apps/server/src/utils/generation-progress.ts` | `ESTIMATE_MS.document` |
| `apps/web/src/api/client.ts` | `generateStageDocument` + `streamStageDocument` |
| `apps/web/src/components/studio/aspect-engine/documentSections.ts` | чистые функции: `sectionText`, `normalizeSectionName`, `mergeDocumentSections`, `approveAllSections` |
| `apps/web/src/components/studio/aspect-engine/DocumentSection.tsx` | один раздел: рендер + три действия |
| `apps/web/src/components/studio/aspect-engine/DocumentStageRunner.tsx` | заметки, «Собрать», список разделов, «Утвердить» |
| `apps/web/src/pages/MarkdownStagePage.tsx` | переезд на новый раннер |
| `apps/web/src/components/studio/StageSkipControl.tsx` | «Этап не нужен» для необязательных |
| `apps/server/src/utils/quick-start-run.ts` | мир и лор собираются одним вызовом |

Удаляются: `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx`, `…/__tests__/AspectRunner.test.tsx`, `…/__tests__/BatchGenerate.test.tsx`.

---

### Task 1: `authorNotes`, список документных этапов и честный `skipped`

**Files:**
- Modify: `packages/shared/src/studio-state.ts:20-24` (рядом с `OPTIONAL_STAGE_IDS`), `:179-186` (схема), `:241-269` (`deriveStageStatus`)
- Test: `packages/shared/src/studio-state.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  ```ts
  export const DOCUMENT_STAGE_IDS: readonly ["world", "lore"];
  export function isDocumentStage(id: StageId): id is "world" | "lore";
  ```
  плюс `StageState.authorNotes?: string` и `deriveStageStatus(stage: StageState): StageStatus`, который возвращает `"skipped"` **только** при `stage.status === "skipped"`.

- [ ] **Step 1: Написать падающие тесты**

Открыть `packages/shared/src/studio-state.test.ts`. Найти тест, который сейчас ожидает `"skipped"` от полностью улаженного этапа (около строки 203):

```ts
    aspects: [aspect({ status: "skipped" }), aspect({ order: 1, status: "skipped" })],
  });
  expect(deriveStageStatus(s)).toBe("skipped");
```

Заменить его и дописать рядом новые:

```ts
  it("этап, где автор пропустил все разделы поштучно, остаётся черновиком", () => {
    // Фаза 3: «ничего не принял» больше не значит «готово». Пропуск этапа —
    // это отдельная кнопка «Не нужен», и только она ставит skipped.
    const s = stageWith({
      aspects: [aspect({ status: "skipped" }), aspect({ order: 1, status: "skipped" })],
    });
    expect(deriveStageStatus(s)).toBe("in_progress");
  });

  it("явный пропуск этапа переживает вывод статуса", () => {
    const s = stageWith({
      status: "skipped",
      aspects: [aspect({ status: "skipped" })],
    });
    expect(deriveStageStatus(s)).toBe("skipped");
  });

  it("заметки автора читаются и переживают разбор состояния", () => {
    const parsed = stageStateSchema.parse({
      status: "in_progress",
      playbookGenerated: false,
      aspects: [],
      authorNotes: "Мир холодный, без магии.",
    });
    expect(parsed.authorNotes).toBe("Мир холодный, без магии.");
  });

  it("состояние без заметок разбирается по-прежнему", () => {
    const parsed = stageStateSchema.parse({
      status: "not_started",
      playbookGenerated: false,
      aspects: [],
    });
    expect(parsed.authorNotes).toBeUndefined();
  });

  it("документные этапы — только мир и лор", () => {
    expect(isDocumentStage("world")).toBe(true);
    expect(isDocumentStage("lore")).toBe(true);
    // Предметы остались составом кандидатов: их материализация пишет в
    // таблицу `items`, которую читает агент лора.
    expect(isDocumentStage("items")).toBe(false);
    expect(isDocumentStage("characters")).toBe(false);
    expect(isDocumentStage("plot")).toBe(false);
  });
```

Импортировать `isDocumentStage` рядом с `stageStateSchema`.

Если в файле нет хелперов `stageWith` / `aspect`, использовать те, что уже есть в нём (смотреть начало файла) — имена могут отличаться; переписывать хелперы не надо. Импорт `stageStateSchema` добавить к существующему импорту из `./studio-state.js`.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `pnpm --filter @book-forge/shared test -- src/studio-state.test.ts`
Expected: FAIL — «expected "skipped" to be "in_progress"» и «expected undefined to be 'Мир холодный, без магии.'» (поле срезается схемой).

- [ ] **Step 3: Список документных этапов**

В `packages/shared/src/studio-state.ts` сразу после `OPTIONAL_STAGE_IDS` и `isOptionalStage` добавить:

```ts
/** Этапы, которые автор проходит одним документом с разделами (фаза 3
 *  конвейера). Список живёт здесь, а не тремя копиями в экране, маршруте и
 *  быстром сборе: копии разошлись бы молча, и этап оказался бы документным
 *  для одного читателя и аспектным для другого. */
export const DOCUMENT_STAGE_IDS = ["world", "lore"] as const;

export function isDocumentStage(id: StageId): id is (typeof DOCUMENT_STAGE_IDS)[number] {
  return (DOCUMENT_STAGE_IDS as readonly string[]).includes(id);
}
```

- [ ] **Step 4: Поле `authorNotes`**

В `packages/shared/src/studio-state.ts` заменить `stageStateSchema`:

```ts
export const stageStateSchema = z.object({
  status: stageStatusSchema,
  skippedReason: z.string().optional(),
  playbookGenerated: z.boolean(),
  aspects: z.array(stageAspectSchema),
  updatedAt: z.string().optional(),
  /** Заметки автора к этапу: что обязательно учесть при сборке документа.
   *  Живут в JSON-состоянии, миграции не нужно. Хранятся, а не передаются
   *  разово, потому что сборка идёт минутами, а «Переписать» отдельного
   *  раздела обязан учитывать те же заметки, что и первая сборка. */
  authorNotes: z.string().max(4000).optional(),
});
```

- [ ] **Step 5: Убрать неявный `skipped`**

В той же файле заменить хвост `deriveStageStatus` (последние три строки тела, сейчас `if (stage.aspects.some((a) => !settled(a))) return "in_progress"; return "skipped";`) на:

```ts
  // Раньше здесь стояло «всё улажено, ничего не принято → skipped». Это и был
  // дефект «ничего не принял = готово» из раздела 1 ТЗ конвейера: этап, мимо
  // которого автор прошёл поштучно, выглядел законченным, и рекомендатор вёл
  // дальше. Пропуск ЭТАПА — отдельное решение автора и отдельная кнопка
  // «Не нужен»; вывести его из состояния разделов нельзя.
  return "in_progress";
```

Заодно поправить комментарий над функцией, если он обещает старое поведение.

- [ ] **Step 6: Тесты зелёные**

Run: `pnpm --filter @book-forge/shared test -- src/studio-state.test.ts`
Expected: PASS

- [ ] **Step 7: Прогнать всё, что могло опереться на старый вывод**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0. Если падает тест `studio-warnings` или `StudioPage`, разобраться, ожидает ли он старого неявного `skipped`. Ожидает — правится ожидание вместе с комментарием, почему поведение изменилось. Тест, проверяющий ЯВНЫЙ пропуск (`status: "skipped"` в исходном состоянии), менять нельзя: он про другое.

- [ ] **Step 8: Коммит**

```bash
git add packages/shared/src/studio-state.ts packages/shared/src/studio-state.test.ts
git commit -m "feat(shared): заметки этапа, список документных этапов, пропуск только по кнопке"
```

---

### Task 2: Агент `aspect_document`

**Files:**
- Create: `packages/agents/src/aspects/document.ts`
- Create: `packages/agents/src/aspects/__tests__/document.test.ts`
- Modify: `packages/agents/src/bootstrap.ts`, `packages/llm/src/types.ts`, `packages/llm/src/router.ts`
- Modify: `packages/agents/package.json` (экспорт подпути, если экспорты перечислены поимённо — проверить, как объявлены `./aspects/playbook` и соседи, и добавить `./aspects/document` тем же способом)

**Interfaces:**
- Consumes: `BookConcept`, `ContextRef`, `StageId` из `@book-forge/shared`; `registerAgentContract`, `dispatchStructured` из `@book-forge/llm`.
- Produces:
  ```ts
  export interface AspectDocumentInput {
    stageId: StageId;
    concept: BookConcept;
    existingSections: Array<{ name: string; text: string }>;
    emptySectionNames: string[];
    authorNotes?: string;
    contextRef: ContextRef;
  }
  export interface DocumentSectionOut { name: string; description: string; markdown: string }
  export type AspectDocumentOutput = { sections: DocumentSectionOut[] };
  export function registerAspectDocumentContract(): void;
  export function runAspectDocument(input, options?): Promise<AspectDocumentOutput>;
  export function toStoredDocumentVariant(
    section: DocumentSectionOut,
    meta: { contextRef: ContextRef; modelId: string },
  ): AspectVariant;
  ```

- [ ] **Step 1: Написать падающий тест**

Create `packages/agents/src/aspects/__tests__/document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BookConcept, ContextRef } from "@book-forge/shared";
import {
  buildDocumentPrompt,
  documentSystemPrompt,
  toStoredDocumentVariant,
} from "../document.js";

const concept: BookConcept = {
  schemaVersion: 1,
  pitches: [],
  audience: "adult",
  premise: { logline: "Инженер чинит город, который его забыл." },
  genre: "техно-готика",
  tone: "холодный",
};

const contextRef: ContextRef = {
  hash: "h",
  summary: "s",
  includedAspectIds: [],
  includedEntityIds: [],
};

describe("промпт документа", () => {
  it("печатает заметки автора как обязательные к учёту", () => {
    const prompt = buildDocumentPrompt({
      stageId: "world",
      concept,
      existingSections: [],
      emptySectionNames: [],
      authorNotes: "Без магии. Зима круглый год.",
      contextRef,
    });
    expect(prompt).toContain("Без магии. Зима круглый год.");
    expect(prompt).toContain("ЗАМЕТКИ АВТОРА");
  });

  it("называет разделы с текстом неприкосновенными, а пустые — заданием", () => {
    const prompt = buildDocumentPrompt({
      stageId: "world",
      concept,
      existingSections: [{ name: "география", text: "Город стоит на сваях." }],
      emptySectionNames: ["политика"],
      contextRef,
    });
    expect(prompt).toContain("география");
    expect(prompt).toContain("Город стоит на сваях.");
    expect(prompt).toContain("политика");
    // Раздел, у которого уже есть текст, переписывать нельзя — иначе
    // «Собрать» затирало бы материалы автора.
    expect(prompt).toMatch(/НЕ переписывай|не переписывай/);
  });

  it("на пустом этапе просит собрать документ целиком", () => {
    const prompt = buildDocumentPrompt({
      stageId: "lore",
      concept,
      existingSections: [],
      emptySectionNames: [],
      contextRef,
    });
    expect(prompt).toContain("Лор");
    expect(prompt).toContain("5–9");
  });

  it("системный промпт запрещает служебные слова интерфейса", () => {
    expect(documentSystemPrompt).not.toContain("аспект");
  });
});

describe("toStoredDocumentVariant", () => {
  it("кладёт раздел вариантом markdown в статусе generated", () => {
    const v = toStoredDocumentVariant(
      { name: "география", description: "рельеф и климат", markdown: "# география\n\nТекст." },
      { contextRef, modelId: "sonnet" },
    );
    expect(v.payloadKind).toBe("markdown");
    expect(v.status).toBe("generated");
    expect(v.editSource).toBe("llm");
    expect(v.payload).toContain("Текст.");
    expect(v.modelId).toBe("sonnet");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/aspects/__tests__/document.test.ts`
Expected: FAIL — «Cannot find module '../document.js'».

- [ ] **Step 3: Написать агент**

Create `packages/agents/src/aspects/document.ts`:

```ts
import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  ModelChoice,
  StageId,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredProgressEvent,
  type StructuredUsage,
} from "@book-forge/llm";

export interface AspectDocumentInput {
  stageId: StageId;
  concept: BookConcept;
  /** Разделы, у которых уже есть текст: контекст, переписывать нельзя. */
  existingSections: Array<{ name: string; text: string }>;
  /** Разделы, имена которых автор уже видит, а текста нет: их надо написать. */
  emptySectionNames: string[];
  /** Заметки автора к этапу. Обязательны к учёту. */
  authorNotes?: string;
  contextRef: ContextRef;
}

const documentSectionSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  markdown: z.string().min(100).max(8000),
});

const aspectDocumentOutputSchema = z.object({
  sections: z.array(documentSectionSchema).min(1).max(9),
});

export type DocumentSectionOut = z.infer<typeof documentSectionSchema>;
export type AspectDocumentOutput = z.infer<typeof aspectDocumentOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "План",
  chapters: "Главы",
};

const STAGE_GUIDANCE: Partial<Record<StageId, string>> = {
  world: "Внешний слой реальности книги: где это происходит, кто там правит, чем живут, что за техника или её отсутствие, как устроен быт и что в этом мире невозможно.",
  lore: "Внутренний слой смыслов: во что здесь верят, что помнят о прошлом, какие истории рассказывают друг другу, что считают святым и что — позорным.",
};

export const documentSystemPrompt = `Ты — литературный соавтор. Пишешь по-русски один связный документ книжной библии для одного этапа.

Документ состоит из разделов. Раздел — это короткая тема (география, власть, вера, ремёсла) и текст к ней: 150–400 слов сплошной прозой или списками, без воды и без штампов. Разделы читаются подряд, поэтому не повторяй в одном то, что уже сказал в другом, и не начинай каждый одинаково.

Чего делать нельзя:
- выдавать общие места, которые подошли бы любой книге («мир полон опасностей», «магия имеет цену»);
- объяснять замысел книги вместо того, чтобы описывать её мир;
- называть разделы служебными словами интерфейса — имя раздела это одно-два слова по существу;
- писать раздел, которого автор не просил, вместо того, который просил.

Если даны РАЗДЕЛЫ С ТЕКСТОМ — это материал автора. НЕ переписывай их и не выдавай своей версии: они уже есть. Учитывай их и не противоречь им.
Если даны ПУСТЫЕ РАЗДЕЛЫ — напиши каждый из них под тем же именем.
Если ни тех, ни других нет — собери документ целиком: 5–9 разделов, сам выбери темы под жанр и тон.
Если даны ЗАМЕТКИ АВТОРА — это ограничения, а не пожелания: то, что в них сказано, обязано попасть в документ и не может быть отменено.

Каждый раздел возвращается тремя полями: name (одно-два слова), description (одна строка, о чём раздел), markdown (сам текст).`;

export function buildDocumentPrompt(input: AspectDocumentInput): string {
  const label = STAGE_LABELS[input.stageId];
  const parts: string[] = [`Этап: ${label}`];
  const guidance = STAGE_GUIDANCE[input.stageId];
  if (guidance) parts.push(guidance);
  parts.push(
    "",
    "ЗАМЫСЕЛ КНИГИ:",
    `Жанр: ${input.concept.genre ?? "не задан"}`,
    `Тон: ${input.concept.tone ?? "не задан"}`,
    `Аудитория: ${input.concept.audience}`,
  );
  if (input.concept.premise.logline) {
    parts.push("Логлайн:", input.concept.premise.logline);
  }
  if (input.concept.premise.protagonist) {
    parts.push(`Главный герой: ${input.concept.premise.protagonist}`);
  }
  if (input.concept.premise.conflict) {
    parts.push(`Конфликт: ${input.concept.premise.conflict}`);
  }
  if (input.authorNotes && input.authorNotes.trim()) {
    parts.push("", "ЗАМЕТКИ АВТОРА (обязательны к учёту):", input.authorNotes.trim());
  }
  if (input.existingSections.length > 0) {
    parts.push("", "РАЗДЕЛЫ С ТЕКСТОМ (материал автора, НЕ переписывай и не возвращай):");
    for (const s of input.existingSections) {
      parts.push(`### ${s.name}`, s.text, "");
    }
  }
  if (input.emptySectionNames.length > 0) {
    parts.push(
      "",
      `ПУСТЫЕ РАЗДЕЛЫ (напиши каждый под этим же именем): ${input.emptySectionNames.join(", ")}`,
    );
    parts.push(
      "",
      "Верни ровно эти разделы. Добавь новый только если без него документ не читается.",
    );
  } else {
    parts.push(
      "",
      `Собери документ этапа «${label}» целиком: 5–9 разделов.`,
    );
  }
  return parts.join("\n");
}

const aspectDocumentContract: AgentStructuredContract<
  AspectDocumentInput,
  AspectDocumentOutput
> = {
  agentName: "aspect_document",
  getOutputSchema: () => aspectDocumentOutputSchema,
  systemPrompt: documentSystemPrompt,
  buildPrompt: buildDocumentPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_stage_document",
    toolDescription:
      "Submit the whole stage document as a list of sections; each section has name, description and markdown text.",
  },
};

export function registerAspectDocumentContract(): void {
  registerAgentContract(aspectDocumentContract);
}

export interface RunAspectDocumentOptions {
  model?: ModelChoice;
  temperature?: number;
  onProgress?: (e: StructuredProgressEvent) => void;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

/** Один вызов на весь документ. Предел ожидания свой: общий `LLM_TIMEOUT_MS`
 *  (120 с) рассчитан на короткий структурный ответ, а здесь модель пишет
 *  разом столько же, сколько прежде писала шестью вызовами вариантов
 *  (замер 2026-08-01: один markdown-вариант ~121 с). */
export async function runAspectDocument(
  input: AspectDocumentInput,
  options: RunAspectDocumentOptions = {},
): Promise<AspectDocumentOutput> {
  const { raw, diagnostics } = await dispatchStructured<
    AspectDocumentInput,
    AspectDocumentOutput
  >({
    agentName: "aspect_document",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.onProgress !== undefined
      ? { onProgress: options.onProgress }
      : {}),
    maxTokens: 16000,
    timeoutMs: 600_000,
  });
  if (options.onUsage) {
    try {
      options.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[aspect_document] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

/** Раздел документа → вариант аспекта. Статус `generated`: документ приходит
 *  черновиком, принимает его автор кнопкой «Утвердить». */
export function toStoredDocumentVariant(
  section: DocumentSectionOut,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant {
  return {
    id: crypto.randomUUID(),
    label: "документ",
    payloadKind: "markdown",
    payload: section.markdown,
    status: "generated",
    editSource: "llm",
    generatedAt: new Date().toISOString(),
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  };
}
```

Проверить, что `ModelChoice` действительно экспортируется из `@book-forge/shared` (в соседнем `variants.ts` он импортируется отдельной строкой `import type { ModelChoice } from "@book-forge/shared";` — если так, сделать так же), и что `timeoutMs` есть у `dispatchStructured` (есть: им пользуется `runMaterialClassifier`).

- [ ] **Step 4: Зарегистрировать имя агента**

В `packages/llm/src/types.ts` добавить `"aspect_document",` в `AGENT_NAMES` сразу после `"aspect_entity_variants",` и такую же строку в `STRUCTURED_AGENT_NAMES`.

В `packages/llm/src/router.ts` рядом с `aspect_entity_variants: "subscription",` добавить:

```ts
  aspect_document: "subscription",
```

В `packages/agents/src/bootstrap.ts` добавить импорт и вызов рядом с соседями:

```ts
import { registerAspectDocumentContract } from "./aspects/document.js";
```

и в теле `registerAllAgentContracts()` — `registerAspectDocumentContract();` сразу после `registerAspectEntityVariantsContract();`.

- [ ] **Step 5: Тесты зелёные**

Run: `pnpm --filter @book-forge/agents test -- src/aspects/__tests__/document.test.ts`
Expected: PASS

- [ ] **Step 6: Страж соответствия имён**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0. В проекте есть drift-guard тест на `STRUCTURED_AGENT_NAMES`: он падает, если у структурного агента нет контракта. Если он упал — значит регистрация в bootstrap не доехала.

- [ ] **Step 7: Коммит**

```bash
git add packages/agents/src/aspects/document.ts packages/agents/src/aspects/__tests__/document.test.ts packages/agents/src/bootstrap.ts packages/llm/src/types.ts packages/llm/src/router.ts packages/agents/package.json
git commit -m "feat(agents): aspect_document — весь документ этапа одним вызовом"
```

---

### Task 3: Маршрут сборки документа и клиентская обёртка

**Files:**
- Modify: `apps/server/src/routes/studio.ts` (импорты около строки 45, схемы тел около строки 113, маршруты после `playbook-stream`, ~строка 1317)
- Modify: `apps/server/src/utils/generation-progress.ts:28-33`
- Modify: `apps/web/src/api/client.ts` (объект `api`, около `generateStagePlaybook`; стримы — около `streamStagePlaybook`, ~строка 1264)
- Test: `apps/server/src/routes/__tests__/stage-document.test.ts`

**Interfaces:**
- Consumes: `runAspectDocument`, `toStoredDocumentVariant` из задачи 2.
- Produces:
  - `POST /api/books/:id/stages/:stageId/document` → `200 { sections, contextRef, modelId }`
  - `POST /api/books/:id/stages/:stageId/document-stream` → SSE `progress` / `done` (то же тело) / `error` с кодом `aspect_document_failed`
  - Тело запроса: `{ existingSections?: Array<{name,text}>, emptySectionNames?: string[], authorNotes?: string }`
  - Клиент: `api.generateStageDocument(bookId, stageId, body)` и
    ```ts
    streamStageDocument(
      bookId: number,
      stageId: string,
      body: { existingSections: Array<{ name: string; text: string }>; emptySectionNames: string[]; authorNotes?: string },
      handlers: AspectStreamHandlers<{ sections: Array<{ name: string; description: string; markdown: string }>; contextRef: ContextRef; modelId: string }>,
    ): Promise<void>
    ```

- [ ] **Step 1: Написать падающий тест маршрута**

Create `apps/server/src/routes/__tests__/stage-document.test.ts`. Сначала посмотреть соседний тест студийных маршрутов (`apps/server/src/routes/__tests__/studio.test.ts`) и повторить его способ поднять приложение и книгу — база и фабрика там уже есть, второй свой вариант заводить нельзя.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const runDocumentMock = vi.fn();
vi.mock("@book-forge/agents/aspects/document", () => ({
  runAspectDocument: (...args: unknown[]) => runDocumentMock(...args),
  toStoredDocumentVariant: () => {
    throw new Error("маршрут не должен строить варианты сам");
  },
}));

// …далее — тот же bootstrap приложения, что в studio.test.ts…

describe("POST /books/:id/stages/:stageId/document", () => {
  beforeEach(() => {
    runDocumentMock.mockReset();
  });

  it("отдаёт разделы и передаёт агенту заметки автора", async () => {
    runDocumentMock.mockResolvedValue({
      sections: [
        { name: "география", description: "рельеф", markdown: "Текст географии, достаточно длинный." },
      ],
    });
    const res = await app.request(`/api/books/${bookId}/stages/world/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        existingSections: [{ name: "власть", text: "Правит совет." }],
        emptySectionNames: ["ремёсла"],
        authorNotes: "Без магии.",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: Array<{ name: string }>;
      modelId: string;
    };
    expect(body.sections).toHaveLength(1);
    expect(body.modelId).toBeTruthy();
    const arg = runDocumentMock.mock.calls[0]?.[0] as {
      authorNotes?: string;
      existingSections: Array<{ name: string }>;
      emptySectionNames: string[];
    };
    expect(arg.authorNotes).toBe("Без магии.");
    expect(arg.existingSections[0]?.name).toBe("власть");
    expect(arg.emptySectionNames).toEqual(["ремёсла"]);
  });

  it("отказывает этапу, который не документный", async () => {
    const res = await app.request(`/api/books/${bookId}/stages/characters/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("stage_not_document");
    expect(runDocumentMock).not.toHaveBeenCalled();
  });

  it("падение агента не роняет запрос молча", async () => {
    runDocumentMock.mockRejectedValue(new Error("модель недоступна"));
    const res = await app.request(`/api/books/${bookId}/stages/world/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details: { message: string } };
    expect(body.error).toBe("aspect_document_failed");
    expect(body.details.message).toContain("модель недоступна");
  });

  it("поток отдаёт done с теми же разделами", async () => {
    runDocumentMock.mockResolvedValue({
      sections: [{ name: "вера", description: "во что верят", markdown: "Длинный текст о вере." }],
    });
    const res = await app.request(`/api/books/${bookId}/stages/lore/document-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    // SSE надо дочитать: без этого обработчик до вызова агента не доходит и
    // счётчик вызовов лжёт (грабли живого прогона 2026-09-22).
    const text = await res.text();
    expect(text).toContain("event: done");
    expect(text).toContain("вера");
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/stage-document.test.ts`
Expected: FAIL — 404 на неизвестном маршруте.

- [ ] **Step 3: Оценка длительности**

В `apps/server/src/utils/generation-progress.ts` дописать в `ESTIMATE_MS`:

```ts
  /** Весь документ одним вызовом: примерно столько же, сколько прежде
   *  занимали плейбук и пять–шесть вариантов по отдельности, но одним
   *  ожиданием. Влияет только на скорость роста полосы. */
  document: 240_000,
```

- [ ] **Step 4: Маршруты**

В `apps/server/src/routes/studio.ts` добавить импорт рядом с другими аспектными:

```ts
import {
  runAspectDocument,
  toStoredDocumentVariant,
} from "@book-forge/agents/aspects/document";
```

и добавить `isDocumentStage` к существующему импорту из `@book-forge/shared` (там, где уже берётся `stageIdSchema`).

Рядом с `playbookBodySchema` добавить схему тела:

```ts
const stageDocumentBodySchema = z.object({
  existingSections: z
    .array(z.object({ name: z.string().min(1), text: z.string().min(1) }))
    .max(20)
    .optional(),
  emptySectionNames: z.array(z.string().min(1)).max(20).optional(),
  authorNotes: z.string().max(4000).optional(),
});
```

После маршрута `playbook-stream` добавить оба маршрута. Общая подготовка вынесена в одну функцию, чтобы поток и обычный POST не разошлись:

```ts
  /** Общая часть обоих маршрутов сборки документа. Возвращает либо готовый
   *  ответ с ошибкой, либо всё, что нужно для вызова агента. Две копии этой
   *  подготовки разошлись бы молча — поток и POST обязаны собирать один и тот
   *  же промпт. */
  async function prepareStageDocument(c: Context): Promise<
    | { error: Response }
    | {
        bookId: number;
        stageId: StageId;
        input: Parameters<typeof runAspectDocument>[0];
      }
  > {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return { error: validationFailed(c, stageParse.error) };
    const stageId = stageParse.data;
    if (!isDocumentStage(stageId)) {
      return {
        error: c.json({ error: "stage_not_document", details: { stageId } }, 400),
      };
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = stageDocumentBodySchema.safeParse(body ?? {});
    if (!parsed.success) return { error: validationFailed(c, parsed.error) };

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return { error: notFound(c, "book") };
      throw e;
    }

    const existingSections = parsed.data.existingSections ?? [];
    const emptySectionNames = parsed.data.emptySectionNames ?? [];
    const contextRef = buildContextRef({
      stageId,
      concept,
      accumulated: existingSections.map((s) => ({
        id: s.name,
        name: s.name,
        finalPayload: s.text,
      })),
      extra: {
        kind: "document",
        emptySectionNames,
        ...(parsed.data.authorNotes !== undefined
          ? { authorNotes: parsed.data.authorNotes }
          : {}),
      },
    });
    return {
      bookId: id,
      stageId,
      input: {
        stageId,
        concept,
        existingSections,
        emptySectionNames,
        ...(parsed.data.authorNotes !== undefined
          ? { authorNotes: parsed.data.authorNotes }
          : {}),
        contextRef,
      },
    };
  }

  r.post("/books/:id/stages/:stageId/document", async (c) => {
    const prepared = await prepareStageDocument(c);
    if ("error" in prepared) return prepared.error;
    try {
      const result = await runAspectDocument(prepared.input, {
        onUsage: (usage) =>
          logUsage(sqlite, {
            route: "studio.aspect_document",
            model: usage.modelId,
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationInputTokens: usage.cacheCreationInputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
            },
            bookId: prepared.bookId,
          }),
      });
      return c.json({
        sections: result.sections,
        contextRef: prepared.input.contextRef,
        modelId: aspectModelLabel("aspect_document"),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "aspect_document_failed", details: { message } }, 500);
    }
  });

  r.post("/books/:id/stages/:stageId/document-stream", async (c) => {
    const prepared = await prepareStageDocument(c);
    if ("error" in prepared) return prepared.error;
    return streamAgentProgress(c, {
      errorCode: "aspect_document_failed",
      estimateMs: ESTIMATE_MS.document,
      run: (onProgress) =>
        runAspectDocument(prepared.input, {
          onProgress,
          onUsage: (usage) =>
            logUsage(sqlite, {
              route: "studio.aspect_document",
              model: usage.modelId,
              usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheCreationInputTokens: usage.cacheCreationInputTokens,
                cacheReadInputTokens: usage.cacheReadInputTokens,
              },
              bookId: prepared.bookId,
            }),
        }),
      buildDone: (result) => ({
        sections: result.sections,
        contextRef: prepared.input.contextRef,
        modelId: aspectModelLabel("aspect_document"),
      }),
    });
  });
```

`toStoredDocumentVariant` на сервере не зовётся: варианты собирает экран, одним патчем вместе с остальным состоянием этапа. Импорт его из маршрута убрать, если линтер ругается на неиспользуемый.

- [ ] **Step 5: Клиентские обёртки**

В `apps/web/src/api/client.ts` рядом с `generateStagePlaybook` добавить в объект `api`:

```ts
  generateStageDocument: (
    bookId: number,
    stageId: string,
    body: {
      existingSections?: Array<{ name: string; text: string }>;
      emptySectionNames?: string[];
      authorNotes?: string;
    },
  ) =>
    post<{
      sections: Array<{ name: string; description: string; markdown: string }>;
      contextRef: ContextRef;
      modelId: string;
    }>(`/api/books/${bookId}/stages/${stageId}/document`, body),
```

(взять ту же внутреннюю функцию запроса, что использует соседний `generateStagePlaybook` — имя может отличаться от `post`.)

И рядом со `streamStagePlaybook`:

```ts
export interface StageDocumentSection {
  name: string;
  description: string;
  markdown: string;
}

export function streamStageDocument(
  bookId: number,
  stageId: string,
  body: {
    existingSections: Array<{ name: string; text: string }>;
    emptySectionNames: string[];
    authorNotes?: string;
  },
  handlers: AspectStreamHandlers<{
    sections: StageDocumentSection[];
    contextRef: ContextRef;
    modelId: string;
  }>,
): Promise<void> {
  return postAspectStream(
    `/api/books/${bookId}/stages/${stageId}/document-stream`,
    body,
    handlers,
  );
}
```

- [ ] **Step 6: Тесты зелёные**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/stage-document.test.ts`
Expected: PASS

- [ ] **Step 7: Полная проверка и коммит**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0

```bash
git add apps/server/src/routes/studio.ts apps/server/src/utils/generation-progress.ts apps/server/src/routes/__tests__/stage-document.test.ts apps/web/src/api/client.ts
git commit -m "feat(server): маршрут сборки документа этапа и его поток"
```

---

### Task 4: Чистые функции документа

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/documentSections.ts`
- Test: `apps/web/src/components/studio/aspect-engine/__tests__/documentSections.test.ts`

**Interfaces:**
- Consumes: `StageAspect`, `StageState`, `AspectVariant`, `ContextRef` из `@book-forge/shared`; `StageDocumentSection` из `@/api/client`.
- Produces:
  ```ts
  export function normalizeSectionName(name: string): string;
  export function sectionText(aspect: StageAspect): string | null;
  export function currentVariant(aspect: StageAspect): AspectVariant | null;
  export function mergeDocumentSections(
    stage: StageState,
    sections: StageDocumentSection[],
    meta: { contextRef: ContextRef; modelId: string },
  ): StageState;
  export function approveAllSections(stage: StageState): StageState | null;
  ```

- [ ] **Step 1: Написать падающие тесты**

Create `apps/web/src/components/studio/aspect-engine/__tests__/documentSections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AspectVariant, StageAspect, StageState } from "@book-forge/shared";
import {
  approveAllSections,
  currentVariant,
  mergeDocumentSections,
  normalizeSectionName,
  sectionText,
} from "../documentSections.js";

const meta = {
  contextRef: { hash: "h", summary: "s", includedAspectIds: [], includedEntityIds: [] },
  modelId: "sonnet",
};

function variant(over: Partial<AspectVariant> = {}): AspectVariant {
  return {
    id: over.id ?? "v1",
    label: "документ",
    payloadKind: "markdown",
    payload: "текст",
    status: "generated",
    editSource: "llm",
    generatedAt: "2026-09-22T00:00:00.000Z",
    ...over,
  } as AspectVariant;
}

function aspect(over: Partial<StageAspect> = {}): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: false,
    source: "llm",
    payloadKind: "markdown",
    variants: [],
    ...over,
  } as StageAspect;
}

function stage(aspects: StageAspect[], over: Partial<StageState> = {}): StageState {
  return { status: "not_started", playbookGenerated: false, aspects, ...over };
}

describe("normalizeSectionName", () => {
  it("сравнивает имена без учёта регистра и краёв", () => {
    expect(normalizeSectionName("  География ")).toBe(normalizeSectionName("география"));
  });
});

describe("sectionText", () => {
  it("принятый раздел отдаёт свой финальный текст", () => {
    const a = aspect({ status: "accepted", finalPayload: "принято" });
    expect(sectionText(a)).toBe("принято");
  });

  it("черновик отдаёт текст выбранного варианта", () => {
    const a = aspect({
      status: "reviewing",
      variants: [variant({ id: "v1", payload: "первый" }), variant({ id: "v2", payload: "второй" })],
      selectedVariantId: "v1",
    });
    expect(sectionText(a)).toBe("первый");
  });

  it("без выбора берёт последний живой вариант", () => {
    const a = aspect({
      status: "reviewing",
      variants: [
        variant({ id: "v1", payload: "старый", status: "superseded" }),
        variant({ id: "v2", payload: "новый" }),
      ],
    });
    expect(sectionText(a)).toBe("новый");
  });

  it("пустой раздел отдаёт null", () => {
    expect(sectionText(aspect())).toBeNull();
    expect(sectionText(aspect({ variants: [variant({ payload: "   " })] }))).toBeNull();
  });
});

describe("mergeDocumentSections", () => {
  it("наполняет пустой раздел с тем же именем, а не заводит второй", () => {
    const next = mergeDocumentSections(
      stage([aspect({ id: "a1", name: "география" })]),
      [{ name: "География", description: "рельеф", markdown: "Длинный текст." }],
      meta,
    );
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]?.status).toBe("reviewing");
    expect(sectionText(next.aspects[0]!)).toBe("Длинный текст.");
  });

  it("не трогает раздел, у которого уже есть текст", () => {
    const before = stage([
      aspect({ id: "a1", name: "география", status: "accepted", finalPayload: "авторский текст" }),
    ]);
    const next = mergeDocumentSections(
      before,
      [{ name: "география", description: "рельеф", markdown: "версия модели" }],
      meta,
    );
    expect(next.aspects[0]).toEqual(before.aspects[0]);
  });

  it("добавляет новый раздел следующим по порядку", () => {
    const next = mergeDocumentSections(
      stage([aspect({ id: "a1", name: "география", order: 3, status: "accepted", finalPayload: "есть" })]),
      [{ name: "вера", description: "во что верят", markdown: "Текст о вере." }],
      meta,
    );
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[1]?.name).toBe("вера");
    expect(next.aspects[1]?.order).toBe(4);
    expect(next.aspects[1]?.required).toBe(false);
  });

  it("этап трогается со старта, но статус не подделывается", () => {
    const next = mergeDocumentSections(
      stage([]),
      [{ name: "вера", description: "о вере", markdown: "Текст." }],
      meta,
    );
    expect(next.status).toBe("in_progress");
    expect(next.aspects[0]?.status).toBe("reviewing");
  });

  it("пропущенный автором раздел модель не воскрешает", () => {
    const before = stage([aspect({ id: "a1", name: "магия", status: "skipped" })]);
    const next = mergeDocumentSections(
      before,
      [{ name: "магия", description: "как устроена", markdown: "Текст о магии." }],
      meta,
    );
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]?.status).toBe("skipped");
  });
});

describe("approveAllSections", () => {
  it("принимает каждый раздел с текстом одним изменением", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", name: "география", status: "reviewing", variants: [variant({ id: "v1", payload: "текст 1" })] }),
        aspect({ id: "a2", name: "вера", order: 1, status: "reviewing", variants: [variant({ id: "v2", payload: "текст 2" })] }),
      ]),
    );
    expect(next).not.toBeNull();
    expect(next!.aspects.every((a) => a.status === "accepted")).toBe(true);
    expect(next!.aspects[0]?.finalPayload).toBe("текст 1");
    expect(next!.aspects[0]?.selectedVariantId).toBe("v1");
    expect(next!.aspects[0]?.variants[0]?.status).toBe("accepted");
  });

  it("пустой раздел остаётся пустым, а не принимается вслепую", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", status: "reviewing", variants: [variant({ id: "v1", payload: "есть" })] }),
        aspect({ id: "a2", name: "пусто", order: 1 }),
      ]),
    );
    expect(next!.aspects[1]?.status).toBe("pending");
  });

  it("пропущенный раздел не принимается", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", status: "reviewing", variants: [variant({ id: "v1", payload: "есть" })] }),
        aspect({ id: "a2", order: 1, status: "skipped", variants: [variant({ id: "v2", payload: "было" })] }),
      ]),
    );
    expect(next!.aspects[1]?.status).toBe("skipped");
  });

  it("возвращает null, когда принимать нечего", () => {
    expect(approveAllSections(stage([aspect()]))).toBeNull();
    expect(
      approveAllSections(
        stage([aspect({ status: "accepted", finalPayload: "уже", variants: [variant({ id: "v1", status: "accepted" })] })]),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/documentSections.test.ts`
Expected: FAIL — «Cannot find module '../documentSections.js'».

- [ ] **Step 3: Реализация**

Create `apps/web/src/components/studio/aspect-engine/documentSections.ts`:

```ts
import type {
  AspectVariant,
  ContextRef,
  StageAspect,
  StageState,
} from "@book-forge/shared";
import type { StageDocumentSection } from "@/api/client";

/** Имена разделов — не канон сущностей: они живут внутри одного этапа, тёзок
 *  среди них не бывает, и падежей у них нет. Поэтому здесь достаточно
 *  регистра и краёв, а машинерия `entity-names` не нужна. */
export function normalizeSectionName(name: string): string {
  return name.trim().toLocaleLowerCase("ru");
}

/** Вариант, который сейчас показывается в документе: выбранный автором, иначе
 *  последний живой. Отвергнутые и вытесненные не в счёт — их автор уже прошёл. */
export function currentVariant(aspect: StageAspect): AspectVariant | null {
  if (aspect.selectedVariantId) {
    const picked = aspect.variants.find((v) => v.id === aspect.selectedVariantId);
    if (picked) return picked;
  }
  for (let i = aspect.variants.length - 1; i >= 0; i -= 1) {
    const v = aspect.variants[i];
    if (!v) continue;
    if (v.status === "superseded" || v.status === "rejected") continue;
    return v;
  }
  return null;
}

/** Текст раздела или `null`, если его ещё нет. Принятый текст сильнее
 *  вариантов: он и есть то, что уходит в промпты. */
export function sectionText(aspect: StageAspect): string | null {
  if (typeof aspect.finalPayload === "string" && aspect.finalPayload.trim()) {
    return aspect.finalPayload;
  }
  const v = currentVariant(aspect);
  if (v && typeof v.payload === "string" && v.payload.trim()) return v.payload;
  return null;
}

/** Разделы собранного документа ложатся в состояние этапа.
 *
 *  Три правила, и все три — про то, что автор уже решил:
 *  · раздел с текстом не трогается вовсе (его версия модели выбрасывается);
 *  · пропущенный раздел не воскрешается;
 *  · пустой раздел с тем же именем наполняется, а не удваивается.
 *  Всё приходит в статусе `reviewing`: утверждает автор. */
export function mergeDocumentSections(
  stage: StageState,
  sections: StageDocumentSection[],
  meta: { contextRef: ContextRef; modelId: string },
): StageState {
  const now = new Date().toISOString();
  const byName = new Map<string, StageAspect>();
  for (const a of stage.aspects) byName.set(normalizeSectionName(a.name), a);

  let maxOrder = stage.aspects.reduce((m, a) => Math.max(m, a.order), -1);
  const updates = new Map<string, StageAspect>();
  const added: StageAspect[] = [];

  for (const section of sections) {
    const variant: AspectVariant = {
      id: crypto.randomUUID(),
      label: "документ",
      payloadKind: "markdown",
      payload: section.markdown,
      status: "generated",
      editSource: "llm",
      generatedAt: now,
      modelId: meta.modelId,
      contextRef: meta.contextRef,
    };
    const existing = byName.get(normalizeSectionName(section.name));
    if (!existing) {
      maxOrder += 1;
      added.push({
        id: crypto.randomUUID(),
        name: section.name,
        description: section.description,
        status: "reviewing",
        order: maxOrder,
        required: false,
        source: "llm",
        payloadKind: "markdown",
        variants: [variant],
      });
      continue;
    }
    if (existing.status === "skipped") continue;
    if (sectionText(existing) !== null) continue;
    updates.set(existing.id, {
      ...existing,
      status: "reviewing",
      ...(existing.description === undefined
        ? { description: section.description }
        : {}),
      variants: [...existing.variants, variant],
    });
  }

  if (updates.size === 0 && added.length === 0) return stage;

  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: [
      ...stage.aspects.map((a) => updates.get(a.id) ?? a),
      ...added,
    ],
    updatedAt: now,
  };
}

/** «Утвердить этап»: каждый раздел, у которого есть текст, становится принятым.
 *  Пустые и пропущенные не трогаются — принять то, чего нет, значит соврать
 *  автору, что документ готов. `null` = принимать нечего. */
export function approveAllSections(stage: StageState): StageState | null {
  let changed = false;
  const aspects = stage.aspects.map((a) => {
    if (a.status === "skipped" || a.status === "accepted") return a;
    const chosen = currentVariant(a);
    if (!chosen || typeof chosen.payload !== "string" || !chosen.payload.trim()) {
      return a;
    }
    changed = true;
    return {
      ...a,
      status: "accepted" as const,
      selectedVariantId: chosen.id,
      finalPayload: chosen.payload,
      variants: a.variants.map((v) =>
        v.id === chosen.id
          ? { ...v, status: "accepted" as const }
          : v.status === "accepted"
            ? { ...v, status: "rejected" as const }
            : v,
      ),
    };
  });
  if (!changed) return null;
  return { ...stage, aspects, updatedAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/documentSections.test.ts`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add apps/web/src/components/studio/aspect-engine/documentSections.ts apps/web/src/components/studio/aspect-engine/__tests__/documentSections.test.ts
git commit -m "feat(web): слияние и утверждение разделов документа отдельными функциями"
```

---

### Task 5: Раздел документа на экране

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/DocumentSection.tsx`
- Test: `apps/web/src/components/studio/aspect-engine/__tests__/DocumentSection.test.tsx`

**Interfaces:**
- Consumes: `sectionText`, `currentVariant` (задача 4); `Markdown` из `@/components/Markdown`; `GenerationProgress`; `VariantGenerator<string>` из `./types.js`; `createLLMMarkdownVariantGenerator` даётся сверху пропом, компонент сам его не создаёт.
- Produces:
  ```ts
  export interface DocumentSectionProps {
    aspect: StageAspect;
    busy: boolean;
    error?: string;
    progress?: AspectGenerationProgress;
    generator: VariantGenerator<string>;
    accumulated: AccumulatedContext;
    onPatchAspect(aspectId: string, next: StageAspect): Promise<boolean>;
    onBusy(aspectId: string | null): void;
    onError(aspectId: string, message: string): void;
    onProgress(aspectId: string, p: AspectGenerationProgress | null): void;
  }
  export function DocumentSection(props: DocumentSectionProps): JSX.Element;
  ```

- [ ] **Step 1: Написать падающие тесты**

Create `apps/web/src/components/studio/aspect-engine/__tests__/DocumentSection.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect } from "@book-forge/shared";
import { DocumentSection } from "../DocumentSection.js";
import type { VariantGenerator } from "../types.js";

function aspect(over: Partial<StageAspect> = {}): StageAspect {
  return {
    id: "a1",
    name: "география",
    description: "рельеф и климат",
    status: "reviewing",
    order: 0,
    required: false,
    source: "llm",
    payloadKind: "markdown",
    variants: [
      {
        id: "v1",
        label: "документ",
        payloadKind: "markdown",
        payload: "Город стоит на сваях.",
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ],
    ...over,
  } as StageAspect;
}

function renderSection(over: Partial<StageAspect> = {}, gen?: VariantGenerator<string>) {
  const onPatchAspect = vi.fn().mockResolvedValue(true);
  const generator: VariantGenerator<string> = gen ?? { generate: vi.fn() };
  render(
    <DocumentSection
      aspect={aspect(over)}
      busy={false}
      generator={generator}
      accumulated={{ acceptedAspects: [] }}
      onPatchAspect={onPatchAspect}
      onBusy={vi.fn()}
      onError={vi.fn()}
      onProgress={vi.fn()}
    />,
  );
  return { onPatchAspect, generator };
}

describe("DocumentSection", () => {
  it("показывает текст раздела как текст, а не исходником", () => {
    renderSection({
      variants: [
        {
          id: "v1",
          label: "документ",
          payloadKind: "markdown",
          payload: "## Климат\n\nЗима круглый год.",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-09-22T00:00:00.000Z",
        },
      ],
    } as Partial<StageAspect>);
    expect(screen.getByText("Климат")).toBeInTheDocument();
    expect(screen.queryByText(/^## Климат/)).not.toBeInTheDocument();
  });

  it("правка сохраняется как принятый текст автора", async () => {
    const user = userEvent.setup();
    const { onPatchAspect } = renderSection();
    await user.click(screen.getByRole("button", { name: "Править" }));
    const box = screen.getByLabelText("Текст раздела «география»");
    await user.clear(box);
    await user.type(box, "Мой собственный текст.");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.status).toBe("accepted");
    expect(next.finalPayload).toBe("Мой собственный текст.");
    expect(next.variants.at(-1)?.editSource).toBe("manual");
  });

  it("редактор не закрывается, когда запись не прошла", async () => {
    const user = userEvent.setup();
    const onPatchAspect = vi.fn().mockResolvedValue(false);
    render(
      <DocumentSection
        aspect={aspect()}
        busy={false}
        generator={{ generate: vi.fn() }}
        accumulated={{ acceptedAspects: [] }}
        onPatchAspect={onPatchAspect}
        onBusy={vi.fn()}
        onError={vi.fn()}
        onProgress={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Править" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    // Текст автора — единственная его копия: окно остаётся открытым.
    expect(screen.getByLabelText("Текст раздела «география»")).toBeInTheDocument();
  });

  it("«Переписать» просит указание и шлёт его в refine", async () => {
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue([
      {
        id: "v2",
        label: "переписано",
        payloadKind: "markdown",
        payload: "Новый текст.",
        status: "generated",
        editSource: "refine",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const { onPatchAspect } = renderSection({}, { generate });
    await user.click(screen.getByRole("button", { name: "Переписать" }));
    await user.type(screen.getByLabelText("Что поменять в разделе «география»"), "мрачнее");
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => expect(generate).toHaveBeenCalled());
    const input = generate.mock.calls[0]?.[0] as { refineFrom?: { instructions: string } };
    expect(input.refineFrom?.instructions).toBe("мрачнее");
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    // Прежний текст становится вытесненным, а не исчезает.
    expect(next.variants.find((v) => v.id === "v1")?.status).toBe("superseded");
  });

  it("«Другие варианты» кладёт альтернативы рядом и даёт выбрать", async () => {
    const user = userEvent.setup();
    const generate = vi.fn().mockResolvedValue([
      {
        id: "v2",
        label: "морской",
        payloadKind: "markdown",
        payload: "Вариант про море.",
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const { onPatchAspect } = renderSection({}, { generate });
    await user.click(screen.getByRole("button", { name: "Другие варианты" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    const next = onPatchAspect.mock.calls[0]?.[1] as StageAspect;
    expect(next.variants).toHaveLength(2);
    expect(next.status).toBe("reviewing");
  });

  it("пропущенный раздел свёрнут и возвращается одной кнопкой", async () => {
    const user = userEvent.setup();
    const { onPatchAspect } = renderSection({ status: "skipped" });
    expect(screen.queryByText("Город стоит на сваях.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть раздел" }));
    await waitFor(() => expect(onPatchAspect).toHaveBeenCalled());
    expect((onPatchAspect.mock.calls[0]?.[1] as StageAspect).status).toBe("reviewing");
  });

  it("пустой раздел говорит об этом прямо", () => {
    renderSection({ status: "pending", variants: [] });
    expect(screen.getByText(/пуст/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/DocumentSection.test.tsx`
Expected: FAIL — «Cannot find module '../DocumentSection.js'».

- [ ] **Step 3: Реализация**

Create `apps/web/src/components/studio/aspect-engine/DocumentSection.tsx`. Компонент держит только своё локальное состояние (что открыто — правка или указание к переписыванию) и ничего не знает ни о запросах, ни о ревизии: патч и ошибки приходят сверху.

```tsx
import { useState } from "react";
import type { AspectVariant, StageAspect } from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { GenerationProgress } from "./GenerationProgress.js";
import type { AccumulatedContext, VariantGenerator } from "./types.js";
import { currentVariant, sectionText } from "./documentSections.js";

export interface DocumentSectionProps {
  aspect: StageAspect;
  busy: boolean;
  error?: string;
  progress?: AspectGenerationProgress;
  generator: VariantGenerator<string>;
  accumulated: AccumulatedContext;
  /** Записать раздел. `true` — записано; только тогда закрываются окна. */
  onPatchAspect: (aspectId: string, next: StageAspect) => Promise<boolean>;
  onBusy: (aspectId: string | null) => void;
  onError: (aspectId: string, message: string) => void;
  onProgress: (aspectId: string, p: AspectGenerationProgress | null) => void;
}

type OpenPanel = "none" | "edit" | "rewrite";

export function DocumentSection({
  aspect,
  busy,
  error,
  progress,
  generator,
  accumulated,
  onPatchAspect,
  onBusy,
  onError,
  onProgress,
}: DocumentSectionProps) {
  const [panel, setPanel] = useState<OpenPanel>("none");
  const [editText, setEditText] = useState("");
  const [instructions, setInstructions] = useState("");

  const text = sectionText(aspect);
  const shown = currentVariant(aspect);
  const alternatives = aspect.variants.filter(
    (v) => v.status !== "superseded" && v.status !== "rejected",
  );

  function openEdit(): void {
    setEditText(text ?? "");
    setPanel("edit");
  }

  async function handleSaveEdit(): Promise<void> {
    const payload = editText.trim();
    if (payload.length === 0) {
      onError(aspect.id, "Пустой раздел сохранить нельзя — используйте «Не нужен».");
      return;
    }
    const variant: AspectVariant = {
      id: crypto.randomUUID(),
      label: "моя правка",
      payloadKind: "markdown",
      payload,
      status: "accepted",
      editSource: "manual",
      generatedAt: new Date().toISOString(),
      ...(aspect.selectedVariantId !== undefined
        ? { parentVariantId: aspect.selectedVariantId }
        : {}),
    };
    const next: StageAspect = {
      ...aspect,
      status: "accepted",
      selectedVariantId: variant.id,
      finalPayload: payload,
      variants: [
        ...aspect.variants.map((v) =>
          v.id === aspect.selectedVariantId
            ? { ...v, status: "superseded" as const }
            : v.status === "accepted"
              ? { ...v, status: "rejected" as const }
              : v,
        ),
        variant,
      ],
    };
    // Окно закрывается только по факту записи: его содержимое — единственная
    // копия того, что автор набрал (В11 ревью 2026-09-19).
    if (await onPatchAspect(aspect.id, next)) {
      setPanel("none");
      setEditText("");
    }
  }

  async function runGenerator(
    refine: { variantId: string; payload: string; instructions: string } | null,
  ): Promise<void> {
    onError(aspect.id, "");
    onBusy(aspect.id);
    try {
      const variants = await generator.generate(
        {
          aspect,
          accumulated,
          ...(refine ? { refineFrom: refine } : {}),
        },
        (p) => onProgress(aspect.id, p),
      );
      const next: StageAspect = refine
        ? {
            ...aspect,
            status: "reviewing",
            variants: [
              ...aspect.variants.map((v) =>
                v.id === refine.variantId
                  ? { ...v, status: "superseded" as const }
                  : v,
              ),
              ...variants,
            ],
            ...(aspect.selectedVariantId !== undefined
              ? { selectedVariantId: undefined }
              : {}),
          }
        : {
            ...aspect,
            status: "reviewing",
            variants: [...aspect.variants, ...variants],
            ...(aspect.selectedVariantId !== undefined
              ? { selectedVariantId: undefined }
              : {}),
          };
      if (await onPatchAspect(aspect.id, next)) {
        setPanel("none");
        setInstructions("");
      }
    } catch (e) {
      onError(aspect.id, e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(null);
      onProgress(aspect.id, null);
    }
  }

  async function handleRewrite(): Promise<void> {
    if (!shown || typeof shown.payload !== "string") {
      onError(aspect.id, "Переписывать нечего: раздел пуст.");
      return;
    }
    const note = instructions.trim();
    if (note.length === 0) return;
    await runGenerator({
      variantId: shown.id,
      payload: shown.payload,
      instructions: note,
    });
  }

  async function handlePick(variant: AspectVariant): Promise<void> {
    await onPatchAspect(aspect.id, { ...aspect, selectedVariantId: variant.id });
  }

  async function handleSkip(): Promise<void> {
    await onPatchAspect(aspect.id, { ...aspect, status: "skipped" });
  }

  async function handleRestore(): Promise<void> {
    await onPatchAspect(aspect.id, {
      ...aspect,
      status: text === null ? "pending" : "reviewing",
    });
  }

  if (aspect.status === "skipped") {
    return (
      <section data-aspect-id={aspect.id} className="flex items-baseline gap-3 py-2 opacity-60">
        <h3 className="text-[15px]" style={{ fontFamily: "var(--font-display)" }}>
          {aspect.name}
        </h3>
        <span className="text-xs text-[var(--color-muted-foreground)]">не нужен</span>
        <button
          type="button"
          onClick={handleRestore}
          disabled={busy}
          className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
        >
          Вернуть раздел
        </button>
      </section>
    );
  }

  return (
    <section data-aspect-id={aspect.id} className="flex flex-col gap-2 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          className="text-[17px] text-[var(--color-text-strong)]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          {aspect.name}
        </h3>
        <div className="flex items-center gap-2">
          {aspect.source === "import" && (
            <span className="pill pill-brass">из ваших материалов</span>
          )}
          {aspect.status === "accepted" ? (
            <span className="lw-pill" data-tone="green">утверждён</span>
          ) : text !== null ? (
            <span className="lw-pill" data-tone="brass">черновик</span>
          ) : null}
        </div>
      </div>

      {aspect.description && (
        <p className="text-xs text-[var(--color-muted-foreground)]">{aspect.description}</p>
      )}

      {progress && <GenerationProgress progress={progress} label={`progress-${aspect.id}`} />}

      {panel === "edit" ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={12}
            aria-label={`Текст раздела «${aspect.name}»`}
            className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={busy}
              className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)]"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setPanel("none")}
              disabled={busy}
              className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : text === null ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Раздел пуст — соберите документ или напишите его сами.
        </p>
      ) : (
        <Markdown className="text-sm" text={text} />
      )}

      {alternatives.length > 1 && panel !== "edit" && (
        <ul className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
          {alternatives.map((v) => (
            <li key={v.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {v.label}
                </span>
                {v.id === shown?.id ? (
                  <span className="lw-pill" data-tone="green">показан</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePick(v)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Показать этот
                  </button>
                )}
              </div>
              {v.id !== shown?.id && typeof v.payload === "string" && (
                <Markdown className="text-xs opacity-80" text={v.payload} />
              )}
            </li>
          ))}
        </ul>
      )}

      {panel === "rewrite" && (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--color-brass)] pl-3">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            aria-label={`Что поменять в разделе «${aspect.name}»`}
            placeholder="Мрачнее. Убрать магию. Добавить порт."
            className="border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRewrite}
              disabled={busy || instructions.trim().length === 0}
              className="text-xs border border-[var(--color-brass)] text-[var(--color-brass)] rounded px-2 py-0.5 disabled:opacity-50"
            >
              Применить
            </button>
            <button
              type="button"
              onClick={() => {
                setPanel("none");
                setInstructions("");
              }}
              className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {panel === "none" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPanel("rewrite")}
            disabled={busy || text === null}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Переписать
          </button>
          <button
            type="button"
            onClick={() => runGenerator(null)}
            disabled={busy}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Другие варианты
          </button>
          <button
            type="button"
            onClick={openEdit}
            disabled={busy}
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Править
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            title="Раздел останется в списке — его можно вернуть"
            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
          >
            Не нужен
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/DocumentSection.test.tsx`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add apps/web/src/components/studio/aspect-engine/DocumentSection.tsx apps/web/src/components/studio/aspect-engine/__tests__/DocumentSection.test.tsx
git commit -m "feat(web): раздел документа с переписыванием, вариантами и ручной правкой"
```

---

### Task 6: Раннер документа

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/DocumentStageRunner.tsx`
- Test: `apps/web/src/components/studio/aspect-engine/__tests__/DocumentStageRunner.test.tsx`

**Interfaces:**
- Consumes: `mergeDocumentSections`, `approveAllSections`, `sectionText` (задача 4); `DocumentSection` (задача 5); `streamStageDocument` (задача 3); `createLLMMarkdownVariantGenerator` из `./llmGenerators.js`; `ManualAspectForm`.
- Produces:
  ```ts
  export interface DocumentStageRunnerProps {
    bookId: number;
    stageId: "world" | "lore";
    stageLabel: string;      // «Мир» / «Лор» — для подписей кнопок
    stage: StageState;
    revision: number;
    onPatch(expectedRevision: number, next: StageState): Promise<{ stage: StageState; revision: number }>;
    onReloadStage(): Promise<{ stage: StageState; revision: number }>;
  }
  export function DocumentStageRunner(props: DocumentStageRunnerProps): JSX.Element;
  ```

- [ ] **Step 1: Написать падающие тесты**

Create `apps/web/src/components/studio/aspect-engine/__tests__/DocumentStageRunner.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageState } from "@book-forge/shared";

const streamDocumentMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    streamStageDocument: (...args: unknown[]) => streamDocumentMock(...args),
  };
});

import { DocumentStageRunner } from "../DocumentStageRunner.js";

function emptyStage(over: Partial<StageState> = {}): StageState {
  return { status: "not_started", playbookGenerated: false, aspects: [], ...over };
}

function renderRunner(stage: StageState) {
  const onPatch = vi.fn().mockImplementation(async (_rev: number, next: StageState) => ({
    stage: next,
    revision: 2,
  }));
  const onReloadStage = vi.fn().mockResolvedValue({ stage, revision: 2 });
  render(
    <DocumentStageRunner
      bookId={1}
      stageId="world"
      stageLabel="Мир"
      stage={stage}
      revision={1}
      onPatch={onPatch}
      onReloadStage={onReloadStage}
    />,
  );
  return { onPatch, onReloadStage };
}

describe("DocumentStageRunner", () => {
  beforeEach(() => {
    streamDocumentMock.mockReset();
    streamDocumentMock.mockImplementation(async (_b, _s, _body, handlers) => {
      handlers.onDone({
        sections: [
          { name: "география", description: "рельеф", markdown: "Город на сваях." },
          { name: "власть", description: "кто правит", markdown: "Правит совет." },
        ],
        contextRef: { hash: "h", summary: "s", includedAspectIds: [], includedEntityIds: [] },
        modelId: "sonnet",
      });
    });
  });

  it("собирает весь документ одним нажатием и одним ожиданием", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(emptyStage());
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(streamDocumentMock).toHaveBeenCalledTimes(1);
    const next = onPatch.mock.calls[0]?.[1] as StageState;
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects.every((a) => a.status === "reviewing")).toBe(true);
  });

  it("заметки автора уходят в сборку и сохраняются вместе с ней", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(emptyStage());
    await user.type(screen.getByLabelText(/заметки/i), "Без магии.");
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    const body = streamDocumentMock.mock.calls[0]?.[2] as { authorNotes?: string };
    expect(body.authorNotes).toBe("Без магии.");
    expect((onPatch.mock.calls[0]?.[1] as StageState).authorNotes).toBe("Без магии.");
  });

  it("сохранённые заметки показываются при открытии этапа", () => {
    renderRunner(emptyStage({ authorNotes: "Зима круглый год." }));
    expect(screen.getByLabelText(/заметки/i)).toHaveValue("Зима круглый год.");
  });

  it("разделы с текстом уходят в сборку как неприкосновенные", async () => {
    const user = userEvent.setup();
    renderRunner(
      emptyStage({
        aspects: [
          {
            id: "a1",
            name: "власть",
            status: "accepted",
            order: 0,
            required: false,
            source: "import",
            payloadKind: "markdown",
            variants: [],
            finalPayload: "Правит совет старейшин.",
          },
          {
            id: "a2",
            name: "ремёсла",
            status: "pending",
            order: 1,
            required: false,
            source: "llm",
            payloadKind: "markdown",
            variants: [],
          },
        ],
      } as Partial<StageState>),
    );
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() => expect(streamDocumentMock).toHaveBeenCalled());
    const body = streamDocumentMock.mock.calls[0]?.[2] as {
      existingSections: Array<{ name: string; text: string }>;
      emptySectionNames: string[];
    };
    expect(body.existingSections).toEqual([
      { name: "власть", text: "Правит совет старейшин." },
    ]);
    expect(body.emptySectionNames).toEqual(["ремёсла"]);
  });

  it("«Утвердить мир» принимает весь документ одним изменением", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderRunner(
      emptyStage({
        status: "in_progress",
        aspects: [
          {
            id: "a1",
            name: "география",
            status: "reviewing",
            order: 0,
            required: false,
            source: "llm",
            payloadKind: "markdown",
            variants: [
              {
                id: "v1",
                label: "документ",
                payloadKind: "markdown",
                payload: "Город на сваях.",
                status: "generated",
                editSource: "llm",
                generatedAt: "2026-09-22T00:00:00.000Z",
              },
            ],
          },
        ],
      } as Partial<StageState>),
    );
    await user.click(screen.getByRole("button", { name: "Утвердить мир" }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const next = onPatch.mock.calls[0]?.[1] as StageState;
    expect(next.aspects[0]?.status).toBe("accepted");
    expect(next.aspects[0]?.finalPayload).toBe("Город на сваях.");
  });

  it("утверждать нечего — кнопка выключена", () => {
    renderRunner(emptyStage());
    expect(screen.getByRole("button", { name: "Утвердить мир" })).toBeDisabled();
  });

  it("отказ сборки виден и не оставляет экран в «идёт сборка»", async () => {
    const user = userEvent.setup();
    streamDocumentMock.mockImplementation(async (_b, _s, _body, handlers) => {
      handlers.onError("модель недоступна");
    });
    const { onPatch } = renderRunner(emptyStage());
    await user.click(screen.getByRole("button", { name: "Собрать мир" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("модель недоступна"),
    );
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Собрать мир" })).toBeEnabled();
  });

  it("конфликт ревизии не затирает чужую правку раздела", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const stage = emptyStage({
      status: "in_progress",
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "reviewing",
          order: 0,
          required: false,
          source: "llm",
          payloadKind: "markdown",
          variants: [
            {
              id: "v1",
              label: "документ",
              payloadKind: "markdown",
              payload: "Город на сваях.",
              status: "generated",
              editSource: "llm",
              generatedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        },
      ],
    } as Partial<StageState>);
    const onPatch = vi.fn().mockRejectedValueOnce(conflict);
    // Чужая версия ТОГО ЖЕ раздела: повторять поверх нельзя.
    const theirs = structuredClone(stage);
    theirs.aspects[0]!.name = "география (правил кто-то другой)";
    const onReloadStage = vi.fn().mockResolvedValue({ stage: theirs, revision: 9 });
    render(
      <DocumentStageRunner
        bookId={1}
        stageId="world"
        stageLabel="Мир"
        stage={stage}
        revision={1}
        onPatch={onPatch}
        onReloadStage={onReloadStage}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Править" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onReloadStage).toHaveBeenCalled());
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/изменили в другом месте/i);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/DocumentStageRunner.test.tsx`
Expected: FAIL — «Cannot find module '../DocumentStageRunner.js'».

- [ ] **Step 3: Реализация**

Create `apps/web/src/components/studio/aspect-engine/DocumentStageRunner.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ContextRef, StageAspect, StageState } from "@book-forge/shared";
import {
  streamStageDocument,
  type AspectGenerationProgress,
  type StageDocumentSection,
} from "@/api/client";
import { GenerationProgress } from "./GenerationProgress.js";
import { ManualAspectForm } from "./ManualAspectForm.js";
import { DocumentSection } from "./DocumentSection.js";
import { createLLMMarkdownVariantGenerator } from "./llmGenerators.js";
import {
  approveAllSections,
  mergeDocumentSections,
  sectionText,
} from "./documentSections.js";
import type { AccumulatedContext } from "./types.js";

export interface DocumentStageRunnerProps {
  bookId: number;
  stageId: "world" | "lore";
  /** «Мир» / «Лор» — подписи кнопок собираются из него. */
  stageLabel: string;
  stage: StageState;
  revision: number;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
  onReloadStage: () => Promise<{ stage: StageState; revision: number }>;
}

/** Винительный падеж для кнопок: «Собрать мир», «Утвердить лор». */
const ACCUSATIVE: Record<"world" | "lore", string> = {
  world: "мир",
  lore: "лор",
};

const CONFLICT_MESSAGE =
  "Этот раздел изменили в другом месте, пока вы правили. Ваш текст остался" +
  " на экране: скопируйте его, обновите страницу и вставьте заново — иначе" +
  " пропадёт чужая правка.";

export function DocumentStageRunner({
  bookId,
  stageId,
  stageLabel,
  stage,
  revision,
  onPatch,
  onReloadStage,
}: DocumentStageRunnerProps) {
  const [assembling, setAssembling] = useState(false);
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>({});
  const [stageError, setStageError] = useState<string | null>(null);
  const [progressByAspect, setProgressByAspect] = useState<
    Record<string, AspectGenerationProgress>
  >({});
  const [assembleProgress, setAssembleProgress] =
    useState<AspectGenerationProgress | null>(null);

  const [notes, setNotes] = useState(stage.authorNotes ?? "");
  const lastNotesProp = useRef(stage.authorNotes ?? "");

  // Состояние Мастерской догружается и перечитывается после каждой записи.
  // Безусловный резинк стирал бы то, что автор набирает прямо сейчас, — та же
  // защита, что стоит на замысле в ConceptStage и на заметках главы.
  useEffect(() => {
    const incoming = stage.authorNotes ?? "";
    if (incoming === lastNotesProp.current) return;
    const untouched = notes === lastNotesProp.current;
    lastNotesProp.current = incoming;
    if (untouched) setNotes(incoming);
  }, [stage.authorNotes, notes]);

  const generator = createLLMMarkdownVariantGenerator({ bookId, stageId });

  const accumulated: AccumulatedContext = {
    acceptedAspects: stage.aspects
      .filter((a) => a.status === "accepted" && a.finalPayload !== undefined)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ id: a.id, name: a.name, finalPayload: a.finalPayload })),
  };

  function setAspectError(aspectId: string, message: string): void {
    setErrorByAspect((p) => ({ ...p, [aspectId]: message }));
  }

  function setAspectProgress(
    aspectId: string,
    p: AspectGenerationProgress | null,
  ): void {
    setProgressByAspect((prev) => {
      if (p === null) {
        if (!(aspectId in prev)) return prev;
        const copy = { ...prev };
        delete copy[aspectId];
        return copy;
      }
      return { ...prev, [aspectId]: p };
    });
  }

  /** Патч одного раздела. На 409 состояние перечитывается, и меняется ТОЛЬКО
   *  свой раздел: конфликт вызывает и правка соседнего (её бережём), и правка
   *  этого же из второй вкладки (тогда писать поверх нельзя). */
  async function patchAspect(
    aspectId: string,
    nextAspect: StageAspect,
  ): Promise<boolean> {
    setAspectError(aspectId, "");
    setBusyAspectId(aspectId);
    try {
      await onPatch(revision, withAspect(stage, aspectId, nextAspect));
      return true;
    } catch (e) {
      if ((e as { status?: number } | null)?.status === 409) {
        try {
          const fresh = await onReloadStage();
          const before = stage.aspects.find((a) => a.id === aspectId);
          const theirs = fresh.stage.aspects.find((a) => a.id === aspectId);
          const sameBase =
            before !== undefined &&
            theirs !== undefined &&
            JSON.stringify(before) === JSON.stringify(theirs);
          if (sameBase) {
            await onPatch(
              fresh.revision,
              withAspect(fresh.stage, aspectId, nextAspect),
            );
            return true;
          }
          setAspectError(aspectId, CONFLICT_MESSAGE);
          return false;
        } catch (retryError) {
          setAspectError(
            aspectId,
            retryError instanceof Error ? retryError.message : String(retryError),
          );
          return false;
        }
      }
      setAspectError(aspectId, e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusyAspectId(null);
    }
  }

  async function handleAssemble(): Promise<void> {
    setStageError(null);
    setAssembling(true);
    const trimmedNotes = notes.trim();
    const live = stage.aspects.filter((a) => a.status !== "skipped");
    const existingSections: Array<{ name: string; text: string }> = [];
    const emptySectionNames: string[] = [];
    for (const a of live) {
      const text = sectionText(a);
      if (text === null) emptySectionNames.push(a.name);
      else existingSections.push({ name: a.name, text });
    }
    try {
      const done = await new Promise<{
        sections: StageDocumentSection[];
        contextRef: ContextRef;
        modelId: string;
      }>((resolve, reject) => {
        streamStageDocument(
          bookId,
          stageId,
          {
            existingSections,
            emptySectionNames,
            ...(trimmedNotes.length > 0 ? { authorNotes: trimmedNotes } : {}),
          },
          {
            onProgress: setAssembleProgress,
            onDone: resolve,
            onError: (message) => reject(new Error(message)),
          },
        ).catch(reject);
      });
      const merged = mergeDocumentSections(stage, done.sections, {
        contextRef: done.contextRef,
        modelId: done.modelId,
      });
      await onPatch(revision, withNotes(merged, trimmedNotes));
    } catch (e) {
      setStageError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssembling(false);
      setAssembleProgress(null);
    }
  }

  async function handleApprove(): Promise<void> {
    const next = approveAllSections(stage);
    if (!next) return;
    setStageError(null);
    setAssembling(true);
    try {
      await onPatch(revision, withNotes(next, notes.trim()));
    } catch (e) {
      setStageError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssembling(false);
    }
  }

  const accusative = ACCUSATIVE[stageId];
  const busy = assembling || busyAspectId !== null;
  const hasSomethingToApprove = approveAllSections(stage) !== null;
  const emptyCount = stage.aspects.filter(
    (a) => a.status !== "skipped" && sectionText(a) === null,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="stage-author-notes" className="text-sm">
          Ваши заметки к этапу
        </label>
        <textarea
          id="stage-author-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          aria-label={`Ваши заметки к этапу «${stageLabel}»`}
          placeholder="Что здесь обязательно должно быть. Модель это не отменит."
          className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAssemble}
            disabled={busy}
            className="text-sm border border-[var(--color-brass)] text-[var(--color-brass)] rounded-md px-3 py-1 hover:bg-[var(--color-brass)] hover:text-[var(--color-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {assembling
              ? "Собираем…"
              : stage.aspects.length === 0
                ? `Собрать ${accusative}`
                : emptyCount > 0
                  ? `Дописать недостающее (${emptyCount})`
                  : `Собрать ${accusative}`}
          </button>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Разделы, где уже есть текст, остаются как есть.
          </span>
        </div>
        {assembleProgress && (
          <GenerationProgress progress={assembleProgress} label="progress-document" />
        )}
        {stageError && (
          <p role="alert" className="text-xs text-[var(--color-ink-red-fg)]">
            {stageError}
          </p>
        )}
      </div>

      {stage.aspects.length > 0 && (
        <div className="flex flex-col divide-y divide-[var(--color-border-soft)]">
          {[...stage.aspects]
            .sort((a, b) => a.order - b.order)
            .map((aspect) => (
              <DocumentSection
                key={aspect.id}
                aspect={aspect}
                busy={busy}
                {...(errorByAspect[aspect.id]
                  ? { error: errorByAspect[aspect.id] }
                  : {})}
                {...(progressByAspect[aspect.id]
                  ? { progress: progressByAspect[aspect.id] }
                  : {})}
                generator={generator}
                accumulated={accumulated}
                onPatchAspect={patchAspect}
                onBusy={setBusyAspectId}
                onError={setAspectError}
                onProgress={setAspectProgress}
              />
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy || !hasSomethingToApprove}
          className="text-sm border border-[var(--color-brass)] bg-[var(--color-brass)] text-[var(--color-bg)] rounded-md px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Утвердить {accusative}
        </button>
        {emptyCount > 0 && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            Пустых разделов: {emptyCount}. Их можно оставить или пометить «Не нужен».
          </span>
        )}
      </div>

      <ManualAspectForm
        stage={stage}
        revision={revision}
        payloadKind="markdown"
        onPatch={onPatch}
      />
    </div>
  );
}

function withAspect(
  stage: StageState,
  aspectId: string,
  next: StageAspect,
): StageState {
  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: stage.aspects.map((a) => (a.id === aspectId ? next : a)),
    updatedAt: new Date().toISOString(),
  };
}

function withNotes(stage: StageState, notes: string): StageState {
  if (notes.length === 0) {
    const { authorNotes: _dropped, ...rest } = stage;
    return rest;
  }
  return { ...stage, authorNotes: notes };
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/aspect-engine/__tests__/DocumentStageRunner.test.tsx`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add apps/web/src/components/studio/aspect-engine/DocumentStageRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/DocumentStageRunner.test.tsx
git commit -m "feat(web): документный раннер этапа — сборка, разделы, утверждение"
```

---

### Task 7: Экран этапа, «Не нужен» и снос старого раннера

**Files:**
- Modify: `apps/web/src/pages/MarkdownStagePage.tsx`
- Modify: `apps/web/src/components/studio/StageSkipControl.tsx:60-72`
- Delete: `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx`
- Delete: `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx`
- Delete: `apps/web/src/components/studio/aspect-engine/__tests__/BatchGenerate.test.tsx`
- Modify: `apps/web/src/components/studio/aspect-engine/__tests__/ManualAuthoring.test.tsx` (если он рендерит `AspectRunner` — перевести на `DocumentStageRunner`; если рендерит `ManualAspectForm` напрямую, не трогать)
- Test: `apps/web/src/pages/__tests__/MarkdownStagePage.test.tsx` (создать, если такого нет)

**Interfaces:**
- Consumes: `DocumentStageRunner` (задача 6).
- Produces: экран этапа без `PlaybookRunner` и `AspectRunner`.

- [ ] **Step 1: Написать падающий тест экрана**

Create `apps/web/src/pages/__tests__/MarkdownStagePage.test.tsx` (посмотреть соседний `ChaptersStagePage.test.tsx` — способ подмены `api` и роутера брать оттуда, второй свой не заводить):

```tsx
  it("этап открывается сразу документом, без шага «сначала план»", async () => {
    // Пустой этап: раньше здесь стоял PlaybookRunner и требовал отдельного
    // вызова модели за списком разделов.
    renderStage({ status: "not_started", playbookGenerated: false, aspects: [] });
    expect(await screen.findByRole("button", { name: "Собрать мир" })).toBeInTheDocument();
    expect(screen.queryByText(/план этапа/i)).not.toBeInTheDocument();
  });

  it("пропущенный этап говорит «не нужен» и возвращается", async () => {
    renderStage({ status: "skipped", playbookGenerated: false, aspects: [] });
    expect(await screen.findByText(/не нужен/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вернуть этап" })).toBeInTheDocument();
  });
```

И к `StageSkipControl` — тест в его файле (или в `apps/web/src/components/studio/__tests__/StageSkipControl.test.tsx`, если он есть):

```tsx
  it("у необязательного этапа кнопка называет решение, а не действие", () => {
    render(<StageSkipControl stageId="lore" stage={stage} revision={1} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Этап не нужен" })).toBeInTheDocument();
  });

  it("у обязательного этапа остаётся «Пропустить этап»", () => {
    render(<StageSkipControl stageId="plot" stage={stage} revision={1} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Пропустить этап" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `pnpm --filter @book-forge/web test -- src/pages/__tests__/MarkdownStagePage.test.tsx src/components/studio/__tests__/StageSkipControl.test.tsx`
Expected: FAIL — кнопки «Собрать мир» и «Этап не нужен» не найдены.

- [ ] **Step 3: Переписать экран**

В `apps/web/src/pages/MarkdownStagePage.tsx` убрать импорты `AspectRunner`, `PlaybookRunner`, `createMarkdownAdapter`, `createLLMMarkdownVariantGenerator`, `createLLMPlaybookGenerator` и три локальные переменные `adapter` / `playbookGenerator` / `variantGenerator`. Блок «Workspace» заменить на:

```tsx
        {/* Workspace */}
        <div className="card">
          {stage.status === "skipped" ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Этап помечен как не нужный. Генерация главы обойдётся без него —
              вернуть можно в любой момент.
            </p>
          ) : (
            <DocumentStageRunner
              bookId={bookId}
              stageId={stageId}
              stageLabel={STAGE_LABELS[stageId]}
              stage={stage}
              revision={studio.revision}
              onPatch={handlePatch}
              onReloadStage={handleReloadStage}
            />
          )}
        </div>
```

и добавить импорт:

```tsx
import { DocumentStageRunner } from "@/components/studio/aspect-engine/DocumentStageRunner";
```

Заодно убрать локальные `MARKDOWN_STAGES` и `isMarkdownStage` (строки 38–45) и перевести проверку параметра маршрута на общий список:

```tsx
import { isDocumentStage, stageIdSchema } from "@book-forge/shared";
// …
  const stageParse = stageIdSchema.safeParse(rawStageId);
  if (!stageParse.success || !isDocumentStage(stageParse.data)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "world" | "lore" = stageParse.data;
```

Третья копия списка «мир, лор» в экране — ровно то, из-за чего этап оказался бы документным для одного читателя и аспектным для другого.

`handleReloadStage` остаётся как есть — он уже отдаёт то, что нужно раннеру.

- [ ] **Step 4: «Не нужен»**

В `apps/web/src/components/studio/StageSkipControl.tsx` заменить подпись кнопки пропуска:

```tsx
          {busy
            ? "…"
            : isOptionalStage(stageId)
              ? "Этап не нужен"
              : "Пропустить этап"}
```

Слово выбрано намеренно: «пропустить» звучит как отложить, а `skipped` у необязательного этапа значит «книге он не требуется» — и именно так его читают рекомендатор и сборка контекста.

- [ ] **Step 5: Снести старый раннер**

```bash
git rm apps/web/src/components/studio/aspect-engine/AspectRunner.tsx \
       apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx \
       apps/web/src/components/studio/aspect-engine/__tests__/BatchGenerate.test.tsx
```

`PlaybookRunner`, `markdownAdapter`, `createLLMPlaybookGenerator` и `ManualAspectForm` НЕ удалять: первыми тремя пользуется `EntityStagePage`, последним — новый раннер. Если `ManualAuthoring.test.tsx` рендерил `AspectRunner`, перевести его на `DocumentStageRunner`; сами проверки ручного заведения раздела сохранить — они про `ManualAspectForm`, а он остался.

Пакетная генерация «Сгенерировать все оставшиеся» уходит вместе с `AspectRunner` намеренно: она существовала ровно потому, что каждый раздел стоил своего вызова. Один вызов на документ делает её лишней.

- [ ] **Step 6: Тесты зелёные**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS. Упавшие тесты, которые ссылались на удалённые файлы, — удалить вместе с файлами; тесты, проверяющие поведение, которое переехало, — перевести на новый раннер, а не выбросить.

- [ ] **Step 7: Полная проверка и коммит**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0

```bash
git add -A apps/web/src
git commit -m "feat(web): этап мира и лора стал документом; пропуск называется «Не нужен»"
```

---

### Task 8: Быстрый сбор собирает документ одним вызовом

**Files:**
- Modify: `apps/server/src/utils/quick-start-run.ts` (`generateStage`, ~строка 189)
- Test: `apps/server/src/utils/__tests__/quick-start-run.test.ts` (существующий; если его нет — найти тот, что покрывает быстрый сбор, и дописать в него)

**Interfaces:**
- Consumes: `runAspectDocument`, `toStoredDocumentVariant` (задача 2).
- Produces: для `world` и `lore` быстрый сбор делает **один** вызов модели вместо `aspect_playbook` + N × `aspect_variants`.

- [ ] **Step 1: Написать падающий тест**

Дописать в тест быстрого сбора:

```ts
  it("мир собирается одним вызовом, а не плейбуком и вариантами", async () => {
    documentMock.mockResolvedValue({
      sections: [
        { name: "география", description: "рельеф", markdown: "Текст географии." },
        { name: "власть", description: "кто правит", markdown: "Текст власти." },
      ],
    });
    await runQuickStart(deps, { bookId, onStage: () => {} });
    expect(documentMock).toHaveBeenCalled();
    expect(playbookMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ stageId: "world" }),
      expect.anything(),
    );
    const world = repo.loadStudioState(bookId).stages.world;
    expect(world?.aspects).toHaveLength(2);
    // Правило «без автора ничего не утверждается» держится и здесь.
    expect(world?.aspects.every((a) => a.status === "reviewing")).toBe(true);
  });

  it("этап с уже заполненными разделами быстрый сбор не трогает и вызова не тратит", async () => {
    const state = repo.loadStudioState(bookId);
    repo.saveStudioState(bookId, state.revision, {
      ...state,
      stages: {
        ...state.stages,
        world: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "a1",
              name: "власть",
              status: "accepted",
              order: 0,
              required: false,
              source: "import",
              payloadKind: "markdown",
              variants: [
                {
                  id: "v1",
                  label: "из материалов",
                  payloadKind: "markdown",
                  payload: "Правит совет.",
                  status: "accepted",
                  editSource: "manual",
                  generatedAt: "2026-09-22T00:00:00.000Z",
                },
              ],
              selectedVariantId: "v1",
              finalPayload: "Правит совет.",
            },
          ],
        },
      },
    });
    documentMock.mockClear();

    await runQuickStart(deps, { bookId, onStage: () => {} });

    const world = repo.loadStudioState(bookId).stages.world;
    expect(world?.aspects).toHaveLength(1);
    expect(world?.aspects[0]?.finalPayload).toBe("Правит совет.");
    // Пустых разделов нет, писать нечего — платить за вызов не за что.
    const worldCalls = documentMock.mock.calls.filter(
      (c) => (c[0] as { stageId: string }).stageId === "world",
    );
    expect(worldCalls).toHaveLength(0);
  });
```

Моки агентов брать теми же, что уже стоят в файле (`vi.mock("@book-forge/agents/aspects/playbook")` и соседи), добавив к ним `vi.mock("@book-forge/agents/aspects/document")`.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/quick-start-run.test.ts`
Expected: FAIL — `documentMock` не вызывался.

- [ ] **Step 3: Реализация**

В `apps/server/src/utils/quick-start-run.ts` добавить импорт:

```ts
import {
  runAspectDocument,
  toStoredDocumentVariant,
} from "@book-forge/agents/aspects/document";
```

а `isDocumentStage` — к существующему импорту из `@book-forge/shared`.

В `generateStage`, сразу после ветки `if (stageId === "plot")`, добавить ветку документа — **до** чтения плейбука:

```ts
  if (isDocumentStage(stageId)) {
    await generateDocumentStage(deps, stageId);
    return;
  }
```

и саму функцию:

```ts
/** Мир и лор собираются одним вызовом: раздел документа и есть аспект этапа.
 *  Плейбук с вариантами на каждый раздел давал те же черновики за шесть-семь
 *  вызовов вместо одного — фаза 3 конвейера. Разделы, где текст уже есть,
 *  уходят в промпт как материал автора и не переписываются. */
async function generateDocumentStage(
  deps: QuickStartDeps,
  stageId: StageId,
): Promise<void> {
  const { repo, bookId } = deps;
  const concept = repo.loadConcept(bookId);
  const stage = repo.loadStudioState(bookId).stages[stageId];
  const live = (stage?.aspects ?? []).filter((a) => a.status !== "skipped");
  const existingSections: Array<{ name: string; text: string }> = [];
  const emptySectionNames: string[] = [];
  for (const a of live) {
    const text =
      typeof a.finalPayload === "string" && a.finalPayload.trim()
        ? a.finalPayload
        : a.variants.find((v) => typeof v.payload === "string" && v.payload.trim())
            ?.payload;
    if (typeof text === "string" && text.trim()) {
      existingSections.push({ name: a.name, text });
    } else {
      emptySectionNames.push(a.name);
    }
  }

  const contextRef = buildContextRef({
    stageId,
    concept,
    accumulated: existingSections.map((s) => ({
      id: s.name,
      name: s.name,
      finalPayload: s.text,
    })),
    extra: { kind: "document", emptySectionNames },
  });

  const result = await runAspectDocument({
    stageId,
    concept,
    existingSections,
    emptySectionNames,
    ...(stage?.authorNotes !== undefined ? { authorNotes: stage.authorNotes } : {}),
    contextRef,
  });

  const modelId = aspectModelLabel("aspect_document");
  patchStage(deps, stageId, (current) => {
    const byName = new Map(
      current.aspects.map((a) => [a.name.trim().toLocaleLowerCase("ru"), a] as const),
    );
    let maxOrder = current.aspects.reduce((m, a) => Math.max(m, a.order), -1);
    const added: typeof current.aspects = [];
    const updated = new Map<string, (typeof current.aspects)[number]>();
    for (const section of result.sections) {
      const variant = toStoredDocumentVariant(section, { contextRef, modelId });
      const existing = byName.get(section.name.trim().toLocaleLowerCase("ru"));
      if (!existing) {
        maxOrder += 1;
        added.push({
          id: randomUUID(),
          name: section.name,
          description: section.description,
          status: "reviewing",
          order: maxOrder,
          required: false,
          source: "llm",
          payloadKind: "markdown",
          variants: [variant],
        });
        continue;
      }
      if (existing.status === "skipped") continue;
      const hasText =
        (typeof existing.finalPayload === "string" && existing.finalPayload.trim()) ||
        existing.variants.some(
          (v) => typeof v.payload === "string" && v.payload.trim(),
        );
      if (hasText) continue;
      updated.set(existing.id, {
        ...existing,
        status: "reviewing",
        variants: [...existing.variants, variant],
      });
    }
    return {
      ...current,
      aspects: [
        ...current.aspects.map((a) => updated.get(a.id) ?? a),
        ...added,
      ],
    };
  });
}
```

Проверить имена `patchStage`, `randomUUID`, `aspectModelLabel`, `buildContextRef` по самому файлу: часть из них там уже импортирована, часть, возможно, придётся добавить. Логика слияния здесь повторяет `mergeDocumentSections` с фронта намеренно — общего кода между `apps/server` и `apps/web` нет, а тащить её в `@book-forge/shared` ради одного вызывающего с каждой стороны дороже, чем два коротких прохода; если ревью решит иначе, переносить надо вместе с тестами задачи 4.

Проверка занятости этапа (`existing.length > 0` → `fillVariants`) для документных этапов больше не работает: ветка документа стоит до неё и сама решает, что дописывать. Убедиться, что этап, где всё уже заполнено, ничего не зовёт впустую: если `emptySectionNames` пуст и `existingSections` непуст, **вызова быть не должно** — вставить ранний выход до `runAspectDocument`:

```ts
  if (emptySectionNames.length === 0 && existingSections.length > 0) {
    return;
  }
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/quick-start-run.test.ts`
Expected: PASS

- [ ] **Step 5: Полная проверка и коммит**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0

```bash
git add apps/server/src/utils/quick-start-run.ts apps/server/src/utils/__tests__/quick-start-run.test.ts
git commit -m "perf(server): быстрый сбор пишет мир и лор одним вызовом вместо семи"
```

---

### Task 9: Документация

**Files:**
- Modify: `CLAUDE.md` (новый абзац после «Один план книги (2026-09-06, фаза 5 конвейера)»)
- Modify: `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md` (раздел 6, «Фаза 3»)

- [ ] **Step 1: Абзац в CLAUDE.md**

Дописать:

```markdown
**Документные этапы (2026-09-22, фаза 3 конвейера):** «Мир» и «Лор» перестали быть списком аспектов с вариантами на каждый. Внутри модель прежняя — раздел документа и есть аспект `studio_state`, — снаружи этап проходится двумя нажатиями и одним ожиданием: «Собрать мир» (агент `aspect_document`, [document.ts](packages/agents/src/aspects/document.ts), один вызов на весь документ, свой `timeoutMs` 600 с и `maxTokens` 16000) и «Утвердить мир». Прежняя связка «плейбук → варианты на каждый раздел» стоила семи вызовов и стольких же ожиданий. **«Собрать» не переписывает то, у чего уже есть текст:** такой раздел уходит в промпт материалом автора, пустые пишутся под своими именами, а пропущенный не воскрешается — иначе кнопка затирала бы то, что положил интейк. Всё приходит в статусе `reviewing`: правило «без автора ничего не утверждается» кнопка сборки не отменяет. Заметки автора к этапу хранятся (`StageState.authorNotes`, миграции не нужно — это JSON-колонка) и уходят в каждую сборку: вызов идёт минутами, и терять набранное при обновлении страницы нельзя, а «Переписать» отдельного раздела обязан учитывать те же ограничения. У раздела три действия, и все три бьют в уже существовавшие маршруты: «Переписать» — `aspect_refine` по указанию автора, «Другие варианты» — `aspect_variants`, «Править» — ручная правка, сохраняемая принятым вариантом `manual`. `AspectRunner` удалён: после переезда экрана у него не осталось вызывающих, а пакетная генерация «Сгенерировать все оставшиеся» ушла вместе с ним — она существовала ровно потому, что раздел стоил вызова. `PlaybookRunner` остался, им пользуется этап персонажей. И `deriveStageStatus` больше не выводит `skipped` из «все разделы улажены, ни один не принят»: это и был дефект «ничего не принял = готово», из-за которого рекомендатор вёл дальше с пустого этапа. `skipped` ставит только кнопка «Этап не нужен», и только у необязательных этапов. Предметы в фазу 3 не вошли намеренно: они материализуются в таблицу `items`, которую читает агент лора, и перевод их в прозу разорвал бы эту связь — их закрывает фаза 4 вместе с персонажами.
```

- [ ] **Step 2: Отметка в спецификации**

В разделе «### Фаза 3» дописать после абзаца приёмки:

```markdown
**Выполнено 2026-09-22** по плану
[docs/superpowers/plans/2026-09-22-pipeline-phase-3-document-stages.md](../plans/2026-09-22-pipeline-phase-3-document-stages.md).

Разошлось с реализацией: предметы в фазу не вошли. Абзац написан 2026-09-04,
когда предметы были документным этапом; с тех пор они стали составом
кандидатов, который «Добавить в канон» материализует в таблицу `items`, а её
читает агент лора. Перевод их в прозу разорвал бы эту связь и осиротил уже
заведённые предметы, поэтому предметы закрывает фаза 4 вместе с персонажами —
там тот же экран составов. Решение автора, 2026-09-22.
```

И в строке фазы 4 заменить «Предметы остаются документным этапом фазы 3» на «Предметы закрываются здесь же: этап составов, «Утвердить предметы» = материализация».

- [ ] **Step 3: Коммит**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md
git commit -m "docs: документные этапы — раздел в CLAUDE.md и правка спецификации по факту"
```

---

## Приёмка фазы

1. Новая книга, этап «Мир» пустой → одно нажатие «Собрать мир», одно ожидание, документ из 5–9 разделов на экране черновиком; второе нажатие «Утвердить мир» — этап «Утверждён». Ровно два нажатия и одно ожидание.
2. Этап, куда интейк положил разделы, «Собрать» не переписывает: текст автора на месте, дописаны только пустые.
3. `skipped` не появляется сам: этап, где все разделы помечены «Не нужен» поштучно, остаётся «Черновик»; «Этап не нужен» ставит `skipped`, «Вернуть этап» снимает.
4. Быстрый сбор тратит на мир и лор по одному вызову.
5. `pnpm typecheck` чисто, `pnpm test` exit 0.
