# Конвейер автора, фаза 1 «Замысел» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автор создаёт книгу одним текстом задумки, получает 3–5 конкурирующих питчей, смешивает и выбирает, утверждает замысел; форма концепта с пикерами жанра/тона/аудитории и ручными полями премисы исчезает.

**Architecture:** Замысел живёт в `books.concept` (TEXT JSON) без миграции: схема `BookConcept` расширяется опциональными полями `pitches`, `selectedPitchId`, `lockedAt`, `genre`, `tone`, `hook`; старые записи нормализуются при чтении. Два новых структурных агента `pitch_generator` и `pitch_blender` заменяют `concept_from_idea`; `concept_refiner` остаётся как «другие формулировки» строки. Четыре новых маршрута на `studio.ts` (`pitches`, `pitches/blend`, `lock`, `unlock`), `POST /books` принимает `idea` вместо `title`. В web три новых компонента (`IdeaIntake`, `PitchBoard`+`PitchCard`, `ConceptCard`) под контейнером `ConceptStage`, который ветвится по состоянию замысла. Промпты всех потребителей концепта переходят на строки `genre`/`tone`.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Node 22, zod 4.4, Hono, better-sqlite3, React 18, Vite 6, vitest, @testing-library/react, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md` (раздел 3 «Путь автора», шаги 1–3; раздел 5 «Модель данных»; раздел 6 «Фаза 1»).

## Global Constraints

- Node 22 LTS, ESM only, TypeScript strict с `noUncheckedIndexedAccess`. `Map.get`, индекс массива и `[0]` возвращают `T | undefined` — всегда обрабатывать.
- Импорты между пакетами только через `workspace:*` и поле `exports` в `package.json`. Новый файл агента = новая строка в `packages/agents/package.json` `exports`.
- Миграций БД в этой фазе нет. `schemaVersion` концепта остаётся `1`, новые поля опциональны или с `.default()`.
- Новый агент = имя в `AGENT_NAMES` и в `STRUCTURED_AGENT_NAMES` (`packages/llm/src/types.ts`), запись в `DEFAULT_AGENT_BACKEND` (`packages/llm/src/router.ts`), контракт в `packages/agents/src/...`, регистрация в `packages/agents/src/bootstrap.ts`. Тест `packages/llm/src/__tests__/structured-agents-parity.test.ts` падает, если списки расходятся.
- Модель для концепт-агентов: `"sonnet"` по умолчанию, `maxTokens` явно. `temperature` передавать только условно: `...(options.temperature !== undefined ? { temperature: options.temperature } : {})`.
- Тесты не ходят в LLM. Серверные тесты мокают модуль агента `vi.mock("@book-forge/agents/concept/<file>", ...)` ДО импорта `./_helpers.js`. Web-тесты мокают `@/api/client`.
- Все тексты интерфейса на русском. В интерфейсе нет слов «Концепт», «Премиса», «Логлайн», «Протагонист», «Ставки», имён агентов. Подписи полей берутся из `PITCH_FIELD_LABELS`.
- Десктоп-only: мобильную вёрстку не делать и не проверять.
- Каждая задача заканчивается зелёными `pnpm typecheck` и `pnpm test` и своим коммитом. Коммиты без упоминания путей vault и session URL.
- Команды запуска тестов из корня репозитория:
  - shared: `pnpm --filter @book-forge/shared test -- src/concept.test.ts`
  - agents: `pnpm --filter @book-forge/agents test -- src/concept/__tests__/pitches.test.ts`
  - llm: `pnpm --filter @book-forge/llm test`
  - server: `pnpm --filter @book-forge/server test -- src/routes/__tests__/concept-pitches.test.ts`
  - web: `pnpm --filter @book-forge/web test -- src/components/studio/concept/__tests__/PitchBoard.test.tsx`

---

## Карта файлов

**Создать**
- `packages/agents/src/concept/pitches.ts` — контракт и раннер `pitch_generator`, `toPitches`, `buildPitchGeneratorPrompt`.
- `packages/agents/src/concept/pitch-blend.ts` — контракт и раннер `pitch_blender`, `buildPitchBlenderPrompt`.
- `packages/agents/src/concept/__tests__/pitches.test.ts`, `pitch-blend.test.ts`.
- `apps/server/src/routes/__tests__/concept-pitches.test.ts`.
- `apps/web/src/components/studio/concept/IdeaIntake.tsx`, `PitchCard.tsx`, `PitchBoard.tsx`, `ConceptCard.tsx`, `ConceptStage.tsx`.
- `apps/web/src/components/studio/concept/__tests__/IdeaIntake.test.tsx`, `PitchBoard.test.tsx`, `ConceptCard.test.tsx`, `ConceptStage.test.tsx`.

**Изменить**
- `packages/shared/src/concept.ts` — схема питча, новые поля, `normalizeConcept`, `lockConceptToPitch`, `unlockConcept`, `isConceptComplete`, `PITCH_FIELD_LABELS`, `AUDIENCE_LABELS`.
- `packages/shared/src/concept.test.ts`, `studio-warnings.ts`, `studio-warnings.test.ts`, `book.ts`, `index.ts`.
- `packages/llm/src/types.ts`, `router.ts`.
- `packages/agents/src/bootstrap.ts`, `package.json`, `src/concept/refiner.ts`, `src/aspects/variants.ts`, `src/aspects/entity-variants.ts`.
- `apps/server/src/routes/studio.ts`, `books.ts`, `db/studio.ts`, `utils/studio-context.ts`, `scripts/import-studio-sources.ts` и их тесты.
- `apps/web/src/api/client.ts`, `pages/BooksListPage.tsx` (+test), `pages/StudioPage.tsx` (+test), `components/studio/concept/PremiseFieldPuzzle.tsx`, `components/studio/StageStepper.tsx` (+test), `pages/MarkdownStagePage.tsx`, `components/shell/AppShell.tsx`, `components/OutlinePanel.tsx`, `styles/library-warm.css`.
- `CLAUDE.md`.

**Удалить**
- `packages/agents/src/concept/from-idea.ts`, `__tests__/from-idea.test.ts`.
- `apps/server/src/routes/__tests__/concept-from-idea.test.ts`.
- `packages/shared/src/genre-registry.ts`, `genre-registry.test.ts`.
- `apps/web/src/components/studio/concept/ConceptForm.tsx`, `GenrePicker.tsx`, `TonePicker.tsx`, `AudiencePicker.tsx`, `IdeaBraindump.tsx` и тесты `ConceptForm.test.tsx`, `GenrePicker.test.tsx`, `IdeaBraindump.test.tsx`.

---

### Task 1: Схема замысла в shared (аддитивно)

**Files:**
- Modify: `packages/shared/src/concept.ts`
- Modify: `packages/shared/src/studio-warnings.ts:178-196` (`effectiveStageStatus`)
- Test: `packages/shared/src/concept.test.ts`
- Test: `packages/shared/src/studio-warnings.test.ts`

**Interfaces:**
- Produces: `pitchSchema`, `type Pitch`, `PITCH_MIX_FIELDS`, `type PitchMixField`, `PITCH_FIELD_LABELS: Record<PitchMixField, string>`, `AUDIENCE_LABELS: Record<Audience, string>`, `normalizeConcept(c: BookConcept): BookConcept`, `lockConceptToPitch(c, pitchId, lockedAt): BookConcept`, `unlockConcept(c): BookConcept`, `isConceptComplete(c)` = наличие `lockedAt`. `BookConcept` получает `pitches: Pitch[]` (обязательное в выходном типе через `.default([])`), `selectedPitchId?`, `lockedAt?`, `genre?`, `tone?`, `hook?`. Массивы `genres`/`tones` в этой задаче ОСТАЮТСЯ обязательными (их снимает Task 8).

- [ ] **Step 1: Написать падающие тесты схемы**

Заменить содержимое `packages/shared/src/concept.test.ts` на:

```ts
import { describe, it, expect } from "vitest";
import {
  bookConceptSchema,
  emptyBookConcept,
  audienceSchema,
  isConceptComplete,
  normalizeConcept,
  lockConceptToPitch,
  unlockConcept,
  pitchSchema,
  PITCH_MIX_FIELDS,
  PITCH_FIELD_LABELS,
  type Pitch,
} from "./concept.js";

const PITCH: Pitch = {
  id: "p1",
  workingTitle: "Маршрут, который врёт",
  logline: "Когда карта рода расходится с морем, Нейла должна выбрать между кодексом и глазами.",
  protagonist: "Нейла, проводница каравана, верит карте больше, чем себе.",
  conflict: "Ритуальный маршрут ведёт в аномалию, а признать это — предать род.",
  stakes: "Караван и репутация семьи.",
  hook: "В архивах маршрута находится невозможная правка.",
  genre: "фантастика выживания",
  tone: "холодный, с редкими прорывами тепла",
  audience: "adult",
  strength: "Конфликт долга и наблюдения понятен с первой сцены.",
  risk: "Много мира до первого выбора героини.",
};

describe("bookConceptSchema", () => {
  it("emptyBookConcept passes schema and has no pitches", () => {
    const c = emptyBookConcept();
    expect(bookConceptSchema.parse(c)).toEqual(c);
    expect(c.pitches).toEqual([]);
    expect(c.audience).toBe("adult");
    expect(c.lockedAt).toBeUndefined();
  });

  it("parses a legacy concept without the pitches field", () => {
    const c = bookConceptSchema.parse({
      schemaVersion: 1,
      genres: ["fantasy"],
      tones: ["dark"],
      audience: "adult",
      premise: { logline: "Герой ищет правду" },
    });
    expect(c.pitches).toEqual([]);
  });

  it("audienceSchema rejects unknown value", () => {
    expect(audienceSchema.safeParse("everyone").success).toBe(false);
  });

  it("pitchSchema requires every field non-empty", () => {
    expect(pitchSchema.safeParse({ ...PITCH, hook: "" }).success).toBe(false);
    expect(pitchSchema.safeParse(PITCH).success).toBe(true);
  });

  it("every mixable field has a human label", () => {
    for (const f of PITCH_MIX_FIELDS) {
      expect(PITCH_FIELD_LABELS[f].length).toBeGreaterThan(0);
    }
    expect(PITCH_FIELD_LABELS.logline).toBe("О чём книга, одной фразой");
  });
});

describe("normalizeConcept", () => {
  it("folds legacy genre/tone arrays into free-text genre/tone", () => {
    const c = normalizeConcept({
      ...emptyBookConcept(),
      genres: ["fantasy", "fantasy"],
      customGenres: ["магический реализм"],
      tones: ["dark"],
    });
    expect(c.genre).toBe("fantasy, магический реализм");
    expect(c.tone).toBe("dark");
  });

  it("keeps an explicit genre/tone over legacy arrays", () => {
    const c = normalizeConcept({
      ...emptyBookConcept(),
      genres: ["fantasy"],
      genre: "камерная антиутопия",
    });
    expect(c.genre).toBe("камерная антиутопия");
  });

  it("leaves genre undefined when nothing is known", () => {
    expect(normalizeConcept(emptyBookConcept()).genre).toBeUndefined();
  });
});

describe("isConceptComplete", () => {
  it("an empty concept is not complete", () => {
    expect(isConceptComplete(emptyBookConcept())).toBe(false);
  });

  it("a logline alone no longer completes the stage", () => {
    const c = emptyBookConcept();
    c.premise = { logline: "Герой ищет правду" };
    expect(isConceptComplete(c)).toBe(false);
  });

  it("lockedAt completes the stage", () => {
    const c = { ...emptyBookConcept(), lockedAt: "2026-09-04T10:00:00.000Z" };
    expect(isConceptComplete(c)).toBe(true);
  });
});

describe("lockConceptToPitch / unlockConcept", () => {
  it("copies the pitch into the concept and marks it locked", () => {
    const c = { ...emptyBookConcept(), pitches: [PITCH] };
    const locked = lockConceptToPitch(c, "p1", "2026-09-04T10:00:00.000Z");
    expect(locked.lockedAt).toBe("2026-09-04T10:00:00.000Z");
    expect(locked.selectedPitchId).toBe("p1");
    expect(locked.genre).toBe(PITCH.genre);
    expect(locked.tone).toBe(PITCH.tone);
    expect(locked.hook).toBe(PITCH.hook);
    expect(locked.audience).toBe("adult");
    expect(locked.premise).toEqual({
      protagonist: PITCH.protagonist,
      conflict: PITCH.conflict,
      stakes: PITCH.stakes,
      logline: PITCH.logline,
    });
    expect(locked.pitches).toEqual([PITCH]);
  });

  it("throws on an unknown pitch id", () => {
    const c = { ...emptyBookConcept(), pitches: [PITCH] };
    expect(() => lockConceptToPitch(c, "nope", "2026-09-04T10:00:00.000Z")).toThrow(/nope/);
  });

  it("unlock drops lockedAt but keeps everything else", () => {
    const locked = lockConceptToPitch(
      { ...emptyBookConcept(), pitches: [PITCH] },
      "p1",
      "2026-09-04T10:00:00.000Z",
    );
    const open = unlockConcept(locked);
    expect(open.lockedAt).toBeUndefined();
    expect(open.selectedPitchId).toBe("p1");
    expect(open.premise.logline).toBe(PITCH.logline);
    expect(isConceptComplete(open)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/concept.test.ts`
Expected: FAIL — `normalizeConcept`, `lockConceptToPitch`, `pitchSchema` не экспортируются.

- [ ] **Step 3: Реализовать схему**

Заменить содержимое `packages/shared/src/concept.ts` на:

```ts
import { z } from "zod";

export const audienceSchema = z.enum(["ya", "adult", "all_ages", "mg"]);
export type Audience = z.infer<typeof audienceSchema>;

/** Как аудитория называется для автора и в промптах. */
export const AUDIENCE_LABELS: Record<Audience, string> = {
  ya: "подростки и молодые взрослые",
  adult: "взрослые",
  all_ages: "для всех возрастов",
  mg: "дети 9–12",
};

export const premiseSchema = z.object({
  protagonist: z.string().optional(),
  conflict: z.string().optional(),
  stakes: z.string().optional(),
  logline: z.string().optional(),
});
export type Premise = z.infer<typeof premiseSchema>;

/** Питч — одно целостное предложение книги. Всё, что автор читает на карточке.
 *  Ни одно поле не бывает пустым: пустоту заполняет модель, не автор. */
export const pitchSchema = z.object({
  id: z.string().min(1),
  workingTitle: z.string().min(1).max(120),
  logline: z.string().min(1).max(600),
  protagonist: z.string().min(1).max(2000),
  conflict: z.string().min(1).max(2000),
  stakes: z.string().min(1).max(2000),
  hook: z.string().min(1).max(600),
  genre: z.string().min(1).max(200),
  tone: z.string().min(1).max(200),
  audience: audienceSchema,
  strength: z.string().min(1).max(600),
  risk: z.string().min(1).max(600),
});
export type Pitch = z.infer<typeof pitchSchema>;

/** Поля, которые можно взять из разных питчей при смешивании. */
export const PITCH_MIX_FIELDS = [
  "workingTitle",
  "logline",
  "protagonist",
  "conflict",
  "stakes",
  "hook",
  "genre",
  "tone",
] as const;
export type PitchMixField = (typeof PITCH_MIX_FIELDS)[number];

/** Подписи строк питча и замысла. Единственный источник для интерфейса:
 *  «логлайн», «протагонист», «ставки» автору не показываются. */
export const PITCH_FIELD_LABELS: Record<PitchMixField, string> = {
  workingTitle: "Рабочее название",
  logline: "О чём книга, одной фразой",
  protagonist: "Кто главный и чего хочет",
  conflict: "Что ему мешает",
  stakes: "Что он потеряет",
  hook: "Крючок",
  genre: "Жанр",
  tone: "Тон",
};

export const bookConceptSchema = z.object({
  schemaVersion: z.literal(1),
  /** Задумка автора своими словами. Единственный текст, который он печатает сам. */
  idea: z.string().max(8000).optional(),
  /** Все сгенерированные и смешанные питчи; автор удаляет ненужные вручную. */
  pitches: z.array(pitchSchema).default([]),
  selectedPitchId: z.string().optional(),
  /** ISO-дата утверждения. Наличие поля = этап «Замысел» готов. */
  lockedAt: z.string().optional(),
  /** Свободный текст из питча, не словарь. */
  genre: z.string().max(200).optional(),
  tone: z.string().max(200).optional(),
  hook: z.string().max(600).optional(),
  audience: audienceSchema,
  premise: premiseSchema,
  /** Наследие пикеров. Сворачиваются в genre/tone в normalizeConcept; Task 8
   *  делает их опциональными, Task 9 убирает каталог. */
  genres: z.array(z.string()),
  customGenres: z.array(z.string()).optional(),
  tones: z.array(z.string()),
  customTones: z.array(z.string()).optional(),
});
export type BookConcept = z.infer<typeof bookConceptSchema>;

/** Этап «Замысел» готов только после явного «Утвердить замысел». Логлайн сам по
 *  себе больше ничего не завершает: неявная готовность и была причиной того,
 *  что рекомендатор уходил дальше по недоделанному входу. */
export function isConceptComplete(concept: BookConcept): boolean {
  return typeof concept.lockedAt === "string" && concept.lockedAt.length > 0;
}

export function emptyBookConcept(): BookConcept {
  return {
    schemaVersion: 1,
    pitches: [],
    genres: [],
    tones: [],
    audience: "adult",
    premise: {},
  };
}

function joinLabels(
  ...lists: Array<readonly string[] | undefined>
): string | undefined {
  const seen: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const v = raw.trim();
      if (v.length > 0 && !seen.includes(v)) seen.push(v);
    }
  }
  return seen.length > 0 ? seen.join(", ") : undefined;
}

/** Приводит запись любой давности к текущему виду: гарантирует `pitches`,
 *  выводит `genre`/`tone` из старых массивов, если явных строк нет. Вызывается
 *  при каждом чтении из БД, поэтому миграция данных не нужна. */
export function normalizeConcept(input: BookConcept): BookConcept {
  const genre =
    (input.genre ?? "").trim() || joinLabels(input.genres, input.customGenres);
  const tone =
    (input.tone ?? "").trim() || joinLabels(input.tones, input.customTones);
  return {
    ...input,
    pitches: input.pitches ?? [],
    ...(genre !== undefined ? { genre } : {}),
    ...(tone !== undefined ? { tone } : {}),
  };
}

/** «Утвердить замысел»: выбранный питч становится замыслом книги. */
export function lockConceptToPitch(
  concept: BookConcept,
  pitchId: string,
  lockedAt: string,
): BookConcept {
  const pitch = concept.pitches.find((p) => p.id === pitchId);
  if (!pitch) throw new Error(`pitch ${pitchId} not found in concept`);
  return {
    ...concept,
    selectedPitchId: pitch.id,
    lockedAt,
    genre: pitch.genre,
    tone: pitch.tone,
    hook: pitch.hook,
    audience: pitch.audience,
    premise: {
      protagonist: pitch.protagonist,
      conflict: pitch.conflict,
      stakes: pitch.stakes,
      logline: pitch.logline,
    },
  };
}

/** «Изменить замысел»: снимает утверждение, ничего не стирая. */
export function unlockConcept(concept: BookConcept): BookConcept {
  const next: BookConcept = { ...concept };
  delete next.lockedAt;
  return next;
}
```

- [ ] **Step 4: Прогнать тесты shared**

Run: `pnpm --filter @book-forge/shared test -- src/concept.test.ts`
Expected: PASS (все describe).

- [ ] **Step 5: Обновить `effectiveStageStatus` — «тронут» теперь значит есть задумка или питчи**

В `packages/shared/src/studio-warnings.ts` заменить блок внутри `effectiveStageStatus`:

```ts
  if (id === "concept" && !isConceptComplete(concept)) {
    const touched =
      concept.genres.length > 0 ||
      (concept.customGenres ?? []).length > 0 ||
      Object.values(concept.premise).some((v) => (v ?? "").trim().length > 0);
    return touched ? "in_progress" : stored;
  }
```

на:

```ts
  if (id === "concept" && !isConceptComplete(concept)) {
    const touched =
      concept.pitches.length > 0 ||
      (concept.idea ?? "").trim().length > 0 ||
      Object.values(concept.premise).some((v) => (v ?? "").trim().length > 0);
    return touched ? "in_progress" : stored;
  }
```

- [ ] **Step 6: Починить тесты warnings, которые считали логлайн завершением**

Run: `pnpm --filter @book-forge/shared test -- src/studio-warnings.test.ts`
Ожидаемо упадут тесты, где концепт с одним `premise.logline` считался `complete` или где рекомендатор уходил с `concept` по логлайну. В каждом таком тесте заменить создание «готового» концепта на утверждённый:

```ts
const concept = { ...emptyBookConcept(), lockedAt: "2026-09-04T10:00:00.000Z", premise: { logline: "Герой ищет правду" } };
```

Добавить тест:

```ts
  it("concept stage is in_progress once pitches exist and complete only when locked", () => {
    const withPitches = { ...emptyBookConcept(), idea: "Девочка находит карту города, которого нет." };
    expect(effectiveStageStatus(withPitches, emptyStudioState(), "concept")).toBe("in_progress");
    const locked = { ...withPitches, lockedAt: "2026-09-04T10:00:00.000Z" };
    expect(effectiveStageStatus(locked, emptyStudioState(), "concept")).toBe("complete");
    expect(
      computeRecommendedNextStage({ concept: locked, studioState: emptyStudioState() }),
    ).toBe("world");
  });
```

(`emptyStudioState` импортируется из `./studio-state.js`, `effectiveStageStatus`/`computeRecommendedNextStage` из `./studio-warnings.js` — проверить, что импорты в файле теста уже есть, иначе добавить.)

Run: `pnpm --filter @book-forge/shared test`
Expected: PASS.

- [ ] **Step 7: Починить типовые литералы `BookConcept` в остальных пакетах**

Run: `pnpm typecheck`
Ожидаемые ошибки «Property 'pitches' is missing» в литералах типа `BookConcept`:
- `apps/server/src/scripts/import-studio-sources.ts:55` — добавить `pitches: [],` после `schemaVersion: 1,`.
- `apps/server/src/routes/__tests__/concept-from-idea.test.ts:28` (`EXPANDED`) — добавить `pitches: [],`.
- Любые другие места из вывода `tsc` — та же правка.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/concept.ts packages/shared/src/concept.test.ts packages/shared/src/studio-warnings.ts packages/shared/src/studio-warnings.test.ts apps/server/src/scripts/import-studio-sources.ts apps/server/src/routes/__tests__/concept-from-idea.test.ts
git commit -m "feat(concept): pitches and an explicit lock replace the implicit logline gate"
```

---

### Task 2: Агент `pitch_generator`

**Files:**
- Create: `packages/agents/src/concept/pitches.ts`
- Test: `packages/agents/src/concept/__tests__/pitches.test.ts`
- Modify: `packages/llm/src/types.ts:26-51` (`AGENT_NAMES`), `:69-88` (`STRUCTURED_AGENT_NAMES`)
- Modify: `packages/llm/src/router.ts:9-34` (`DEFAULT_AGENT_BACKEND`)
- Modify: `packages/agents/src/bootstrap.ts`
- Modify: `packages/agents/package.json` (`exports`)

**Interfaces:**
- Consumes: `pitchSchema`, `Pitch`, `Audience`, `AUDIENCE_LABELS`, `ModelChoice` из `@book-forge/shared`; `registerAgentContract`, `dispatchStructured`, `AgentStructuredContract` из `@book-forge/llm`.
- Produces: `interface PitchGeneratorInput { idea: string; direction?: string; avoid?: Array<{ workingTitle: string; logline: string }>; count?: number }`, `pitchDraftSchema` (= `pitchSchema.omit({ id: true })`), `type PitchDraft`, `type PitchGeneratorOutput = { pitches: PitchDraft[]; questions: string[] }`, `buildPitchGeneratorPrompt(input): string`, `toPitches(drafts: PitchDraft[], makeId: () => string): Pitch[]`, `registerPitchGeneratorContract(): void`, `runPitchGenerator(input, options?: { model?: ModelChoice; temperature?: number }): Promise<PitchGeneratorOutput>`.

- [ ] **Step 1: Падающий тест**

Создать `packages/agents/src/concept/__tests__/pitches.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildPitchGeneratorPrompt,
  toPitches,
  pitchDraftSchema,
  type PitchDraft,
} from "../pitches.js";

const DRAFT: PitchDraft = {
  workingTitle: "  Маршрут, который врёт ",
  logline: "Когда карта рода расходится с морем, Нейла должна выбрать между кодексом и глазами.",
  protagonist: "Нейла, проводница каравана.",
  conflict: "Маршрут ведёт в аномалию.",
  stakes: "Караван и репутация семьи.",
  hook: "В архивах маршрута — невозможная правка.",
  genre: "фантастика выживания",
  tone: "холодный",
  audience: "adult",
  strength: "Понятный конфликт долга и наблюдения.",
  risk: "Много мира до первого выбора.",
};

describe("buildPitchGeneratorPrompt", () => {
  it("carries the idea, the count and the direction", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      direction: "мрачнее",
      count: 4,
    });
    expect(p).toContain("Шестеро героев из двух враждующих миров.");
    expect(p).toContain("ровно 4");
    expect(p).toContain("мрачнее");
  });

  it("defaults to four pitches and lists pitches to avoid", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      avoid: [{ workingTitle: "Соляной архив", logline: "Инженер читает регистр." }],
    });
    expect(p).toContain("ровно 4");
    expect(p).toContain("«Соляной архив»");
    expect(p).toContain("Инженер читает регистр.");
  });

  it("omits the avoid block when there is nothing to avoid", () => {
    const p = buildPitchGeneratorPrompt({ idea: "Шестеро героев из двух враждующих миров." });
    expect(p).not.toContain("УЖЕ ПОКАЗАННЫЕ");
  });
});

describe("toPitches", () => {
  it("assigns ids in order and trims every string field", () => {
    let n = 0;
    const out = toPitches([DRAFT, { ...DRAFT, workingTitle: "Второй" }], () => `id-${++n}`);
    expect(out.map((p) => p.id)).toEqual(["id-1", "id-2"]);
    expect(out[0]?.workingTitle).toBe("Маршрут, который врёт");
    expect(out[1]?.workingTitle).toBe("Второй");
    expect(out[0]?.audience).toBe("adult");
  });
});

describe("pitchDraftSchema", () => {
  it("has no id and rejects blanks", () => {
    expect(pitchDraftSchema.safeParse(DRAFT).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, id: "x" }).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, risk: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/concept/__tests__/pitches.test.ts`
Expected: FAIL — модуль `../pitches.js` не найден.

- [ ] **Step 3: Зарегистрировать имя агента**

В `packages/llm/src/types.ts` в `AGENT_NAMES` после `"concept_from_idea",` добавить:

```ts
  "pitch_generator",
  "pitch_blender",
```

В `STRUCTURED_AGENT_NAMES` после `"concept_from_idea",` добавить:

```ts
  "pitch_generator",
  "pitch_blender",
```

В `packages/llm/src/router.ts` в `DEFAULT_AGENT_BACKEND` после `concept_from_idea: "subscription",` добавить:

```ts
  pitch_generator: "subscription",
  pitch_blender: "subscription",
```

(Оба имени добавляются сейчас, чтобы `Record<AgentName, LLMBackend>` компилировался один раз; контракт `pitch_blender` появится в Task 3. Тест паритета останется зелёным, потому что оба списка растут синхронно.)

Run: `pnpm --filter @book-forge/llm test`
Expected: PASS.

- [ ] **Step 4: Реализовать агент**

Создать `packages/agents/src/concept/pitches.ts`:

```ts
import { z } from "zod";
import {
  pitchSchema,
  AUDIENCE_LABELS,
  type ModelChoice,
  type Pitch,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

export interface PitchGeneratorInput {
  /** Задумка автора как есть: фраза, абзац, поток мыслей. */
  idea: string;
  /** Пожелание к новой партии: «мрачнее», «камернее», «ближе к первой». */
  direction?: string;
  /** Уже показанные питчи: новые не должны их повторять. */
  avoid?: Array<{ workingTitle: string; logline: string }>;
  /** Сколько питчей просить, 3–5. По умолчанию 4. */
  count?: number;
}

export const pitchDraftSchema = pitchSchema.omit({ id: true });
export type PitchDraft = z.infer<typeof pitchDraftSchema>;

const pitchGeneratorOutputSchema = z.object({
  pitches: z.array(pitchDraftSchema).min(3).max(5),
  /** До трёх вопросов автору, если задумка слишком тонкая. Пусто — вопросов нет. */
  questions: z.array(z.string().min(1).max(300)).max(3),
});
export type PitchGeneratorOutput = z.infer<typeof pitchGeneratorOutputSchema>;

const DEFAULT_COUNT = 4;

const SYSTEM = `Ты — редактор-разработчик замыслов. Автор приносит задумку книги, ты возвращаешь несколько разных питчей, из которых он выберет один. Работаешь на русском.

Правила:
- Всё, что автор сказал явно, сохраняй по смыслу в каждом питче. Питчи различаются углом, героем, конфликтом или масштабом, но не подменяют его идею на «более правильную».
- Питчи должны быть по-настоящему разными: разные протагонисты, разные конфликты или разный масштаб истории. Два питча с одним героем и одним конфликтом — брак.
- Все поля заполнены. Автор не должен ничего дописывать руками.
- workingTitle: 1–5 слов, без кавычек.
- logline: одно-два предложения, не длиннее 280 символов. Схема: «Когда [событие], [герой с особенностью] должен [действие], иначе [цена]».
- protagonist: кто главный и чего хочет, 30–80 слов, конкретно.
- conflict: что ему мешает и почему столкновение неизбежно, 30–80 слов.
- stakes: что он потеряет, если не справится, 20–60 слов, ощутимо, без «судьбы мира».
- hook: одна деталь или вопрос, из-за которого читатель откроет вторую главу.
- genre и tone: свободный текст на русском, 1–4 слова каждое. Не список, не словарь.
- audience: одно из ya, adult, all_ages, mg. По умолчанию adult.
- strength: чем этот питч сильнее остальных, одно предложение. risk: где он может провалиться, одно предложение. Честно.
- questions: только если задумка действительно тонкая (нет ни героя, ни конфликта, меньше ~40 слов). Не больше трёх, каждый отвечается одной фразой. Если задумки достаточно — пустой массив.
- Без штампов: «избранный», «древнее зло», «тайные силы», «судьба мира», если их нет у автора.`;

export function buildPitchGeneratorPrompt(input: PitchGeneratorInput): string {
  const count = input.count ?? DEFAULT_COUNT;
  const parts: string[] = ["ЗАДУМКА АВТОРА:", input.idea.trim(), ""];
  if (input.direction && input.direction.trim().length > 0) {
    parts.push("ПОЖЕЛАНИЕ К ЭТОЙ ПАРТИИ:", input.direction.trim(), "");
  }
  if (input.avoid && input.avoid.length > 0) {
    parts.push("УЖЕ ПОКАЗАННЫЕ ПИТЧИ (не повторять ни героя, ни конфликт):");
    for (const a of input.avoid) {
      parts.push(`- «${a.workingTitle}»: ${a.logline}`);
    }
    parts.push("");
  }
  parts.push(
    "ИНСТРУКЦИЯ:",
    `Верни ровно ${count} питча(ей), заметно разных между собой, и список уточняющих вопросов (пустой, если задумки достаточно).`,
    `Аудитории: ${Object.entries(AUDIENCE_LABELS)
      .map(([id, label]) => `${id} — ${label}`)
      .join("; ")}.`,
  );
  return parts.join("\n");
}

const pitchGeneratorContract: AgentStructuredContract<
  PitchGeneratorInput,
  PitchGeneratorOutput
> = {
  agentName: "pitch_generator",
  getOutputSchema: () => pitchGeneratorOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildPitchGeneratorPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_pitches",
    toolDescription:
      "Submit 3–5 materially different book pitches derived from the author's idea, plus up to three clarifying questions if the idea is too thin.",
  },
};

export function registerPitchGeneratorContract(): void {
  registerAgentContract(pitchGeneratorContract);
}

function trimDraft(d: PitchDraft): PitchDraft {
  return {
    workingTitle: d.workingTitle.trim(),
    logline: d.logline.trim(),
    protagonist: d.protagonist.trim(),
    conflict: d.conflict.trim(),
    stakes: d.stakes.trim(),
    hook: d.hook.trim(),
    genre: d.genre.trim(),
    tone: d.tone.trim(),
    audience: d.audience,
    strength: d.strength.trim(),
    risk: d.risk.trim(),
  };
}

/** Присваивает id и чистит пробелы. Id выдаёт вызывающая сторона — сервер
 *  использует randomUUID, тесты — счётчик. */
export function toPitches(drafts: PitchDraft[], makeId: () => string): Pitch[] {
  return drafts.map((d) => ({ id: makeId(), ...trimDraft(d) }));
}

export interface RunPitchGeneratorOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runPitchGenerator(
  input: PitchGeneratorInput,
  options: RunPitchGeneratorOptions = {},
): Promise<PitchGeneratorOutput> {
  const { raw } = await dispatchStructured<PitchGeneratorInput, PitchGeneratorOutput>({
    agentName: "pitch_generator",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 6000,
  });
  return raw;
}
```

- [ ] **Step 5: Экспорт и регистрация**

В `packages/agents/package.json` в `exports` после строки `"./concept/from-idea": "./src/concept/from-idea.ts",` добавить:

```json
    "./concept/pitches": "./src/concept/pitches.ts",
    "./concept/pitch-blend": "./src/concept/pitch-blend.ts",
```

В `packages/agents/src/bootstrap.ts` добавить импорт после `registerConceptFromIdeaContract`:

```ts
import { registerPitchGeneratorContract } from "./concept/pitches.js";
```

и вызов внутри `registerAllAgentContracts()` после `registerConceptFromIdeaContract();`:

```ts
  registerPitchGeneratorContract();
```

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm --filter @book-forge/agents test -- src/concept/__tests__/pitches.test.ts && pnpm typecheck`
Expected: PASS. (`typecheck` пройдёт, хотя `pitch-blend` в `exports` ещё не существует: `exports` не проверяется tsc. Сервер ещё не импортирует эти модули.)

Также проверить страж контрактов: `pnpm --filter @book-forge/server test -- src/__tests__` — если есть тест, что каждый `STRUCTURED_AGENT_NAMES` имеет контракт после `registerAllAgentContracts()` (`assertAllStructuredAgentsHaveContracts`), он упадёт на `pitch_blender` до Task 3. Если упал именно так — это ожидаемо, Task 3 закрывает; коммитить Task 2 и Task 3 вместе допустимо, но отдельные коммиты предпочтительнее: сделать Task 3 сразу после и коммитить оба подряд.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/concept/pitches.ts packages/agents/src/concept/__tests__/pitches.test.ts packages/agents/package.json packages/agents/src/bootstrap.ts packages/llm/src/types.ts packages/llm/src/router.ts
git commit -m "feat(agents): pitch_generator turns one idea into competing pitches"
```

---

### Task 3: Агент `pitch_blender`

**Files:**
- Create: `packages/agents/src/concept/pitch-blend.ts`
- Test: `packages/agents/src/concept/__tests__/pitch-blend.test.ts`
- Modify: `packages/agents/src/bootstrap.ts`

**Interfaces:**
- Consumes: `pitchDraftSchema`, `PitchDraft` из `./pitches.js`; `Pitch`, `PitchMixField`, `PITCH_MIX_FIELDS`, `PITCH_FIELD_LABELS`, `ModelChoice` из shared.
- Produces: `interface PitchBlenderInput { idea: string; sources: Pitch[]; picks: Partial<Record<PitchMixField, string>>; note?: string }`, `buildPitchBlenderPrompt(input): string`, `registerPitchBlenderContract(): void`, `runPitchBlender(input, options?): Promise<PitchDraft>`.

- [ ] **Step 1: Падающий тест**

Создать `packages/agents/src/concept/__tests__/pitch-blend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPitchBlenderPrompt } from "../pitch-blend.js";
import type { Pitch } from "@book-forge/shared";

const A: Pitch = {
  id: "a",
  workingTitle: "Соляной архив",
  logline: "Инженер читает в кристалле регистр выбраковки.",
  protagonist: "Джасра, метролог.",
  conflict: "Регистр называет её саму.",
  stakes: "Фабрика имплантов станет орудием выбраковки.",
  hook: "В списке — её имя.",
  genre: "научная фантастика",
  tone: "инженерный",
  audience: "adult",
  strength: "Сильный крючок.",
  risk: "Тяжёлый вход.",
};
const B: Pitch = { ...A, id: "b", workingTitle: "Маршрут, который врёт", protagonist: "Нейла, проводница.", conflict: "Карта рода расходится с морем." };

describe("buildPitchBlenderPrompt", () => {
  it("labels sources A, B… and states which field comes from where", () => {
    const p = buildPitchBlenderPrompt({
      idea: "Шестеро героев из двух миров.",
      sources: [A, B],
      picks: { protagonist: "b", conflict: "a" },
    });
    expect(p).toContain("ПИТЧ A «Соляной архив»");
    expect(p).toContain("ПИТЧ B «Маршрут, который врёт»");
    expect(p).toContain("Кто главный и чего хочет — из питча B");
    expect(p).toContain("Что ему мешает — из питча A");
    expect(p).not.toContain("Крючок — из питча");
  });

  it("includes the author's note when given", () => {
    const p = buildPitchBlenderPrompt({
      idea: "Шестеро героев.",
      sources: [A],
      picks: { logline: "a" },
      note: "сделай камернее",
    });
    expect(p).toContain("сделай камернее");
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/agents test -- src/concept/__tests__/pitch-blend.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

Создать `packages/agents/src/concept/pitch-blend.ts`:

```ts
import {
  PITCH_MIX_FIELDS,
  PITCH_FIELD_LABELS,
  type ModelChoice,
  type Pitch,
  type PitchMixField,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { pitchDraftSchema, type PitchDraft } from "./pitches.js";

export interface PitchBlenderInput {
  idea: string;
  /** Питчи-источники целиком: модель должна видеть, откуда взято поле. */
  sources: Pitch[];
  /** Какое поле из какого питча взять (значение — id питча). Остальные поля
   *  модель согласует сама. */
  picks: Partial<Record<PitchMixField, string>>;
  note?: string;
}

const SYSTEM = `Ты — редактор-разработчик замыслов. Автор выбрал части из разных питчей одной книги и просит собрать из них один согласованный питч. Работаешь на русском.

Правила:
- Поля, которые автор указал «из питча X», сохраняй по смыслу; править можно только для согласования (имена, время, место).
- Остальные поля перепиши так, чтобы они естественно следовали из взятых. Не тяни в них детали из питчей, которые автор не выбирал, если они противоречат взятым.
- Заполни все поля. Форматы те же, что у питча: workingTitle 1–5 слов; logline ≤ 280 символов по схеме «Когда [событие], [герой] должен [действие], иначе [цена]»; protagonist и conflict 30–80 слов; stakes 20–60 слов; hook одна деталь; genre и tone свободный текст 1–4 слова; audience одно из ya, adult, all_ages, mg; strength и risk по одному предложению, честно.`;

const LETTERS = "ABCDEFGHIJ";

export function buildPitchBlenderPrompt(input: PitchBlenderInput): string {
  const letterOf = new Map<string, string>();
  input.sources.forEach((s, i) => letterOf.set(s.id, LETTERS[i] ?? String(i + 1)));

  const parts: string[] = ["ЗАДУМКА АВТОРА:", input.idea.trim(), "", "ИСТОЧНИКИ:"];
  for (const s of input.sources) {
    parts.push(
      `ПИТЧ ${letterOf.get(s.id) ?? "?"} «${s.workingTitle}»`,
      `  ${PITCH_FIELD_LABELS.logline}: ${s.logline}`,
      `  ${PITCH_FIELD_LABELS.protagonist}: ${s.protagonist}`,
      `  ${PITCH_FIELD_LABELS.conflict}: ${s.conflict}`,
      `  ${PITCH_FIELD_LABELS.stakes}: ${s.stakes}`,
      `  ${PITCH_FIELD_LABELS.hook}: ${s.hook}`,
      `  ${PITCH_FIELD_LABELS.genre}: ${s.genre}; ${PITCH_FIELD_LABELS.tone}: ${s.tone}; аудитория: ${s.audience}`,
      "",
    );
  }

  parts.push("ВЗЯТЬ:");
  for (const field of PITCH_MIX_FIELDS) {
    const pitchId = input.picks[field];
    if (!pitchId) continue;
    parts.push(`- ${PITCH_FIELD_LABELS[field]} — из питча ${letterOf.get(pitchId) ?? "?"}`);
  }
  parts.push("");

  if (input.note && input.note.trim().length > 0) {
    parts.push("ПОЖЕЛАНИЕ АВТОРА:", input.note.trim(), "");
  }

  parts.push("ИНСТРУКЦИЯ:", "Собери один согласованный питч. Взятые поля сохрани по смыслу, остальные перепиши под них.");
  return parts.join("\n");
}

const pitchBlenderContract: AgentStructuredContract<PitchBlenderInput, PitchDraft> = {
  agentName: "pitch_blender",
  getOutputSchema: () => pitchDraftSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildPitchBlenderPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_blended_pitch",
    toolDescription:
      "Submit one coherent book pitch assembled from the fields the author picked out of several source pitches.",
  },
};

export function registerPitchBlenderContract(): void {
  registerAgentContract(pitchBlenderContract);
}

export interface RunPitchBlenderOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runPitchBlender(
  input: PitchBlenderInput,
  options: RunPitchBlenderOptions = {},
): Promise<PitchDraft> {
  const { raw } = await dispatchStructured<PitchBlenderInput, PitchDraft>({
    agentName: "pitch_blender",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    maxTokens: 2048,
  });
  return raw;
}
```

- [ ] **Step 4: Регистрация**

В `packages/agents/src/bootstrap.ts` добавить импорт:

```ts
import { registerPitchBlenderContract } from "./concept/pitch-blend.js";
```

и вызов после `registerPitchGeneratorContract();`:

```ts
  registerPitchBlenderContract();
```

- [ ] **Step 5: Прогнать**

Run: `pnpm --filter @book-forge/agents test && pnpm --filter @book-forge/llm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/concept/pitch-blend.ts packages/agents/src/concept/__tests__/pitch-blend.test.ts packages/agents/src/bootstrap.ts
git commit -m "feat(agents): pitch_blender assembles one pitch from the author's picks"
```

---

### Task 4: Серверные маршруты питчей и книга из задумки

**Files:**
- Modify: `packages/shared/src/book.ts:28-33` (`createBookInputSchema`)
- Modify: `apps/server/src/routes/books.ts:29-49` (`POST /`)
- Modify: `apps/server/src/routes/studio.ts` (импорты `:19-20`, схемы тел `:56-58`, маршрут from-idea `:331-354`)
- Modify: `apps/server/src/db/studio.ts:107-121` (`loadConcept`/`patchConcept` — нормализация)
- Create: `apps/server/src/routes/__tests__/concept-pitches.test.ts`
- Delete: `apps/server/src/routes/__tests__/concept-from-idea.test.ts`
- Test: `apps/server/src/routes/__tests__/books.test.ts`

**Interfaces:**
- Consumes: `runPitchGenerator`, `toPitches` (`@book-forge/agents/concept/pitches`), `runPitchBlender` (`@book-forge/agents/concept/pitch-blend`), `lockConceptToPitch`, `unlockConcept`, `normalizeConcept`, `PITCH_MIX_FIELDS`, `emptyBookConcept`, `DEFAULT_BOOK_TITLE` (shared).
- Produces HTTP:
  - `POST /api/books` body `{ title?: string; idea?: string; language?; premise? }` — хотя бы одно из `title`/`idea`; без `title` ставится `"Новая книга"`; `idea` записывается в `books.concept`.
  - `POST /api/books/:id/concept/pitches` body `{ direction?: string; count?: 3..5 }` → `200 { concept: BookConcept; questions: string[]; newPitchIds: string[] }`; `400` если задумка короче 10 символов; `500 pitch_generation_failed`.
  - `POST /api/books/:id/concept/pitches/blend` body `{ picks: Partial<Record<PitchMixField, string>>; note?: string }` → `200 { concept; pitchId }`; `400` на неизвестный id питча; `500 pitch_blend_failed`.
  - `POST /api/books/:id/concept/lock` body `{ pitchId?: string }` → `200 BookConcept`; с `pitchId` копирует питч и ставит название книги; без `pitchId` утверждает текущую премису как есть (нужен непустой логлайн, иначе `400`).
  - `POST /api/books/:id/concept/unlock` → `200 BookConcept`.
  - Маршрут `POST /concept/from-idea` удалён.

- [ ] **Step 1: Падающие тесты книги из задумки**

В `apps/server/src/routes/__tests__/books.test.ts` внутри `describe("books CRUD")` добавить:

```ts
  it("POST /api/books creates a book from an idea alone with a working title", async () => {
    const res = await send(t.app, "/api/books", "POST", {
      idea: "Шестеро героев из двух враждующих миров сталкиваются с аномалиями.",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as BookJson;
    expect(body.title).toBe("Новая книга");
    const concept = await sendJson<{ idea?: string; pitches: unknown[] }>(
      t.app,
      `/api/books/${body.id}/concept`,
      "GET",
    );
    expect(concept.idea).toBe("Шестеро героев из двух враждующих миров сталкиваются с аномалиями.");
    expect(concept.pitches).toEqual([]);
  });

  it("POST /api/books rejects a body with neither title nor idea (400)", async () => {
    const res = await send(t.app, "/api/books", "POST", {});
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Падающие тесты питчей**

Создать `apps/server/src/routes/__tests__/concept-pitches.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// studio.ts imports the runners at module load — mock before importing the app.
vi.mock("@book-forge/agents/concept/pitches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@book-forge/agents/concept/pitches")>()),
  runPitchGenerator: vi.fn(),
}));
vi.mock("@book-forge/agents/concept/pitch-blend", () => ({
  runPitchBlender: vi.fn(),
}));

import { runPitchGenerator, type PitchDraft } from "@book-forge/agents/concept/pitches";
import { runPitchBlender } from "@book-forge/agents/concept/pitch-blend";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookConcept } from "@book-forge/shared";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runPitchGenerator).mockReset();
  vi.mocked(runPitchBlender).mockReset();
});
afterEach(() => {
  t.cleanup();
});

const IDEA = "Шестеро героев из двух враждующих миров сталкиваются с нарастающими аномалиями.";

async function createBookWithIdea(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { idea: IDEA });
  return r.id;
}

function draft(title: string): PitchDraft {
  return {
    workingTitle: title,
    logline: `Когда ${title.toLowerCase()} рушится, героиня должна выбрать, иначе потеряет всё.`,
    protagonist: "Нейла, проводница каравана, верит карте больше, чем себе.",
    conflict: "Ритуальный маршрут ведёт в аномалию, признать это — предать род.",
    stakes: "Караван и репутация семьи.",
    hook: "В архивах маршрута — невозможная правка.",
    genre: "фантастика выживания",
    tone: "холодный",
    audience: "adult",
    strength: "Понятный конфликт с первой сцены.",
    risk: "Много мира до первого выбора.",
  };
}

type PitchesResponse = { concept: BookConcept; questions: string[]; newPitchIds: string[] };

describe("POST /api/books/:id/concept/pitches", () => {
  it("404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept/pitches", "POST", {});
    expect(r.status).toBe(404);
  });

  it("400 when the book has no idea yet", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Без задумки" });
    const r = await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(r.status).toBe(400);
    expect(vi.mocked(runPitchGenerator)).not.toHaveBeenCalled();
  });

  it("persists generated pitches with unique ids and passes questions through", async () => {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("Первый"), draft("Второй"), draft("Третий")],
      questions: ["Для кого книга?"],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {
      direction: "мрачнее",
    });
    expect(out.concept.pitches).toHaveLength(3);
    expect(new Set(out.concept.pitches.map((p) => p.id)).size).toBe(3);
    expect(out.newPitchIds).toEqual(out.concept.pitches.map((p) => p.id));
    expect(out.questions).toEqual(["Для кого книга?"]);
    const call = vi.mocked(runPitchGenerator).mock.calls[0]?.[0];
    expect(call?.idea).toBe(IDEA);
    expect(call?.direction).toBe("мрачнее");
    expect(call?.avoid).toEqual([]);

    const stored = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    expect(stored.pitches.map((p) => p.workingTitle)).toEqual(["Первый", "Второй", "Третий"]);
  });

  it("a second batch appends and tells the agent what to avoid", async () => {
    vi.mocked(runPitchGenerator)
      .mockResolvedValueOnce({ pitches: [draft("А"), draft("Б"), draft("В")], questions: [] })
      .mockResolvedValueOnce({ pitches: [draft("Г"), draft("Д"), draft("Е")], questions: [] });
    const id = await createBookWithIdea();
    await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(out.concept.pitches).toHaveLength(6);
    expect(out.newPitchIds).toHaveLength(3);
    const second = vi.mocked(runPitchGenerator).mock.calls[1]?.[0];
    expect(second?.avoid?.map((a) => a.workingTitle)).toEqual(["А", "Б", "В"]);
  });

  it("500 when the agent throws", async () => {
    vi.mocked(runPitchGenerator).mockRejectedValue(new Error("LLM failure"));
    const id = await createBookWithIdea();
    const r = await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toBe("pitch_generation_failed");
  });
});

describe("POST /api/books/:id/concept/pitches/blend", () => {
  async function bookWithPitches(): Promise<{ id: number; ids: string[] }> {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("А"), draft("Б"), draft("В")],
      questions: [],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    return { id, ids: out.newPitchIds };
  }

  it("400 on an unknown pitch id in picks", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/pitches/blend`, "POST", {
      picks: { protagonist: "nope" },
    });
    expect(r.status).toBe(400);
  });

  it("400 on empty picks", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/pitches/blend`, "POST", { picks: {} });
    expect(r.status).toBe(400);
  });

  it("appends the blended pitch and hands the agent only the picked sources", async () => {
    const { id, ids } = await bookWithPitches();
    vi.mocked(runPitchBlender).mockResolvedValue(draft("Смесь"));
    const [a, b] = ids;
    const out = await sendJson<{ concept: BookConcept; pitchId: string }>(
      t.app,
      `/api/books/${id}/concept/pitches/blend`,
      "POST",
      { picks: { protagonist: a, conflict: b }, note: "камернее" },
    );
    expect(out.concept.pitches).toHaveLength(4);
    expect(out.concept.pitches[3]?.id).toBe(out.pitchId);
    expect(out.concept.pitches[3]?.workingTitle).toBe("Смесь");
    const call = vi.mocked(runPitchBlender).mock.calls[0]?.[0];
    expect(call?.sources.map((s) => s.id).sort()).toEqual([a, b].sort());
    expect(call?.picks).toEqual({ protagonist: a, conflict: b });
    expect(call?.note).toBe("камернее");
  });
});

describe("POST /api/books/:id/concept/lock and /unlock", () => {
  async function bookWithPitches(): Promise<{ id: number; ids: string[] }> {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("Маршрут"), draft("Архив"), draft("Барьер")],
      questions: [],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    return { id, ids: out.newPitchIds };
  }

  it("400 on unknown pitch id", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/lock`, "POST", { pitchId: "nope" });
    expect(r.status).toBe(400);
  });

  it("locks the concept to the pitch, renames the book and moves the recommendation on", async () => {
    const { id, ids } = await bookWithPitches();
    const before = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(before[id]).toBe("concept");

    const locked = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/lock`, "POST", {
      pitchId: ids[1],
    });
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.selectedPitchId).toBe(ids[1]);
    expect(locked.premise.logline).toContain("архив");
    expect(locked.genre).toBe("фантастика выживания");

    const book = await sendJson<{ title: string }>(t.app, `/api/books/${id}`, "GET");
    expect(book.title).toBe("Архив");

    const after = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(after[id]).toBe("world");
  });

  it("locks a legacy concept as-is when it has a logline and no pitches", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Старая" });
    const current = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      ...current,
      premise: { logline: "Герой ищет правду." },
    });
    const locked = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.premise.logline).toBe("Герой ищет правду.");
  });

  it("400 when locking as-is without a logline", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Пустая" });
    const r = await send(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    expect(r.status).toBe(400);
  });

  it("unlock clears lockedAt and keeps the premise", async () => {
    const { id, ids } = await bookWithPitches();
    await send(t.app, `/api/books/${id}/concept/lock`, "POST", { pitchId: ids[0] });
    const open = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/unlock`, "POST");
    expect(open.lockedAt).toBeUndefined();
    expect(open.premise.logline).toBeTruthy();
    const rec = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(rec[id]).toBe("concept");
  });
});
```

- [ ] **Step 3: Убедиться, что падает**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/concept-pitches.test.ts src/routes/__tests__/books.test.ts`
Expected: FAIL — 404 на новых маршрутах, 400 на `POST /api/books` без `title`.

- [ ] **Step 4: Схема создания книги**

В `packages/shared/src/book.ts` заменить `createBookInputSchema`:

```ts
/** Название до утверждения замысла: его заменит рабочее название питча. */
export const DEFAULT_BOOK_TITLE = "Новая книга";

export const createBookInputSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    /** Задумка автора; книга может начаться с неё одной, без названия. */
    idea: z.string().trim().min(10).max(8000).optional(),
    language: z.string().min(1).max(16).optional(),
    premise: z.string().max(20000).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.idea !== undefined, {
    message: "title or idea required",
  });
export type CreateBookInput = z.infer<typeof createBookInputSchema>;
```

- [ ] **Step 5: `POST /books` пишет задумку в концепт**

В `apps/server/src/routes/books.ts` дополнить импорт из shared: `emptyBookConcept, DEFAULT_BOOK_TITLE`. Заменить тело `r.post("/", ...)`:

```ts
  r.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createBookInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const title = parsed.data.title ?? DEFAULT_BOOK_TITLE;
    // The idea is the one thing the author types; it lives on the concept so the
    // pitch step can read it straight away.
    const concept =
      parsed.data.idea !== undefined
        ? JSON.stringify({ ...emptyBookConcept(), idea: parsed.data.idea })
        : null;
    const info = sqlite
      .prepare(
        `INSERT INTO books (title, language, premise, status, concept, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        title,
        parsed.data.language ?? "ru",
        parsed.data.premise ?? null,
        concept,
        now,
        now,
      );
    const row = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(info.lastInsertRowid) as BookRow;
    return c.json(toBook(row), 201);
  });
```

- [ ] **Step 6: Нормализация при чтении**

В `apps/server/src/db/studio.ts` добавить `normalizeConcept` в импорт из `@book-forge/shared` и заменить две функции:

```ts
  function loadConcept(bookId: number): BookConcept {
    const row = readBook(bookId);
    if (!row.concept) return emptyBookConcept();
    return normalizeConcept(bookConceptSchema.parse(JSON.parse(row.concept)));
  }

  function patchConcept(bookId: number, next: BookConcept): BookConcept {
    const normalized = normalizeConcept(bookConceptSchema.parse(next));
    const now = new Date().toISOString();
    const info = sqlite
      .prepare("UPDATE books SET concept = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(normalized), now, bookId);
    if (info.changes === 0) throw new StudioBookNotFoundError(bookId);
    return normalized;
  }
```

- [ ] **Step 7: Маршруты питчей в `studio.ts`**

Импорты: заменить строку `import { runConceptFromIdea } from "@book-forge/agents/concept/from-idea";` на:

```ts
import { runPitchGenerator, toPitches } from "@book-forge/agents/concept/pitches";
import { runPitchBlender } from "@book-forge/agents/concept/pitch-blend";
import { randomUUID } from "node:crypto";
```

Дополнить импорт из `@book-forge/shared`: `lockConceptToPitch, unlockConcept, PITCH_MIX_FIELDS`. Дополнить импорт из `../utils/errors.js`: `badRequest`.

Заменить `conceptFromIdeaBodySchema` на:

```ts
const generatePitchesBodySchema = z.object({
  direction: z.string().trim().max(1000).optional(),
  count: z.number().int().min(3).max(5).optional(),
});

const blendPitchBodySchema = z.object({
  picks: z
    .partialRecord(z.enum(PITCH_MIX_FIELDS), z.string().min(1))
    .refine((p) => Object.keys(p).length > 0, { message: "at least one pick" }),
  note: z.string().trim().max(1000).optional(),
});

const lockConceptBodySchema = z.object({
  pitchId: z.string().min(1).optional(),
});
```

Удалить целиком маршрут `r.post("/books/:id/concept/from-idea", ...)` и на его месте добавить:

```ts
  function loadConceptOr404(c: Context, id: number): BookConcept | Response {
    try {
      return repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  }

  r.post("/books/:id/concept/pitches", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = generatePitchesBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const idea = (concept.idea ?? "").trim();
    if (idea.length < 10) {
      return badRequest(c, "idea is too short: write what the book is about first");
    }
    try {
      const out = await runPitchGenerator({
        idea,
        ...(parsed.data.direction ? { direction: parsed.data.direction } : {}),
        ...(parsed.data.count !== undefined ? { count: parsed.data.count } : {}),
        avoid: concept.pitches.map((p) => ({ workingTitle: p.workingTitle, logline: p.logline })),
      });
      const fresh = toPitches(out.pitches, () => randomUUID());
      const next = repo.patchConcept(id, { ...concept, pitches: [...concept.pitches, ...fresh] });
      return c.json({
        concept: next,
        questions: out.questions,
        newPitchIds: fresh.map((p) => p.id),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "pitch_generation_failed", details: { message } }, 500);
    }
  });

  r.post("/books/:id/concept/pitches/blend", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = blendPitchBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const byId = new Map(concept.pitches.map((p) => [p.id, p] as const));
    const pickIds = [...new Set(Object.values(parsed.data.picks))];
    const missing = pickIds.filter((pid) => !byId.has(pid));
    if (missing.length > 0) return badRequest(c, `unknown pitch id: ${missing.join(", ")}`);
    const sources = pickIds.flatMap((pid) => {
      const p = byId.get(pid);
      return p ? [p] : [];
    });
    try {
      const draft = await runPitchBlender({
        idea: (concept.idea ?? "").trim(),
        sources,
        picks: parsed.data.picks,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      const blended = toPitches([draft], () => randomUUID())[0];
      if (!blended) throw new Error("blender returned no pitch");
      const next = repo.patchConcept(id, { ...concept, pitches: [...concept.pitches, blended] });
      return c.json({ concept: next, pitchId: blended.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "pitch_blend_failed", details: { message } }, 500);
    }
  });

  r.post("/books/:id/concept/lock", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = lockConceptBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const now = new Date().toISOString();
    if (parsed.data.pitchId === undefined) {
      // Legacy concepts have a premise but no pitches: one click confirms them.
      if ((concept.premise.logline ?? "").trim().length === 0) {
        return badRequest(c, "nothing to lock: pick a pitch or fill the premise first");
      }
      return c.json(repo.patchConcept(id, { ...concept, lockedAt: now }));
    }
    const pitch = concept.pitches.find((p) => p.id === parsed.data.pitchId);
    if (!pitch) return badRequest(c, `unknown pitch id: ${parsed.data.pitchId}`);
    const next = repo.patchConcept(id, lockConceptToPitch(concept, pitch.id, now));
    sqlite
      .prepare("UPDATE books SET title = ?, updated_at = ? WHERE id = ?")
      .run(pitch.workingTitle, now, id);
    return c.json(next);
  });

  r.post("/books/:id/concept/unlock", (c) => {
    const id = Number(c.req.param("id"));
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;
    return c.json(repo.patchConcept(id, unlockConcept(concept)));
  });
```

`Context` импортировать из `hono`: `import { Hono, type Context } from "hono";`. `BookConcept` добавить в импорт типов из shared.

- [ ] **Step 8: Удалить тест from-idea и прогнать**

```bash
git rm apps/server/src/routes/__tests__/concept-from-idea.test.ts
```

Run: `pnpm typecheck && pnpm --filter @book-forge/server test`
Expected: PASS. Если `studio.test.ts` или `concept-refine.test.ts` утверждают точное равенство концепта (например `toEqual` с `genres`), они всё ещё проходят: `normalizeConcept` в этой задаче добавляет `genre`/`tone`, но не удаляет массивы — если `toEqual` ломается на появившемся `genre`, заменить `toEqual(...)` на `toMatchObject(...)` в этом утверждении.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/book.ts apps/server/src/routes/books.ts apps/server/src/routes/studio.ts apps/server/src/db/studio.ts apps/server/src/routes/__tests__/concept-pitches.test.ts apps/server/src/routes/__tests__/books.test.ts
git commit -m "feat(studio): a book starts from an idea; pitches, blend, lock and unlock routes"
```

---

### Task 5: Web API и вход с полки

**Files:**
- Modify: `apps/web/src/api/client.ts:440-460`
- Modify: `apps/web/src/pages/BooksListPage.tsx` (состояние `title` → `idea`, форма `:140-171`)
- Test: `apps/web/src/pages/BooksListPage.test.tsx`

**Interfaces:**
- Produces в `api`: `generatePitches(bookId, body?: { direction?: string; count?: number }) => Promise<{ concept: BookConcept; questions: string[]; newPitchIds: string[] }>`, `blendPitch(bookId, body: { picks: Partial<Record<PitchMixField, string>>; note?: string }) => Promise<{ concept: BookConcept; pitchId: string }>`, `lockConcept(bookId, pitchId?: string) => Promise<BookConcept>`, `unlockConcept(bookId) => Promise<BookConcept>`. Удалён `conceptFromIdea`.

- [ ] **Step 1: Падающий тест полки**

В `apps/web/src/pages/BooksListPage.test.tsx` заменить тест `"navigates to Studio after creating a book"` на:

```ts
  it("creates a book from an idea and navigates to Studio", async () => {
    m.listBooks.mockResolvedValue([] as never);
    m.createBook.mockResolvedValue({ id: 42, title: "Новая книга" } as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
          <Route path="/books/:bookId/studio" element={<div>STUDIO 42</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole("button", { name: /Новая книга/ }));
    await userEvent.click(screen.getByRole("button", { name: /Новая книга/ }));
    const start = screen.getByRole("button", { name: /Начать/ });
    expect(start).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("О чём книга?"),
      "Шестеро героев из двух враждующих миров.",
    );
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(m.createBook).toHaveBeenCalledWith({
      idea: "Шестеро героев из двух враждующих миров.",
    });
    await waitFor(() => expect(screen.getByText("STUDIO 42")).toBeInTheDocument());
  });
```

Если в файле есть другие тесты, использующие `getByLabelText("Название книги")`, заменить в них ввод на `getByLabelText("О чём книга?")` с текстом ≥ 10 символов и кнопку `/Создать/` на `/Начать/`.

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: FAIL — нет поля «О чём книга?».

- [ ] **Step 3: API-клиент**

В `apps/web/src/api/client.ts` добавить `PitchMixField` в импорт типов из shared. Удалить метод `conceptFromIdea` (с комментарием над ним) и на его месте добавить:

```ts
  /** Задумка уже лежит на концепте; сервер дописывает новые питчи к старым. */
  generatePitches: (
    bookId: number,
    body: { direction?: string; count?: number } = {},
  ) =>
    req<{ concept: BookConcept; questions: string[]; newPitchIds: string[] }>(
      `/api/books/${bookId}/concept/pitches`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  blendPitch: (
    bookId: number,
    body: { picks: Partial<Record<PitchMixField, string>>; note?: string },
  ) =>
    req<{ concept: BookConcept; pitchId: string }>(
      `/api/books/${bookId}/concept/pitches/blend`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  /** Без pitchId утверждает текущую премису как есть (старые книги). */
  lockConcept: (bookId: number, pitchId?: string) =>
    req<BookConcept>(`/api/books/${bookId}/concept/lock`, {
      method: "POST",
      body: JSON.stringify(pitchId !== undefined ? { pitchId } : {}),
    }),
  unlockConcept: (bookId: number) =>
    req<BookConcept>(`/api/books/${bookId}/concept/unlock`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
```

- [ ] **Step 4: Форма на полке**

В `apps/web/src/pages/BooksListPage.tsx`:

Переименовать состояние `title`/`setTitle` в `idea`/`setIdea` (все вхождения в файле). Заменить `onCreate`:

```tsx
  const IDEA_MIN = 10;

  async function onCreate(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length < IDEA_MIN) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBook({ idea: trimmed });
      navigate(`/books/${created.id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
```

Заменить `<form ...>` целиком:

```tsx
            <form
              onSubmit={onCreate}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", width: "100%", maxWidth: 720 }}
              aria-label="Создать новую книгу"
            >
              <textarea
                className="input"
                autoFocus
                rows={3}
                placeholder="Одной фразой или сбивчиво, как думается. Название придумается позже."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                aria-label="О чём книга?"
                style={{ flex: 1, resize: "vertical" }}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || idea.trim().length < IDEA_MIN}
              >
                {busy ? "…" : "Начать"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false);
                  setIdea("");
                }}
                disabled={busy}
              >
                Отмена
              </button>
            </form>
```

- [ ] **Step 5: Прогнать**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: PASS. (`typecheck` web может упасть на `StudioPage.tsx`, где вызывается удалённый `api.conceptFromIdea`. Временно заменить в `StudioPage.tsx` тело `handleFromIdea` на выброс: `throw new Error("replaced by pitches in Task 7");` — Task 7 удаляет обработчик целиком.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/pages/BooksListPage.tsx apps/web/src/pages/BooksListPage.test.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): a book starts from one field, what the book is about"
```

---

### Task 6: Компоненты задумки и питчей

**Files:**
- Create: `apps/web/src/components/studio/concept/IdeaIntake.tsx`
- Create: `apps/web/src/components/studio/concept/PitchCard.tsx`
- Create: `apps/web/src/components/studio/concept/PitchBoard.tsx`
- Test: `apps/web/src/components/studio/concept/__tests__/IdeaIntake.test.tsx`
- Test: `apps/web/src/components/studio/concept/__tests__/PitchBoard.test.tsx`
- Modify: `apps/web/src/styles/library-warm.css` (добавить блок в конец файла)

**Interfaces:**
- `IdeaIntake` props: `{ idea: string; onIdeaChange: (next: string) => void; onGenerate: () => Promise<void>; busy: boolean; error: string | null }`. Кнопка «Предложить питчи» активна при `idea.trim().length >= 10`.
- `PitchCard` props: `{ pitch: Pitch; isNew: boolean; mixMode: boolean; picks: Partial<Record<PitchMixField, string>>; onPick: (field: PitchMixField, pitchId: string) => void; onChoose: (pitchId: string) => void; onRemove: (pitchId: string) => void; busy: boolean }`.
- `PitchBoard` props: `{ pitches: Pitch[]; newPitchIds: string[]; questions: string[]; busy: boolean; error: string | null; onMore: (direction: string) => Promise<void>; onBlend: (picks: Partial<Record<PitchMixField, string>>) => Promise<void>; onChoose: (pitchId: string) => Promise<void>; onRemove: (pitchId: string) => Promise<void>; onAnswer: (question: string, answer: string) => Promise<void>; onBackToIdea: () => void }`.

- [ ] **Step 1: Падающие тесты**

Создать `apps/web/src/components/studio/concept/__tests__/IdeaIntake.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdeaIntake } from "../IdeaIntake";

describe("IdeaIntake", () => {
  it("disables the button until the idea is long enough", async () => {
    const onIdeaChange = vi.fn();
    render(
      <IdeaIntake idea="книга" onIdeaChange={onIdeaChange} onGenerate={vi.fn()} busy={false} error={null} />,
    );
    expect(screen.getByRole("button", { name: /Предложить питчи/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("О чём книга?"), " про");
    expect(onIdeaChange).toHaveBeenCalled();
  });

  it("calls onGenerate when the idea is ready", async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(
      <IdeaIntake
        idea="Шестеро героев из двух враждующих миров."
        onIdeaChange={vi.fn()}
        onGenerate={onGenerate}
        busy={false}
        error={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Предложить питчи/ }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows the error and blocks the button while busy", () => {
    render(
      <IdeaIntake
        idea="Шестеро героев из двух враждующих миров."
        onIdeaChange={vi.fn()}
        onGenerate={vi.fn()}
        busy={true}
        error="LLM failure"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("LLM failure");
    expect(screen.getByRole("button", { name: /Думаем/ })).toBeDisabled();
  });
});
```

Создать `apps/web/src/components/studio/concept/__tests__/PitchBoard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PitchBoard } from "../PitchBoard";
import type { Pitch } from "@book-forge/shared";

function pitch(id: string, title: string): Pitch {
  return {
    id,
    workingTitle: title,
    logline: `Логлайн ${title}`,
    protagonist: `Герой ${title}`,
    conflict: `Конфликт ${title}`,
    stakes: `Ставки ${title}`,
    hook: `Крючок ${title}`,
    genre: "фантастика",
    tone: "холодный",
    audience: "adult",
    strength: `Сила ${title}`,
    risk: `Риск ${title}`,
  };
}

const PITCHES = [pitch("a", "Архив"), pitch("b", "Барьер"), pitch("c", "Волна")];

function renderBoard(over: Partial<ComponentProps<typeof PitchBoard>> = {}) {
  const props: ComponentProps<typeof PitchBoard> = {
    pitches: PITCHES,
    newPitchIds: ["c"],
    questions: [],
    busy: false,
    error: null,
    onMore: vi.fn().mockResolvedValue(undefined),
    onBlend: vi.fn().mockResolvedValue(undefined),
    onChoose: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onAnswer: vi.fn().mockResolvedValue(undefined),
    onBackToIdea: vi.fn(),
    ...over,
  };
  render(<PitchBoard {...props} />);
  return props;
}

describe("PitchBoard", () => {
  it("renders one card per pitch with human labels and no jargon", () => {
    renderBoard();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Архив")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("О чём книга, одной фразой")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Кто главный и чего хочет")).toBeInTheDocument();
    expect(screen.queryByText(/Логлайн$/)).toBeNull();
    expect(screen.queryByText(/Протагонист/)).toBeNull();
    expect(screen.queryByText(/Премиса/)).toBeNull();
  });

  it("marks freshly generated pitches", () => {
    renderBoard();
    expect(screen.getAllByText("новый")).toHaveLength(1);
  });

  it("choosing a pitch calls onChoose with its id", async () => {
    const p = renderBoard();
    const cards = screen.getAllByRole("article");
    await userEvent.click(within(cards[1]!).getByRole("button", { name: /Выбрать этот/ }));
    expect(p.onChoose).toHaveBeenCalledWith("b");
  });

  it("removing a pitch calls onRemove", async () => {
    const p = renderBoard();
    const cards = screen.getAllByRole("article");
    await userEvent.click(within(cards[0]!).getByRole("button", { name: /Убрать/ }));
    expect(p.onRemove).toHaveBeenCalledWith("a");
  });

  it("asks for more pitches with a direction", async () => {
    const p = renderBoard();
    await userEvent.type(screen.getByLabelText("Куда сместить"), "мрачнее");
    await userEvent.click(screen.getByRole("button", { name: /Ещё варианты/ }));
    expect(p.onMore).toHaveBeenCalledWith("мрачнее");
  });

  it("mix mode collects picks from at least two pitches before blending", async () => {
    const p = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /^Смешать$/ }));
    const blend = screen.getByRole("button", { name: /Собрать из выбранного/ });
    expect(blend).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Кто главный и чего хочет: взять из «Архив»" }));
    expect(blend).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Что ему мешает: взять из «Барьер»" }));
    expect(blend).toBeEnabled();
    await userEvent.click(blend);
    expect(p.onBlend).toHaveBeenCalledWith({ protagonist: "a", conflict: "b" });
  });

  it("answers a clarifying question", async () => {
    const p = renderBoard({ questions: ["Для кого книга?"] });
    await userEvent.type(screen.getByLabelText("Для кого книга?"), "для взрослых");
    await userEvent.click(screen.getByRole("button", { name: /Добавить к задумке/ }));
    expect(p.onAnswer).toHaveBeenCalledWith("Для кого книга?", "для взрослых");
  });

  it("goes back to the idea", async () => {
    const p = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /Изменить задумку/ }));
    expect(p.onBackToIdea).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/concept/__tests__/IdeaIntake.test.tsx src/components/studio/concept/__tests__/PitchBoard.test.tsx`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: `IdeaIntake`**

Создать `apps/web/src/components/studio/concept/IdeaIntake.tsx`:

```tsx
interface Props {
  idea: string;
  onIdeaChange: (next: string) => void;
  onGenerate: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

export const IDEA_MIN_LENGTH = 10;

/** Единственное, что автор печатает сам. Всё дальше он читает и выбирает. */
export function IdeaIntake({ idea, onIdeaChange, onGenerate, busy, error }: Props) {
  const ready = idea.trim().length >= IDEA_MIN_LENGTH;
  return (
    <section className="concept-intake" aria-label="Задумка книги">
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Напиши своими словами, о чём книга: одной фразой или сбивчиво, как думается.
        Жанр, герой и конфликт появятся в питчах, их не нужно придумывать сейчас.
      </p>
      <textarea
        className="input"
        aria-label="О чём книга?"
        value={idea}
        onChange={(e) => onIdeaChange(e.target.value)}
        rows={5}
        style={{ width: "100%", resize: "vertical" }}
        disabled={busy}
      />
      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() => void onGenerate()}
        >
          {busy ? "Думаем…" : "Предложить питчи"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: `PitchCard`**

Создать `apps/web/src/components/studio/concept/PitchCard.tsx`:

```tsx
import {
  AUDIENCE_LABELS,
  PITCH_FIELD_LABELS,
  type Pitch,
  type PitchMixField,
} from "@book-forge/shared";

interface Props {
  pitch: Pitch;
  isNew: boolean;
  mixMode: boolean;
  picks: Partial<Record<PitchMixField, string>>;
  onPick: (field: PitchMixField, pitchId: string) => void;
  onChoose: (pitchId: string) => void;
  onRemove: (pitchId: string) => void;
  busy: boolean;
}

const ROWS: PitchMixField[] = ["logline", "protagonist", "conflict", "stakes", "hook"];

export function PitchCard({ pitch, isNew, mixMode, picks, onPick, onChoose, onRemove, busy }: Props) {
  function row(field: PitchMixField, value: string) {
    const label = PITCH_FIELD_LABELS[field];
    return (
      <div className="pitch-row" key={field}>
        <div className="pitch-label">
          {mixMode ? (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input
                type="radio"
                name={`mix-${field}`}
                checked={picks[field] === pitch.id}
                onChange={() => onPick(field, pitch.id)}
                aria-label={`${label}: взять из «${pitch.workingTitle}»`}
              />
              {label}
            </label>
          ) : (
            label
          )}
        </div>
        <div className="pitch-value">{value}</div>
      </div>
    );
  }

  return (
    <article className={"pitch-card" + (isNew ? " is-new" : "")} aria-label={pitch.workingTitle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h4 className="pitch-title">{pitch.workingTitle}</h4>
        {isNew && <span className="pill pill-brass">новый</span>}
      </header>
      <div className="pitch-tags">
        <span className="pill">{pitch.genre}</span>
        <span className="pill">{pitch.tone}</span>
        <span className="pill">{AUDIENCE_LABELS[pitch.audience]}</span>
      </div>
      {ROWS.map((f) => row(f, pitch[f]))}
      <div className="pitch-verdict">
        <div className="pitch-row">
          <div className="pitch-label">Чем сильна</div>
          <div className="pitch-value">{pitch.strength}</div>
        </div>
        <div className="pitch-row">
          <div className="pitch-label">Где риск</div>
          <div className="pitch-value">{pitch.risk}</div>
        </div>
      </div>
      <div className="pitch-actions">
        <button type="button" className="btn btn-primary" disabled={busy || mixMode} onClick={() => onChoose(pitch.id)}>
          Выбрать этот
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onRemove(pitch.id)}>
          Убрать
        </button>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: `PitchBoard`**

Создать `apps/web/src/components/studio/concept/PitchBoard.tsx`:

```tsx
import { useState } from "react";
import type { Pitch, PitchMixField } from "@book-forge/shared";
import { PitchCard } from "./PitchCard";

type Picks = Partial<Record<PitchMixField, string>>;

interface Props {
  pitches: Pitch[];
  newPitchIds: string[];
  questions: string[];
  busy: boolean;
  error: string | null;
  onMore: (direction: string) => Promise<void>;
  onBlend: (picks: Picks) => Promise<void>;
  onChoose: (pitchId: string) => Promise<void>;
  onRemove: (pitchId: string) => Promise<void>;
  onAnswer: (question: string, answer: string) => Promise<void>;
  onBackToIdea: () => void;
}

function distinctSources(picks: Picks): number {
  return new Set(Object.values(picks).filter((v): v is string => typeof v === "string")).size;
}

export function PitchBoard({
  pitches,
  newPitchIds,
  questions,
  busy,
  error,
  onMore,
  onBlend,
  onChoose,
  onRemove,
  onAnswer,
  onBackToIdea,
}: Props) {
  const [direction, setDirection] = useState("");
  const [mixMode, setMixMode] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const canBlend = mixMode && distinctSources(picks) >= 2;

  async function blend() {
    await onBlend(picks);
    setPicks({});
    setMixMode(false);
  }

  return (
    <section aria-label="Питчи">
      {questions.length > 0 && (
        <div className="pitch-questions" role="group" aria-label="Уточняющие вопросы">
          <p className="muted" style={{ fontSize: 13 }}>
            Задумка тонкая. Можно ответить на пару вопросов, ответ допишется к задумке и
            питчи пересоберутся. Можно и не отвечать.
          </p>
          {questions.map((q) => (
            <div key={q} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                aria-label={q}
                placeholder={q}
                value={answers[q] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                style={{ flex: 1 }}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || (answers[q] ?? "").trim().length === 0}
                onClick={() => void onAnswer(q, (answers[q] ?? "").trim())}
              >
                Добавить к задумке
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13, margin: "8px 0" }}>
          {error}
        </p>
      )}

      <div className="pitch-grid">
        {pitches.map((p) => (
          <PitchCard
            key={p.id}
            pitch={p}
            isNew={newPitchIds.includes(p.id)}
            mixMode={mixMode}
            picks={picks}
            onPick={(field, id) => setPicks({ ...picks, [field]: id })}
            onChoose={(id) => void onChoose(id)}
            onRemove={(id) => void onRemove(id)}
            busy={busy}
          />
        ))}
      </div>

      <div className="pitch-toolbar">
        <input
          className="input"
          aria-label="Куда сместить"
          placeholder="Куда сместить: мрачнее, камернее, ближе к первому…"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void onMore(direction.trim())}
        >
          {busy ? "Думаем…" : "Ещё варианты"}
        </button>
        {mixMode ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy || !canBlend} onClick={() => void blend()}>
              Собрать из выбранного
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setMixMode(false);
                setPicks({});
              }}
            >
              Отмена
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" disabled={busy || pitches.length < 2} onClick={() => setMixMode(true)}>
            Смешать
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBackToIdea}>
          Изменить задумку
        </button>
      </div>
      {mixMode && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Отметь на карточках, какую строку взять откуда. Нужно хотя бы две карточки.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Стили**

В конец `apps/web/src/styles/library-warm.css` добавить:

```css
/* ── Замысел: задумка, питчи, карточка замысла ─────────────────────────── */
.pitch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; margin-top: 12px; }
.pitch-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface-2); }
.pitch-card.is-new { border-color: var(--color-brass-soft); box-shadow: 0 0 0 1px var(--color-brass-tint) inset; }
.pitch-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--color-text-strong); }
.pitch-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.pitch-row { display: grid; gap: 2px; }
.pitch-label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted); }
.pitch-value { font-size: 14px; line-height: 1.45; color: var(--color-text); }
.pitch-verdict { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding-top: 8px; border-top: 1px dashed var(--color-border); }
.pitch-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 6px; }
.pitch-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.pitch-questions { display: flex; flex-direction: column; gap: 8px; padding: 12px; margin-bottom: 12px; border-left: 3px solid var(--color-brass-soft); background: var(--color-brass-tint); border-radius: 6px; }
.concept-lines { display: grid; gap: 12px; }
.concept-line-label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted); }
```

- [ ] **Step 7: Прогнать**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test -- src/components/studio/concept/__tests__/IdeaIntake.test.tsx src/components/studio/concept/__tests__/PitchBoard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/studio/concept/IdeaIntake.tsx apps/web/src/components/studio/concept/PitchCard.tsx apps/web/src/components/studio/concept/PitchBoard.tsx apps/web/src/components/studio/concept/__tests__/IdeaIntake.test.tsx apps/web/src/components/studio/concept/__tests__/PitchBoard.test.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): idea intake and a pitch board with choose, mix and more"
```

---

### Task 7: Карточка замысла, контейнер этапа, подключение в Studio, удаление формы

**Files:**
- Create: `apps/web/src/components/studio/concept/ConceptCard.tsx`
- Create: `apps/web/src/components/studio/concept/ConceptStage.tsx`
- Test: `apps/web/src/components/studio/concept/__tests__/ConceptCard.test.tsx`
- Test: `apps/web/src/components/studio/concept/__tests__/ConceptStage.test.tsx`
- Modify: `apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx:89` (текст кнопки)
- Modify: `apps/web/src/pages/StudioPage.tsx:20`, `:178-194`, `:273-285`
- Modify: `apps/web/src/pages/StudioPage.test.tsx:8-16`
- Delete: `ConceptForm.tsx`, `GenrePicker.tsx`, `TonePicker.tsx`, `AudiencePicker.tsx`, `IdeaBraindump.tsx`, `__tests__/ConceptForm.test.tsx`, `__tests__/GenrePicker.test.tsx`, `__tests__/IdeaBraindump.test.tsx` (все в `apps/web/src/components/studio/concept/`)

**Interfaces:**
- `ConceptCard` props: `{ concept: BookConcept; onSave: (next: BookConcept) => Promise<void>; onRefine: (field: PremiseField, draft?: string) => Promise<{ variants: Array<{ id: string; label: string; payload: string }> }>; onUnlock: () => Promise<void>; busy: boolean }`.
- `ConceptStage` props: `{ bookId: number; concept: BookConcept; onConceptChange: (next: BookConcept) => void }`. Сам ходит в `api`: `patchConcept`, `generatePitches`, `blendPitch`, `lockConcept`, `unlockConcept`, `refineConceptField`.

- [ ] **Step 1: Падающие тесты**

Создать `apps/web/src/components/studio/concept/__tests__/ConceptCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptCard } from "../ConceptCard";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";

const LOCKED: BookConcept = {
  ...emptyBookConcept(),
  lockedAt: "2026-09-04T10:00:00.000Z",
  genre: "фантастика выживания",
  tone: "холодный",
  hook: "В архивах — невозможная правка.",
  premise: {
    protagonist: "Нейла, проводница.",
    conflict: "Карта расходится с морем.",
    stakes: "Караван.",
    logline: "Когда карта врёт, Нейла должна выбрать.",
  },
};

describe("ConceptCard", () => {
  it("shows the locked concept with human labels", () => {
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={vi.fn()} onUnlock={vi.fn()} busy={false} />);
    expect(screen.getByDisplayValue("Когда карта врёт, Нейла должна выбрать.")).toBeInTheDocument();
    expect(screen.getByLabelText("О чём книга, одной фразой")).toBeInTheDocument();
    expect(screen.getByLabelText("Кто главный и чего хочет")).toBeInTheDocument();
    expect(screen.getByLabelText("Жанр")).toHaveValue("фантастика выживания");
    expect(screen.queryByText(/Логлайн/)).toBeNull();
    expect(screen.queryByText(/Ставки/)).toBeNull();
  });

  it("save is disabled until something changes, then sends the edited concept", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ConceptCard concept={LOCKED} onSave={onSave} onRefine={vi.fn()} onUnlock={vi.fn()} busy={false} />);
    const save = screen.getByRole("button", { name: /Сохранить правки/ });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Крючок"), " Ещё.");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0].hook).toBe("В архивах — невозможная правка. Ещё.");
    expect(onSave.mock.calls[0]?.[0].lockedAt).toBe(LOCKED.lockedAt);
  });

  it("offers other phrasings for a premise line", async () => {
    const onRefine = vi.fn().mockResolvedValue({
      variants: [{ id: "v1", label: "жёстче", payload: "Когда карта лжёт, Нейла выбирает." }],
    });
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={onRefine} onUnlock={vi.fn()} busy={false} />);
    // Строки идут в порядке PREMISE_ROWS: первая — «О чём книга, одной фразой» (logline).
    const buttons = screen.getAllByRole("button", { name: /Другие формулировки/ });
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(onRefine).toHaveBeenCalledWith("logline", "Когда карта врёт, Нейла должна выбрать."));
    await userEvent.click(await screen.findByRole("button", { name: /Принять/ }));
    expect(screen.getByDisplayValue("Когда карта лжёт, Нейла выбирает.")).toBeInTheDocument();
  });

  it("unlock goes back to the pitches", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={vi.fn()} onUnlock={onUnlock} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Изменить замысел/ }));
    expect(onUnlock).toHaveBeenCalled();
  });
});
```

Создать `apps/web/src/components/studio/concept/__tests__/ConceptStage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptStage } from "../ConceptStage";
import { api } from "@/api/client";
import { emptyBookConcept, type BookConcept, type Pitch } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    patchConcept: vi.fn(),
    generatePitches: vi.fn(),
    blendPitch: vi.fn(),
    lockConcept: vi.fn(),
    unlockConcept: vi.fn(),
    refineConceptField: vi.fn(),
  },
}));
const m = vi.mocked(api);

const PITCH: Pitch = {
  id: "a",
  workingTitle: "Архив",
  logline: "Логлайн",
  protagonist: "Герой",
  conflict: "Конфликт",
  stakes: "Ставки",
  hook: "Крючок",
  genre: "фантастика",
  tone: "холодный",
  audience: "adult",
  strength: "Сила",
  risk: "Риск",
};

describe("ConceptStage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("starts with the idea intake, saves the idea and generates pitches", async () => {
    const onConceptChange = vi.fn();
    const withIdea: BookConcept = { ...emptyBookConcept(), idea: "Шестеро героев из двух миров." };
    m.patchConcept.mockResolvedValue(withIdea as never);
    m.generatePitches.mockResolvedValue({
      concept: { ...withIdea, pitches: [PITCH] },
      questions: ["Для кого?"],
      newPitchIds: ["a"],
    } as never);
    render(<ConceptStage bookId={3} concept={emptyBookConcept()} onConceptChange={onConceptChange} />);
    await userEvent.type(screen.getByLabelText("О чём книга?"), "Шестеро героев из двух миров.");
    await userEvent.click(screen.getByRole("button", { name: /Предложить питчи/ }));
    await waitFor(() => expect(m.generatePitches).toHaveBeenCalledWith(3, {}));
    expect(m.patchConcept).toHaveBeenCalledWith(3, expect.objectContaining({ idea: "Шестеро героев из двух миров." }));
    expect(onConceptChange).toHaveBeenLastCalledWith(expect.objectContaining({ pitches: [PITCH] }));
  });

  it("shows the board when pitches exist and locks on choose", async () => {
    const onConceptChange = vi.fn();
    const withPitches: BookConcept = { ...emptyBookConcept(), idea: "Задумка длиннее десяти.", pitches: [PITCH] };
    const locked: BookConcept = { ...withPitches, lockedAt: "2026-09-04T10:00:00.000Z", premise: { logline: "Логлайн" } };
    m.lockConcept.mockResolvedValue(locked as never);
    render(<ConceptStage bookId={3} concept={withPitches} onConceptChange={onConceptChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Выбрать этот/ }));
    await waitFor(() => expect(m.lockConcept).toHaveBeenCalledWith(3, "a"));
    expect(onConceptChange).toHaveBeenCalledWith(locked);
  });

  it("shows the concept card when locked", () => {
    const locked: BookConcept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Логлайн", protagonist: "Герой", conflict: "Конфликт", stakes: "Ставки" },
    };
    render(<ConceptStage bookId={3} concept={locked} onConceptChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Изменить замысел/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Предложить питчи/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/concept/__tests__/ConceptCard.test.tsx src/components/studio/concept/__tests__/ConceptStage.test.tsx`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: `PremiseFieldPuzzle` — текст кнопки**

В `apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx` заменить `{busy ? "Генерируем…" : "✨ Помочь сформулировать"}` на `{busy ? "Думаем…" : "Другие формулировки"}`.

- [ ] **Step 4: `ConceptCard`**

Создать `apps/web/src/components/studio/concept/ConceptCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  AUDIENCE_LABELS,
  PITCH_FIELD_LABELS,
  audienceSchema,
  type Audience,
  type BookConcept,
} from "@book-forge/shared";
import { PremiseFieldPuzzle, type PremiseField } from "./PremiseFieldPuzzle";

interface RefineResponse {
  variants: Array<{ id: string; label: string; payload: string }>;
}

interface Props {
  concept: BookConcept;
  onSave: (next: BookConcept) => Promise<void>;
  onRefine: (field: PremiseField, draft?: string) => Promise<RefineResponse>;
  onUnlock: () => Promise<void>;
  busy: boolean;
}

const PREMISE_ROWS: Array<{ field: PremiseField; textarea: boolean }> = [
  { field: "logline", textarea: true },
  { field: "protagonist", textarea: true },
  { field: "conflict", textarea: true },
  { field: "stakes", textarea: true },
];

/** Утверждённый замысел. Читается как карточка, каждая строка правится по месту
 *  или переформулируется моделью; ничего не нужно заполнять с нуля. */
export function ConceptCard({ concept, onSave, onRefine, onUnlock, busy }: Props) {
  const [draft, setDraft] = useState<BookConcept>(concept);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(concept), [concept]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(concept);

  function setPremise(field: PremiseField, value: string) {
    setDraft({ ...draft, premise: { ...draft.premise, [field]: value } });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return (
    <section className="concept-lines" aria-label="Замысел книги">
      {PREMISE_ROWS.map(({ field, textarea }) => (
        <PremiseFieldPuzzle
          key={field}
          label={PITCH_FIELD_LABELS[field]}
          field={field}
          value={draft.premise[field] ?? ""}
          onChange={(v) => setPremise(field, v)}
          onRefine={onRefine}
          useTextarea={textarea}
        />
      ))}

      <label className="flex flex-col gap-1 text-sm">
        <span>{PITCH_FIELD_LABELS.hook}</span>
        <input
          className="input"
          type="text"
          aria-label={PITCH_FIELD_LABELS.hook}
          value={draft.hook ?? ""}
          onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <label className="flex flex-col gap-1 text-sm">
          <span>{PITCH_FIELD_LABELS.genre}</span>
          <input
            className="input"
            type="text"
            aria-label={PITCH_FIELD_LABELS.genre}
            value={draft.genre ?? ""}
            onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{PITCH_FIELD_LABELS.tone}</span>
          <input
            className="input"
            type="text"
            aria-label={PITCH_FIELD_LABELS.tone}
            value={draft.tone ?? ""}
            onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Для кого</span>
          <select
            className="input"
            aria-label="Для кого"
            value={draft.audience}
            onChange={(e) => {
              const parsed = audienceSchema.safeParse(e.target.value);
              if (parsed.success) setDraft({ ...draft, audience: parsed.data });
            }}
          >
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-ink-red)", fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={disabled || !dirty} onClick={() => void save()}>
          {saving ? "Сохраняем…" : "Сохранить правки"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void onUnlock()}>
          Изменить замысел
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `ConceptStage`**

Создать `apps/web/src/components/studio/concept/ConceptStage.tsx`:

```tsx
import { useState } from "react";
import { api } from "@/api/client";
import { isConceptComplete, type BookConcept, type PitchMixField } from "@book-forge/shared";
import { IdeaIntake } from "./IdeaIntake";
import { PitchBoard } from "./PitchBoard";
import { ConceptCard } from "./ConceptCard";
import type { PremiseField } from "./PremiseFieldPuzzle";

interface Props {
  bookId: number;
  concept: BookConcept;
  onConceptChange: (next: BookConcept) => void;
}

/** Этап «Замысел» целиком: задумка → питчи → утверждённый замысел. Ветвится по
 *  состоянию концепта, а не по локальному флагу, поэтому F5 возвращает туда же. */
export function ConceptStage({ bookId, concept, onConceptChange }: Props) {
  const [idea, setIdea] = useState(concept.idea ?? "");
  const [editingIdea, setEditingIdea] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [newPitchIds, setNewPitchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveIdeaIfChanged(nextIdea: string): Promise<BookConcept> {
    if (nextIdea === (concept.idea ?? "")) return concept;
    const saved = await api.patchConcept(bookId, { ...concept, idea: nextIdea });
    onConceptChange(saved);
    return saved;
  }

  async function generate(direction?: string) {
    await run(async () => {
      await saveIdeaIfChanged(idea.trim());
      const body = direction && direction.length > 0 ? { direction } : {};
      const out = await api.generatePitches(bookId, body);
      setQuestions(out.questions);
      setNewPitchIds(out.newPitchIds);
      setEditingIdea(false);
      onConceptChange(out.concept);
    });
  }

  async function answer(question: string, text: string) {
    const nextIdea = `${idea.trim()}\n${question} ${text}`;
    setIdea(nextIdea);
    await run(async () => {
      await saveIdeaIfChanged(nextIdea);
      const out = await api.generatePitches(bookId, {});
      setQuestions(out.questions);
      setNewPitchIds(out.newPitchIds);
      onConceptChange(out.concept);
    });
  }

  async function blend(picks: Partial<Record<PitchMixField, string>>) {
    await run(async () => {
      const out = await api.blendPitch(bookId, { picks });
      setNewPitchIds([out.pitchId]);
      onConceptChange(out.concept);
    });
  }

  async function choose(pitchId: string) {
    await run(async () => {
      onConceptChange(await api.lockConcept(bookId, pitchId));
    });
  }

  async function remove(pitchId: string) {
    await run(async () => {
      const next = { ...concept, pitches: concept.pitches.filter((p) => p.id !== pitchId) };
      onConceptChange(await api.patchConcept(bookId, next));
    });
  }

  async function saveCard(next: BookConcept) {
    const saved = await api.patchConcept(bookId, next);
    onConceptChange(saved);
  }

  async function refine(field: PremiseField, draft?: string) {
    return await api.refineConceptField(bookId, field, draft);
  }

  async function unlock() {
    await run(async () => {
      onConceptChange(await api.unlockConcept(bookId));
    });
  }

  if (isConceptComplete(concept)) {
    return <ConceptCard concept={concept} onSave={saveCard} onRefine={refine} onUnlock={unlock} busy={busy} />;
  }

  if (concept.pitches.length > 0 && !editingIdea) {
    return (
      <PitchBoard
        pitches={concept.pitches}
        newPitchIds={newPitchIds}
        questions={questions}
        busy={busy}
        error={error}
        onMore={(d) => generate(d)}
        onBlend={blend}
        onChoose={choose}
        onRemove={remove}
        onAnswer={answer}
        onBackToIdea={() => setEditingIdea(true)}
      />
    );
  }

  return <IdeaIntake idea={idea} onIdeaChange={setIdea} onGenerate={() => generate()} busy={busy} error={error} />;
}
```

- [ ] **Step 6: Подключить в `StudioPage`**

В `apps/web/src/pages/StudioPage.tsx`:

Заменить импорт `import { ConceptForm } from "@/components/studio/concept/ConceptForm";` на `import { ConceptStage } from "@/components/studio/concept/ConceptStage";`.

Удалить функции `handleSaveConcept`, `handleRefine`, `handleFromIdea` и добавить на их место:

```tsx
  function handleConceptChange(next: BookConcept) {
    setConcept(next);
    // Locking renames the book and moves the recommendation; both live outside the concept.
    if (api.getBook) void api.getBook(bookId).then(setBook).catch(() => {});
    void api.getStudioWarnings(bookId).then(setWarnings).catch(() => {});
  }
```

Заменить блок `<div className="card concept">…</div>` на:

```tsx
        <div className="card concept">
          <div className="concept-head">
            <h3>Замысел книги</h3>
            <span className="cap-upper">Этап 1 из 7</span>
          </div>
          <ConceptStage bookId={bookId} concept={concept} onConceptChange={handleConceptChange} />
        </div>
```

В `STAGE_LABELS` (`StudioPage.tsx:25`) заменить `concept: "Концепт",` на `concept: "Замысел",`.

В `apps/web/src/pages/StudioPage.test.tsx` в `vi.mock("@/api/client", ...)` заменить набор методов на:

```ts
  api: {
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
    getStudioWarnings: vi.fn(),
    patchConcept: vi.fn(),
    refineConceptField: vi.fn(),
    generatePitches: vi.fn(),
    blendPitch: vi.fn(),
    lockConcept: vi.fn(),
    unlockConcept: vi.fn(),
  },
```

- [ ] **Step 7: Удалить форму и пикеры**

```bash
git rm apps/web/src/components/studio/concept/ConceptForm.tsx apps/web/src/components/studio/concept/GenrePicker.tsx apps/web/src/components/studio/concept/TonePicker.tsx apps/web/src/components/studio/concept/AudiencePicker.tsx apps/web/src/components/studio/concept/IdeaBraindump.tsx apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx apps/web/src/components/studio/concept/__tests__/GenrePicker.test.tsx apps/web/src/components/studio/concept/__tests__/IdeaBraindump.test.tsx
```

Run: `grep -rn "ConceptForm\|GenrePicker\|TonePicker\|AudiencePicker\|IdeaBraindump" apps/web/src`
Expected: пусто.

- [ ] **Step 8: Прогнать**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src/components/studio/concept apps/web/src/pages/StudioPage.tsx apps/web/src/pages/StudioPage.test.tsx
git commit -m "feat(web): the concept stage is idea, pitches, then a locked concept card"
```

---

### Task 8: Промпты читают `genre`/`tone`; массивы пикеров становятся наследием

**Files:**
- Modify: `packages/shared/src/concept.ts` (`genres`/`tones` → optional; `emptyBookConcept`; `normalizeConcept` убирает массивы)
- Modify: `packages/shared/src/studio-warnings.ts:5`, `:52-55`, `:72-83`, `:120-140`
- Modify: `apps/server/src/utils/studio-context.ts:92-104`, `:110-120`
- Modify: `packages/agents/src/aspects/variants.ts:76-78`
- Modify: `packages/agents/src/aspects/entity-variants.ts:114-116`
- Modify: `packages/agents/src/concept/refiner.ts:68-80`
- Modify: `apps/server/src/scripts/import-studio-sources.ts:55-66`
- Test: `packages/shared/src/studio-warnings.test.ts`, `apps/server/src/utils/__tests__/studio-context.test.ts`, `apps/server/src/db/__tests__/studio.test.ts`, `apps/server/src/routes/__tests__/studio.test.ts`, `apps/server/src/routes/__tests__/concept-refine.test.ts`

**Interfaces:**
- `BookConcept.genres`, `.tones` становятся `string[] | undefined`; `normalizeConcept` возвращает концепт без этих четырёх полей. Все потребители читают `concept.genre ?? "не задан"` и `concept.tone ?? "не задан"`.

- [ ] **Step 1: Падающие тесты нормализации и промптов**

В `packages/shared/src/concept.test.ts` в `describe("normalizeConcept")` добавить:

```ts
  it("drops the legacy arrays after folding them", () => {
    const c = normalizeConcept({ ...emptyBookConcept(), genres: ["fantasy"], tones: ["dark"] });
    expect(c.genres).toBeUndefined();
    expect(c.tones).toBeUndefined();
    expect(c.customGenres).toBeUndefined();
    expect(c.customTones).toBeUndefined();
    expect(bookConceptSchema.parse(c)).toEqual(c);
  });
```

и в первом тесте `emptyBookConcept` добавить `expect(c.genres).toBeUndefined();`.

В `apps/server/src/utils/__tests__/studio-context.test.ts` найти утверждения на строки `Жанры:`/`Тон:` в промпте и заменить ожидания на новый формат; добавить тест:

```ts
  it("renders genre, tone and hook as single lines", () => {
    const text = studioContextToPrompt({
      concept: {
        ...emptyBookConcept(),
        genre: "камерная антиутопия",
        tone: "холодный",
        hook: "В списке — её имя.",
        premise: { logline: "Когда…" },
      },
      worldAspects: [],
      loreAspects: [],
      plotAspects: [],
    } as never);
    expect(text).toContain("Жанр: камерная антиутопия");
    expect(text).toContain("Тон: холодный");
    expect(text).toContain("Крючок: В списке — её имя.");
    expect(text).not.toContain("Жанры:");
  });
```

(Форму объекта `StudioContext` сверить с типом в `studio-context.ts`: если в нём больше полей, дополнить литерал пустыми массивами вместо `as never`.)

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @book-forge/shared test -- src/concept.test.ts && pnpm --filter @book-forge/server test -- src/utils/__tests__/studio-context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Схема — массивы опциональны, нормализация их убирает**

В `packages/shared/src/concept.ts`:

```ts
  /** Наследие пикеров: только чтобы старые записи парсились. normalizeConcept
   *  сворачивает их в genre/tone и убирает. */
  genres: z.array(z.string()).optional(),
  customGenres: z.array(z.string()).optional(),
  tones: z.array(z.string()).optional(),
  customTones: z.array(z.string()).optional(),
```

`emptyBookConcept()`:

```ts
export function emptyBookConcept(): BookConcept {
  return {
    schemaVersion: 1,
    pitches: [],
    audience: "adult",
    premise: {},
  };
}
```

`normalizeConcept`:

```ts
export function normalizeConcept(input: BookConcept): BookConcept {
  const { genres, customGenres, tones, customTones, ...rest } = input;
  const genre = (rest.genre ?? "").trim() || joinLabels(genres, customGenres);
  const tone = (rest.tone ?? "").trim() || joinLabels(tones, customTones);
  return {
    ...rest,
    pitches: rest.pitches ?? [],
    ...(genre !== undefined ? { genre } : {}),
    ...(tone !== undefined ? { tone } : {}),
  };
}
```

- [ ] **Step 4: Предупреждения студии**

В `packages/shared/src/studio-warnings.ts`:
- удалить `import { GENRES } from "./genre-registry.js";` и функцию `genreLabel`;
- предупреждение №1 заменить на:

```ts
  if ((concept.genre ?? "").trim().length === 0 && advancedNonConcept) {
    out.push({
      id: `concept_genres_empty_for_${advancedNonConcept}`,
      severity: "warning",
      stageId: "concept",
      message: `Этап «${STAGE_LABELS[advancedNonConcept]}» уже идёт, а жанр не задан — генерация опирается на него. Утвердите замысел.`,
    });
  }
```

- предупреждение №5 (несовместимые жанры, весь блок с `seenPairs`) удалить: жанр теперь свободный текст, словаря нет.
- в сообщении №4 заменить `Впишите его на этапе «Концепт».` на `Утвердите замысел.`

В `packages/shared/src/studio-warnings.test.ts`: тест `"warns on incompatible genres pair from registry"` удалить; в тесте `"warns when concept.genres is empty..."` оставить логику (пустой `genre` → предупреждение); там, где тесты задают `concept.genres = ["fantasy"]` чтобы предупреждения НЕ было (строки ~90, ~254), заменить на `concept.genre = "фэнтези"` / `{ ...emptyBookConcept(), genre: "фэнтези" }`.

- [ ] **Step 5: Потребители промптов**

`apps/server/src/utils/studio-context.ts`, в `studioContextToPrompt` заменить блок от `const allGenres` до `conceptLines.push(\`Аудитория: ${c.audience}\`);` на:

```ts
    if (c.genre) conceptLines.push(`Жанр: ${c.genre}`);
    if (c.tone) conceptLines.push(`Тон: ${c.tone}`);
    conceptLines.push(`Аудитория: ${c.audience}`);
    if (c.hook) conceptLines.push(`Крючок: ${c.hook}`);
```

В `derivePremiseFromConcept` после строки со `Ставки:` добавить:

```ts
  if (concept.hook?.trim()) lines.push(`Крючок: ${concept.hook.trim()}`);
```

`packages/agents/src/aspects/variants.ts:76-77` и `packages/agents/src/aspects/entity-variants.ts:114-115` — заменить две строки на:

```ts
    `Жанр: ${input.concept.genre ?? "не задан"}`,
    `Тон: ${input.concept.tone ?? "не задан"}`,
```

`packages/agents/src/concept/refiner.ts:68-76` — заменить `genresLine`/`tonesLine`:

```ts
function genresLine(c: BookConcept): string {
  return `Жанр: ${c.genre ?? "не задан"}`;
}

function tonesLine(c: BookConcept): string {
  return `Тон: ${c.tone ?? "не задан"}`;
}
```

`apps/server/src/scripts/import-studio-sources.ts:55-66` — заменить `CONCEPT`:

```ts
const CONCEPT: BookConcept = {
  schemaVersion: 1,
  pitches: [],
  lockedAt: new Date().toISOString(),
  genre: "научная фантастика, технологический экшен",
  tone: "тёмный, инженерный, психологический",
  audience: "adult",
  premise: {
    protagonist:
      "Джасра Вент — пустынный метролог-инженер, мастер чтения соляных пластов; нанята как калибровщик в редкую совместную экспедицию воды и пустыни.",
    conflict:
      "Третья экспедиция поднимает с глубины «солёный лёд», который не плавится и пульсирует. Расшифровав первый кристалл, Джасра читает регистр био-сегрегации: имена, биомы, год выбраковки. В списке — она сама, её водный напарник и четверо команды. На поверхности шестерых уже ждут обе стороны.",
    stakes:
      "Если код вытащить наверх целиком — фабрика биомных имплантов превратится в инструмент массовой выбраковки. Если уничтожить — погибнет вся метрология последних двух веков. Шестеро должны выбрать: вынести, уничтожить или переписать.",
    logline:
      "Когда совместная экспедиция воды и пустыни поднимает с глубины пульсирующий солёный лёд, инженер-метролог Джасра Вент читает в его кристаллической решётке регистр: кто из людей какому биому «положен», и кого следующего вычеркнут. В списке — её имя.",
  },
};
```

- [ ] **Step 6: Починить тесты, которые строили концепт массивами**

Run: `pnpm typecheck && pnpm test`
Ожидаемые падения и правки:
- `apps/server/src/db/__tests__/studio.test.ts`, `apps/server/src/routes/__tests__/studio.test.ts`, `apps/server/src/routes/__tests__/concept-refine.test.ts`: там, где концепт создаётся с `genres: [...]`/`tones: [...]` и потом сравнивается `toEqual`, заменить входные данные на `genre: "фэнтези"`, `tone: "мрачный"` и убрать ожидания на массивы. Утверждения вида `expect(stored.genres).toEqual([...])` → `expect(stored.genre).toBe("...")`.
- Тест, проверяющий, что старая запись с `genres` читается: оставить одну такую проверку в `db/__tests__/studio.test.ts`: записать через `sqlite` JSON со `genres: ["fantasy"]`, прочитать `loadConcept`, ожидать `genre === "fantasy"` и `genres === undefined`.
- Тесты промптов в `packages/agents` (если есть утверждения на `Жанры:`) → `Жанр:`.

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/shared/src apps/server/src packages/agents/src
git commit -m "refactor(concept): genre and tone are free text from the pitch, not picker ids"
```

---

### Task 9: Убрать `concept_from_idea` и каталог жанров, переименовать этап

**Files:**
- Delete: `packages/agents/src/concept/from-idea.ts`, `packages/agents/src/concept/__tests__/from-idea.test.ts`, `packages/shared/src/genre-registry.ts`, `packages/shared/src/genre-registry.test.ts`
- Modify: `packages/llm/src/types.ts` (убрать `"concept_from_idea"` из обоих списков), `packages/llm/src/router.ts` (убрать строку), `packages/agents/src/bootstrap.ts` (импорт и вызов), `packages/agents/package.json` (строка `exports`), `packages/shared/src/index.ts:12`
- Modify: `apps/web/src/components/studio/StageStepper.tsx:14`, `apps/web/src/pages/MarkdownStagePage.tsx:24`, `apps/web/src/components/shell/AppShell.tsx:85`, `apps/web/src/components/OutlinePanel.tsx:46`, `packages/shared/src/studio-warnings.ts:43`
- Test: `apps/web/src/components/studio/__tests__/StageStepper.test.tsx:36`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Удалить агент и каталог**

```bash
git rm packages/agents/src/concept/from-idea.ts packages/agents/src/concept/__tests__/from-idea.test.ts packages/shared/src/genre-registry.ts packages/shared/src/genre-registry.test.ts
```

В `packages/llm/src/types.ts` удалить строку `"concept_from_idea",` из `AGENT_NAMES` и из `STRUCTURED_AGENT_NAMES`. В `packages/llm/src/router.ts` удалить `concept_from_idea: "subscription",`. В `packages/agents/src/bootstrap.ts` удалить импорт `registerConceptFromIdeaContract` и его вызов, в докблоке заменить `Braindump entry: concept_from_idea.` на `Замысел: pitch_generator, pitch_blender.`. В `packages/agents/package.json` удалить строку `"./concept/from-idea": "./src/concept/from-idea.ts",`. В `packages/shared/src/index.ts` удалить `export * from "./genre-registry.js";`.

Run: `grep -rn "concept_from_idea\|from-idea\|genre-registry\|GENRES\|TONES\b" apps packages --include=*.ts --include=*.tsx --include=*.json | grep -v node_modules | grep -v "/dist/"`
Expected: пусто.

- [ ] **Step 2: Переименовать этап для автора**

Заменить `concept: "Концепт",` на `concept: "Замысел",` в:
- `apps/web/src/components/studio/StageStepper.tsx:14`
- `apps/web/src/pages/MarkdownStagePage.tsx:24`
- `packages/shared/src/studio-warnings.ts:43`

В `apps/web/src/components/shell/AppShell.tsx:85` заменить строковый литерал `"Концепт"` на `"Замысел"`.

В `apps/web/src/components/OutlinePanel.tsx:46` заменить текст на `"Сначала утвердите замысел книги в Мастерской."`.

В `apps/web/src/components/studio/__tests__/StageStepper.test.tsx:36` заменить `/Концепт/` на `/Замысел/`.

Run: `grep -rn "Концепт" apps/web/src packages/shared/src`
Expected: пусто.

- [ ] **Step 3: Обновить `CLAUDE.md`**

В разделе **Studio workflow** после предложения про `entity_set` добавить абзац:

```markdown
**Замысел (2026-09-04, фаза 1 конвейера):** книга создаётся из одного поля `idea` (`POST /books` принимает `idea` без `title`, название по умолчанию «Новая книга»). Этап concept = `IdeaIntake` → `PitchBoard` (агент `pitch_generator`, 3–5 питчей, дописываются к `concept.pitches`; `pitch_blender` собирает один питч из выбранных строк) → `ConceptCard` (утверждённый замысел, `concept_refiner` даёт другие формулировки строки). Готовность этапа = `concept.lockedAt` (`POST /concept/lock` копирует питч в premise/genre/tone/hook и ставит название книги; `/unlock` снимает). `genre`/`tone` — свободные строки из питча; каталога жанров и пикеров нет, старые массивы `genres/tones` сворачиваются в `normalizeConcept` при чтении. Подписи строк только из `PITCH_FIELD_LABELS` — слова «логлайн», «протагонист», «ставки», «премиса» в интерфейсе не появляются. Спецификация всей перестройки: `docs/superpowers/specs/2026-09-04-author-pipeline-redesign.md`.
```

В списке агентов **Locked decisions** («Text/aspect/memory agents … default to a subscription backend») добавить `pitch_generator, pitch_blender` в перечисление subscription-агентов и убрать `concept_from_idea`, если упоминается.

- [ ] **Step 4: Прогнать всё**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, включая `structured-agents-parity.test.ts` и страж `assertAllStructuredAgentsHaveContracts` при старте сервера в тестах.

- [ ] **Step 5: Commit**

```bash
git add -A packages apps CLAUDE.md
git commit -m "chore(concept): drop concept_from_idea and the genre catalogue; the stage is called Замысел"
```

---

### Task 10: Ручная проверка и запись в память проекта

**Files:** нет изменений кода, кроме правок по найденным дефектам.

- [ ] **Step 1: Поднять приложение**

Run: `pnpm migrate && pnpm dev`
Открыть `http://localhost:5173/books`.

- [ ] **Step 2: Сценарий «с одной задумкой»**

1. «Новая книга» → поле «О чём книга?» → вставить: `Шестеро героев из двух враждующих миров сталкиваются с нарастающими аномалиями и понимают, что угроза исходит не только от Барьера, но и от лжи тех, кто управляет экспедициями.` → «Начать». Ожидание: открылась Мастерская, книга называется «Новая книга», этап 1 показывает задумку и кнопку «Предложить питчи».
2. «Предложить питчи». Ожидание: одно ожидание LLM, 4 карточки, у каждой все строки заполнены, подписи человеческие, ярлык «новый» на всех.
3. В «Куда сместить» ввести `камернее`, «Ещё варианты». Ожидание: 8 карточек, «новый» на четырёх последних, старые не повторяются по герою/конфликту.
4. «Смешать», отметить «Кто главный и чего хочет» на одной карточке и «Что ему мешает» на другой, «Собрать из выбранного». Ожидание: девятая карточка с ярлыком «новый», взятые строки узнаваемы.
5. «Убрать» на двух карточках. Ожидание: остаётся семь, после F5 — те же семь.
6. «Выбрать этот» на одной. Ожидание: карточка замысла с полями, название книги в шапке сменилось на рабочее название питча, полоска этапов показывает «Замысел» готовым, «Далее: Мир», кнопка «Продолжить» ведёт на `/studio/world`.
7. На карточке замысла нажать «Другие формулировки» у строки «О чём книга, одной фразой», принять вариант, «Сохранить правки». Ожидание: после F5 текст сохранён, замысел остаётся утверждённым.
8. «Изменить замысел». Ожидание: снова доска питчей с теми же семью карточками; полоска показывает «Замысел» в работе; «Продолжить» ведёт на `/studio`.
9. Открыть этап «Мир», «Составить план». Ожидание: в промпте (лог сервера или результат) виден жанр и тон из питча. Проверить в консоли сервера, что нет ошибок 500.

- [ ] **Step 3: Сценарий «старая книга»**

Открыть существующую книгу с заполненным логлайном и без питчей. Ожидание: этап 1 показывает задумку пустой или с прежним текстом и кнопку «Предложить питчи»; «Продолжить» ведёт на `/studio` (замысел не утверждён). Через API утвердить как есть:

```bash
curl -X POST http://localhost:3001/api/books/<id>/concept/lock -H "Content-Type: application/json" -d "{}"
```

Ожидание: `lockedAt` задан, в Мастерской карточка замысла со старой премисой, «Далее» уходит с замысла. (Кнопка «Утвердить как есть» для старых книг в интерфейсе — отдельная мелкая задача фазы 6, если понадобится.)

- [ ] **Step 4: Записать работу в память проекта**

Вызвать `record_work` (om) с `changes`, `decisions` (лок = явный `lockedAt`; жанр/тон свободный текст; старые книги требуют одного клика), `learned`, `verification` (результаты шагов 2–3), `open` (модель для питчей, кнопка «Утвердить как есть», быстрый режим). Отметить, что заметка статуса `projects/BOOKOPIS/README.md` устарела и указать новый «следующий шаг»: фаза 2 «Приём материала» по спецификации.

- [ ] **Step 5: Финальный коммит правок по результатам проверки (если были)**

```bash
git add -A apps packages
git commit -m "fix(concept): follow-ups from the manual pass over the pitch flow"
```

---

## Self-review

**Покрытие спецификации (раздел 6, фаза 1):** вход одним полем — Task 5; питчи 3–5 за одно ожидание — Task 2, 4, 6; смешивание — Task 3, 4, 6; утверждение ставит название и переводит этап — Task 1, 4, 7; рекомендатор идёт дальше только после утверждения — Task 1 (`isConceptComplete`), проверено в Task 4; удаление пикеров и каталога — Task 7, 9; промпты на строки `genre/tone` — Task 8; ни одного упоминания `GENRES`/`TONES`/`concept_from_idea` — grep в Task 9. Уточняющие вопросы — Task 2 (`questions`), 6 (`onAnswer`), 7 (`answer`). Карточка с «другими формулировками» — Task 7 через `PremiseFieldPuzzle`.

**Согласованность имён:** `PITCH_MIX_FIELDS`/`PitchMixField`/`PITCH_FIELD_LABELS`/`AUDIENCE_LABELS` (Task 1) используются в Task 3, 6, 7; `pitchDraftSchema`/`PitchDraft`/`toPitches`/`runPitchGenerator` (Task 2) в Task 3, 4; `runPitchBlender` (Task 3) в Task 4; `lockConceptToPitch`/`unlockConcept`/`normalizeConcept` (Task 1) в Task 4, 8; `api.generatePitches/blendPitch/lockConcept/unlockConcept` (Task 5) в Task 7; `newPitchIds` возвращается сервером (Task 4) и читается доской (Task 6, 7).

**Порядок без красных задач:** Task 1 аддитивен (массивы обязательны до Task 8); Task 2 добавляет оба имени агентов, контракт второго — Task 3 сразу следом; Task 5 временно заглушает `handleFromIdea`, Task 7 удаляет; Task 8 делает массивы опциональными вместе с правкой всех потребителей; Task 9 удаляет каталог только после того, как Task 8 убрал его из `studio-warnings`.
