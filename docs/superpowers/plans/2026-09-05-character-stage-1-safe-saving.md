# Этап 1 «Безопасное сохранение»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Генерация главы и repair перестают молча коммитить результат: оба создают предложение, которое автор смотрит и принимает целиком или по выбранным правкам, а статус критики перестаёт врать про успех.

**Architecture:** Новая таблица `prose_proposals` хранит кандидата рядом с базой, от которой он посчитан (`base_version_id`, ревизия черновика, отпечаток контекста). Маршруты генерации и правки пишут туда вместо `chapter_versions`; отдельный маршрут принятия делает версию в одной транзакции после проверки ожиданий клиента (CAS) и ставит задания памяти. Сравнение базы и кандидата — по абзацам, чистой функцией в `packages/shared`, применяет выбранное подмножество сервер.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), ESM, Hono, better-sqlite3 (рукописные SQL-миграции), zod 4, React 18 + TipTap, vitest.

**Spec:** [docs/superpowers/specs/2026-09-05-character-individuality.md](../specs/2026-09-05-character-individuality.md), раздел 11 и критерии AC-16…AC-20, AC-27, AC-37.

## Global Constraints

- Русский язык интерфейса и сообщений об ошибках; технические поля наружу не выносятся.
- Миграции только через `pnpm --filter @book-forge/server drizzle:new <name>`; `drizzle:generate` запрещён (снапшоты сломаны с 0008). Следующий свободный номер — **0020**.
- Разделитель операторов в SQL-миграции — литерал `--> statement-breakpoint`, и он **никогда** не встречается внутри комментария: мигратор режет файл по этой строке.
- `schema.ts` обновляется вместе с SQL — как документация и типы, не как источник миграции.
- Импорты между пакетами только через `workspace:*` и поле `exports`; в `src/` соседнего пакета не лезть.
- Инварианты спецификации, обязательные для этого этапа: INV-06 (ни генерация, ни отмена, ни сбой, ни устаревшее принятие не уничтожают более свежие правки автора), INV-11 (все ссылки проверяются на принадлежность одной книге).
- Тесты не ходят в LLM: агенты мокируются через `vi.mock("@book-forge/agents", …)`.
- Каждая задача заканчивается зелёными тестами и коммитом.

## Промежуточное состояние приложения

После задачи 5 и до задачи 11 генерация главы больше не подменяет текст в редакторе: поток виден, глава не меняется, кандидат лежит в базе. Это и есть целевое поведение; интерфейс принятия появляется в задаче 11. Промежуточные задачи оставляют приложение запускаемым и тесты зелёными, но кнопка «Запустить Writer» в эти два-три коммита выглядит для автора бесполезной. Не пытаться это «починить» временным автопринятием — оно сломает AC-16.

## File Structure

**Создаются:**

| Файл | Ответственность |
|---|---|
| `packages/shared/src/prose-diff.ts` | Чистое сравнение и слияние абзацев: `docToBlocks`, `blocksToDoc`, `diffProseBlocks`, `applyProseChanges`. Ничего не знает о БД и HTTP |
| `packages/shared/src/prose-diff.test.ts` | Тесты сравнения и применения подмножества |
| `packages/shared/src/proposal.ts` | Схемы и типы предложения прозы: статусы, `ProseProposal`, тела запросов принятия и отклонения |
| `apps/server/drizzle/0020_prose_proposals.sql` | Таблица `prose_proposals` и колонка `chapter_drafts.revision` |
| `apps/server/drizzle/0021_critique_partial.sql` | Перестройка `critique_reports` ради статуса `partial` |
| `apps/server/src/utils/prose-proposals.ts` | Работа с таблицей: создать, завершить, прочитать, принять. Вся транзакционная логика принятия здесь, маршрут только разбирает запрос |
| `apps/server/src/utils/proposal-cancel.ts` | Реестр отменяемых запусков в памяти процесса |
| `apps/server/src/routes/proposals.ts` | `GET/POST` маршруты предложений: чтение, принятие, отклонение, отмена |
| `apps/server/src/utils/__tests__/prose-proposals.test.ts` | Транзакция принятия, CAS, идемпотентность |
| `apps/server/src/routes/__tests__/proposals.test.ts` | Маршруты принятия и отклонения от начала до конца |
| `apps/server/src/routes/__tests__/write-proposal.test.ts` | Генерация создаёт кандидата и не трогает текущую версию |
| `apps/web/src/components/chapter/ProposalPanel.tsx` | Предпросмотр кандидата, выбор правок, принятие и отклонение |
| `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx` | Тесты панели |

**Меняются:**

| Файл | Что именно |
|---|---|
| `packages/shared/src/index.ts` | Реэкспорт `prose-diff.js` и `proposal.js` |
| `packages/shared/src/critique.ts` | Статус `partial` в `CritiqueReportStatus`, поля `requestedCritics`/`failedCritics` в отчёте |
| `packages/llm/src/stream.ts` | `signal` и `stopReason` в контракте потоковой генерации |
| `packages/llm/src/clients/subscription.ts` | Проброс `signal` в SDK |
| `packages/agents/src/writer.ts`, `reviser.ts` | Возврат `stopReason`, приём `signal` |
| `apps/server/src/db/schema.ts` | `proseProposals`, `chapterDrafts.revision`, CHECK критики |
| `apps/server/src/routes/chapters.ts` | Ревизия черновика при автосохранении, отдача её в `GET /:id` |
| `apps/server/src/routes/plot.ts` | `POST /chapters/:id/write` создаёт предложение вместо версии |
| `apps/server/src/routes/critique.ts` | Repair создаёт предложение; правильная агрегация статуса |
| `apps/server/src/app.ts` | Реестр отмены и маршрут предложений |
| `apps/web/src/api/client.ts` | Функции предложений, новые поля потоков |
| `apps/web/src/pages/ChapterPage.tsx` | Панель предложения вместо перезагрузки главы |
| `apps/web/src/components/CritiquePanel.tsx` | Repair отдаёт предложение; частичный результат критики |
| `CLAUDE.md` | Описание нового жизненного цикла |

---

### Task 1: Сравнение прозы по абзацам

Чистая функция, от которой зависят и сервер (применяет подмножество), и веб (рисует выбор). Делается первой, потому что её сигнатуры фиксируют формат `ProseChange`, на который ссылаются все последующие задачи.

**Files:**
- Create: `packages/shared/src/prose-diff.ts`
- Create: `packages/shared/src/prose-diff.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `docToBlocks(doc: unknown): string[]`
  - `blocksToDoc(blocks: string[]): unknown`
  - `diffProseBlocks(base: string[], candidate: string[]): ProseChange[]`
  - `applyProseChanges(base: string[], changes: ProseChange[], selectedIds: readonly string[]): string[]`
  - `interface ProseChange { id: string; kind: "insert" | "delete" | "replace"; baseFrom: number; baseTo: number; baseText: string[]; candidateText: string[] }`
  - `MAX_DIFF_BLOCKS: number`

- [ ] **Step 1: Написать падающий тест**

Создать `packages/shared/src/prose-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  docToBlocks,
  blocksToDoc,
  diffProseBlocks,
  applyProseChanges,
  MAX_DIFF_BLOCKS,
} from "./prose-diff.js";

const doc = (...paragraphs: string[]): unknown => ({
  type: "doc",
  content: paragraphs.map((p) =>
    p === ""
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text: p }] },
  ),
});

describe("docToBlocks", () => {
  it("вынимает текст каждого абзаца", () => {
    expect(docToBlocks(doc("Раз.", "Два."))).toEqual(["Раз.", "Два."]);
  });

  it("склеивает несколько текстовых узлов одного абзаца", () => {
    const withMarks = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Он сказал " },
            { type: "text", text: "тихо", marks: [{ type: "italic" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    expect(docToBlocks(withMarks)).toEqual(["Он сказал тихо."]);
  });

  it("не падает на пустом и битом документе", () => {
    expect(docToBlocks(doc())).toEqual([]);
    expect(docToBlocks(null)).toEqual([]);
    expect(docToBlocks({ type: "doc" })).toEqual([]);
    expect(docToBlocks("не документ")).toEqual([]);
  });

  it("пустой абзац остаётся пустой строкой", () => {
    expect(docToBlocks(doc("Раз.", "", "Два."))).toEqual(["Раз.", "", "Два."]);
  });
});

describe("blocksToDoc", () => {
  it("делает документ, который docToBlocks читает обратно", () => {
    const blocks = ["Раз.", "", "Два."];
    expect(docToBlocks(blocksToDoc(blocks))).toEqual(blocks);
  });

  it("пустой список даёт документ с одним пустым абзацем", () => {
    expect(blocksToDoc([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("diffProseBlocks", () => {
  it("одинаковый текст не даёт ни одной правки", () => {
    expect(diffProseBlocks(["Раз.", "Два."], ["Раз.", "Два."])).toEqual([]);
  });

  it("заменённый абзац — одна правка replace", () => {
    const changes = diffProseBlocks(
      ["Раз.", "Два.", "Три."],
      ["Раз.", "Второй.", "Три."],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "replace",
      baseFrom: 1,
      baseTo: 2,
      baseText: ["Два."],
      candidateText: ["Второй."],
    });
  });

  it("вставка в середину — insert с пустым baseText", () => {
    const changes = diffProseBlocks(["Раз.", "Три."], ["Раз.", "Два.", "Три."]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "insert",
      baseFrom: 1,
      baseTo: 1,
      baseText: [],
      candidateText: ["Два."],
    });
  });

  it("удаление — delete с пустым candidateText", () => {
    const changes = diffProseBlocks(["Раз.", "Два.", "Три."], ["Раз.", "Три."]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "delete",
      baseFrom: 1,
      baseTo: 2,
      candidateText: [],
    });
  });

  it("идентификаторы правок уникальны и идут по порядку", () => {
    const changes = diffProseBlocks(
      ["A", "B", "C", "D"],
      ["A", "B2", "C", "D2"],
    );
    expect(changes.map((ch) => ch.id)).toEqual(["c0", "c1"]);
  });

  it("правки не пересекаются: конец предыдущей не заходит за начало следующей", () => {
    const changes = diffProseBlocks(
      ["A", "B", "C", "D", "E"],
      ["A", "B2", "C", "D2", "E"],
    );
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]!.baseFrom).toBeGreaterThanOrEqual(changes[i - 1]!.baseTo);
    }
  });

  it("на слишком длинном документе отдаёт одну правку «заменить всё»", () => {
    const base = Array.from({ length: MAX_DIFF_BLOCKS + 1 }, (_, i) => `b${i}`);
    const cand = Array.from({ length: 3 }, (_, i) => `c${i}`);
    const changes = diffProseBlocks(base, cand);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "replace",
      baseFrom: 0,
      baseTo: base.length,
      candidateText: cand,
    });
  });
});

describe("applyProseChanges", () => {
  const base = ["Раз.", "Два.", "Три."];
  const candidate = ["Раз.", "Второй.", "Три.", "Четыре."];
  const changes = diffProseBlocks(base, candidate);

  it("без выбранных правок возвращает базу как есть", () => {
    expect(applyProseChanges(base, changes, [])).toEqual(base);
  });

  it("со всеми правками возвращает кандидата целиком", () => {
    expect(
      applyProseChanges(base, changes, changes.map((ch) => ch.id)),
    ).toEqual(candidate);
  });

  it("применяет только выбранную правку", () => {
    const replace = changes.find((ch) => ch.kind === "replace");
    expect(replace).toBeDefined();
    expect(applyProseChanges(base, changes, [replace!.id])).toEqual([
      "Раз.",
      "Второй.",
      "Три.",
    ]);
  });

  it("порядок выбранных идентификаторов не влияет на результат", () => {
    const ids = changes.map((ch) => ch.id);
    expect(applyProseChanges(base, changes, ids)).toEqual(
      applyProseChanges(base, changes, [...ids].reverse()),
    );
  });

  it("неизвестный идентификатор правки — ошибка, а не тихий пропуск", () => {
    expect(() => applyProseChanges(base, changes, ["нет-такой"])).toThrow(
      /unknown change/,
    );
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/shared test -- src/prose-diff.test.ts`
Ожидаемо: FAIL, `Failed to resolve import "./prose-diff.js"`.

- [ ] **Step 3: Написать реализацию**

Создать `packages/shared/src/prose-diff.ts`:

```ts
/** Сравнение прозы по абзацам: единица выбора для автора — абзац или реплика,
 *  а не буква. Посимвольный diff по всей главе дал бы автору выбор, которым
 *  невозможно пользоваться, и слияние, которое невозможно проверить глазами.
 *
 *  Функции здесь чистые: сервер применяет выбранное подмножество (принимает
 *  сервер, а не вкладка), веб теми же данными рисует выбор. */

/** Выше этого числа абзацев LCS-таблица становится дороже, чем стоит выбор по
 *  абзацам. Такой документ отдаём одной правкой «заменить всё» — автор всё
 *  равно не выбирает из тысячи пунктов. */
export const MAX_DIFF_BLOCKS = 2000;

export interface ProseChange {
  /** Устойчив в пределах одного сравнения: c0, c1, … */
  id: string;
  kind: "insert" | "delete" | "replace";
  /** Индекс в массиве абзацев базы; для insert — точка вставки. */
  baseFrom: number;
  /** Не включая; для insert равен baseFrom. */
  baseTo: number;
  baseText: string[];
  candidateText: string[];
}

interface ProseMirrorNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function nodeText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const n = node as ProseMirrorNode;
  if (typeof n.text === "string") return n.text;
  if (!Array.isArray(n.content)) return "";
  return n.content.map(nodeText).join("");
}

/** Верхнеуровневые узлы документа как строки. Заголовок и цитата тоже
 *  становятся строкой: писатель отдаёт сплошные абзацы, и различать типы узлов
 *  ради частичного принятия сейчас не за чем. Принятие целиком берёт JSON
 *  кандидата нетронутым и этой нормализации не делает. */
export function docToBlocks(doc: unknown): string[] {
  if (typeof doc !== "object" || doc === null) return [];
  const content = (doc as ProseMirrorNode).content;
  if (!Array.isArray(content)) return [];
  return content.map(nodeText);
}

export function blocksToDoc(blocks: readonly string[]): unknown {
  if (blocks.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return {
    type: "doc",
    content: blocks.map((b) =>
      b === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text: b }] },
    ),
  };
}

/** Длина наибольшей общей подпоследовательности, таблица целиком: она же нужна
 *  для восстановления пути. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    const rowI = table[i]!;
    const rowNext = table[i + 1]!;
    for (let j = b.length - 1; j >= 0; j--) {
      rowI[j] = a[i] === b[j] ? rowNext[j + 1]! + 1 : Math.max(rowNext[j]!, rowI[j + 1]!);
    }
  }
  return table;
}

export function diffProseBlocks(
  base: readonly string[],
  candidate: readonly string[],
): ProseChange[] {
  if (base.length > MAX_DIFF_BLOCKS || candidate.length > MAX_DIFF_BLOCKS) {
    if (base.length === candidate.length && base.every((b, i) => b === candidate[i])) {
      return [];
    }
    return [
      {
        id: "c0",
        kind: "replace",
        baseFrom: 0,
        baseTo: base.length,
        baseText: [...base],
        candidateText: [...candidate],
      },
    ];
  }

  const table = lcsTable(base, candidate);
  const changes: ProseChange[] = [];
  let i = 0;
  let j = 0;
  let pendingBase: string[] = [];
  let pendingCand: string[] = [];
  let pendingFrom = 0;

  const flush = (): void => {
    if (pendingBase.length === 0 && pendingCand.length === 0) return;
    const kind =
      pendingBase.length === 0
        ? "insert"
        : pendingCand.length === 0
          ? "delete"
          : "replace";
    changes.push({
      id: `c${changes.length}`,
      kind,
      baseFrom: pendingFrom,
      baseTo: pendingFrom + pendingBase.length,
      baseText: pendingBase,
      candidateText: pendingCand,
    });
    pendingBase = [];
    pendingCand = [];
  };

  while (i < base.length && j < candidate.length) {
    if (base[i] === candidate[j]) {
      flush();
      i++;
      j++;
      pendingFrom = i;
      continue;
    }
    if (pendingBase.length === 0 && pendingCand.length === 0) pendingFrom = i;
    if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      pendingBase.push(base[i]!);
      i++;
    } else {
      pendingCand.push(candidate[j]!);
      j++;
    }
  }
  if (pendingBase.length === 0 && pendingCand.length === 0) pendingFrom = i;
  while (i < base.length) {
    pendingBase.push(base[i]!);
    i++;
  }
  while (j < candidate.length) {
    pendingCand.push(candidate[j]!);
    j++;
  }
  flush();
  return changes;
}

/** Правки LCS не пересекаются по построению, поэтому подмножество применяется
 *  в один проход и не зависит от порядка выбора. */
export function applyProseChanges(
  base: readonly string[],
  changes: readonly ProseChange[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map(changes.map((ch) => [ch.id, ch]));
  const selected: ProseChange[] = [];
  for (const id of selectedIds) {
    const ch = byId.get(id);
    if (!ch) throw new Error(`unknown change: ${id}`);
    selected.push(ch);
  }
  selected.sort((a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo);

  const out: string[] = [];
  let cursor = 0;
  for (const ch of selected) {
    for (let k = cursor; k < ch.baseFrom; k++) out.push(base[k]!);
    out.push(...ch.candidateText);
    cursor = Math.max(cursor, ch.baseTo);
  }
  for (let k = cursor; k < base.length; k++) out.push(base[k]!);
  return out;
}
```

- [ ] **Step 4: Реэкспортировать из пакета**

В `packages/shared/src/index.ts` добавить строку рядом с остальными реэкспортами:

```ts
export * from "./prose-diff.js";
```

- [ ] **Step 5: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/shared test -- src/prose-diff.test.ts`
Ожидаемо: PASS, 16 тестов.

Выполнить: `pnpm --filter @book-forge/shared typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/prose-diff.ts packages/shared/src/prose-diff.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): compare and merge prose by paragraph, not by character

The author picks paragraphs and lines, so the diff works on top-level blocks.
LCS hunks are disjoint by construction, which is what lets a chosen subset be
applied in one pass, independent of the order the author ticked them."
```

---

### Task 2: Схемы предложения прозы

Типы, на которые ссылаются сервер и веб. Отдельной задачей, потому что дальше три задачи подряд их импортируют, и разъезд имён между ними — самая дорогая ошибка этого этапа.

**Files:**
- Create: `packages/shared/src/proposal.ts`
- Create: `packages/shared/src/proposal.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `ProseChange` из задачи 1.
- Produces:
  - `PROSE_PROPOSAL_STATUSES`, `ProseProposalStatus`
  - `proseProposalSchema`, `ProseProposal`
  - `acceptProseProposalInputSchema`, `AcceptProseProposalInput`
  - `rejectProseProposalInputSchema`
  - `PROPOSAL_KINDS`, `ProposalKind`, `ProposalCompletion`

- [ ] **Step 1: Написать падающий тест**

Создать `packages/shared/src/proposal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  proseProposalSchema,
  acceptProseProposalInputSchema,
  PROSE_PROPOSAL_STATUSES,
} from "./proposal.js";

const valid = {
  id: 7,
  bookId: 1,
  chapterId: 2,
  kind: "write" as const,
  status: "ready" as const,
  baseVersionId: 3,
  baseDraftRevision: null,
  contextFingerprint: "abc123",
  contentText: "Текст.",
  contentJson: '{"type":"doc","content":[]}',
  wordCount: 1,
  completion: "confirmed" as const,
  stopReason: "end_turn",
  modelId: "claude-opus-4-7",
  backend: "subscription",
  acceptedVersionId: null,
  acceptRequestId: null,
  errorMessage: null,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:01:00.000Z",
};

describe("proseProposalSchema", () => {
  it("принимает полное предложение", () => {
    expect(proseProposalSchema.parse(valid).id).toBe(7);
  });

  it("отсутствующий черновик отличается от черновика ревизии 0", () => {
    expect(
      proseProposalSchema.parse({ ...valid, baseDraftRevision: null }).baseDraftRevision,
    ).toBeNull();
    expect(
      proseProposalSchema.parse({ ...valid, baseDraftRevision: 0 }).baseDraftRevision,
    ).toBe(0);
  });

  it("незавершённый поток — допустимое состояние кандидата", () => {
    const parsed = proseProposalSchema.parse({
      ...valid,
      status: "incomplete",
      completion: "unconfirmed",
      stopReason: null,
    });
    expect(parsed.completion).toBe("unconfirmed");
  });

  it("неизвестный статус отвергается", () => {
    expect(() => proseProposalSchema.parse({ ...valid, status: "готово" })).toThrow();
  });

  it("перечень статусов содержит все состояния жизненного цикла", () => {
    expect([...PROSE_PROPOSAL_STATUSES].sort()).toEqual(
      [
        "accepted",
        "cancelled",
        "failed",
        "incomplete",
        "ready",
        "rejected",
        "streaming",
        "superseded",
      ].sort(),
    );
  });
});

describe("acceptProseProposalInputSchema", () => {
  it("требует ключ запроса и ожидания клиента", () => {
    const parsed = acceptProseProposalInputSchema.parse({
      requestId: "req-1",
      expectedVersionId: 3,
      expectedDraftRevision: null,
    });
    expect(parsed.selectedChangeIds).toBeUndefined();
    expect(parsed.acknowledgeStale).toBe(false);
  });

  it("принимает выбранные правки", () => {
    const parsed = acceptProseProposalInputSchema.parse({
      requestId: "req-2",
      expectedVersionId: null,
      expectedDraftRevision: 4,
      selectedChangeIds: ["c0", "c2"],
    });
    expect(parsed.selectedChangeIds).toEqual(["c0", "c2"]);
  });

  it("пустой список выбранных правок отвергается: это не принятие, а отклонение", () => {
    expect(() =>
      acceptProseProposalInputSchema.parse({
        requestId: "req-3",
        expectedVersionId: 1,
        expectedDraftRevision: null,
        selectedChangeIds: [],
      }),
    ).toThrow();
  });

  it("пустой requestId отвергается", () => {
    expect(() =>
      acceptProseProposalInputSchema.parse({
        requestId: "",
        expectedVersionId: 1,
        expectedDraftRevision: null,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/shared test -- src/proposal.test.ts`
Ожидаемо: FAIL, `Failed to resolve import "./proposal.js"`.

- [ ] **Step 3: Написать реализацию**

Создать `packages/shared/src/proposal.ts`:

```ts
import { z } from "zod";

/** Что предложил агент и что с этим стало.
 *
 *  streaming   — поток идёт, текста ещё нет целиком.
 *  ready       — текст дописан, модель подтвердила завершение.
 *  incomplete  — текст есть, но завершение не подтверждено: упёрлись в лимит
 *                вывода, оборвалось соединение или бэкенд вообще не сообщает
 *                причину остановки. Смотреть можно, считать готовой главой —
 *                нельзя.
 *  cancelled   — автор остановил; поздний ответ ничего не заменяет.
 *  failed      — вызов упал, причина в errorMessage.
 *  accepted    — из него сделана версия (acceptedVersionId).
 *  rejected    — автор отказался.
 *  superseded  — база уехала настолько, что предложение больше не применимо. */
export const PROSE_PROPOSAL_STATUSES = [
  "streaming",
  "ready",
  "incomplete",
  "cancelled",
  "failed",
  "accepted",
  "rejected",
  "superseded",
] as const;
export const proseProposalStatusSchema = z.enum(PROSE_PROPOSAL_STATUSES);
export type ProseProposalStatus = z.infer<typeof proseProposalStatusSchema>;

export const PROPOSAL_KINDS = ["write", "repair"] as const;
export const proposalKindSchema = z.enum(PROPOSAL_KINDS);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

/** Подтверждено ли, что модель дописала до конца. Отделено от статуса
 *  намеренно: отменённый и упавший прогон тоже не подтверждены, но по другой
 *  причине, и в интерфейсе это разные сообщения. */
export const proposalCompletionSchema = z.enum(["confirmed", "unconfirmed"]);
export type ProposalCompletion = z.infer<typeof proposalCompletionSchema>;

export const proseProposalSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  kind: proposalKindSchema,
  status: proseProposalStatusSchema,
  /** Версия главы, от которой считался кандидат; null — глава была пуста. */
  baseVersionId: z.number().int().positive().nullable(),
  /** Ревизия черновика на старте; null — черновика не было вовсе. */
  baseDraftRevision: z.number().int().nonnegative().nullable(),
  /** Отпечаток значимых зависимостей контекста на старте. */
  contextFingerprint: z.string(),
  contentText: z.string(),
  contentJson: z.string(),
  wordCount: z.number().int().nonnegative(),
  completion: proposalCompletionSchema,
  /** Причина остановки от бэкенда; null, если бэкенд её не сообщает. */
  stopReason: z.string().nullable(),
  modelId: z.string().nullable(),
  backend: z.string().nullable(),
  acceptedVersionId: z.number().int().positive().nullable(),
  acceptRequestId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProseProposal = z.infer<typeof proseProposalSchema>;

export const acceptProseProposalInputSchema = z.object({
  /** Идемпотентность: повтор после сетевого сбоя возвращает ту же версию. */
  requestId: z.string().min(1).max(200),
  /** Что клиент считает текущей версией главы; null — глава пуста. */
  expectedVersionId: z.number().int().positive().nullable(),
  /** Что клиент считает ревизией черновика; null — черновика нет. */
  expectedDraftRevision: z.number().int().nonnegative().nullable(),
  /** Не задано — принять кандидата целиком. Задано — только эти правки. */
  selectedChangeIds: z.array(z.string().min(1)).min(1).optional(),
  /** Осознанное принятие предложения, у которого уехала база контекста. */
  acknowledgeStale: z.boolean().default(false),
});
export type AcceptProseProposalInput = z.infer<typeof acceptProseProposalInputSchema>;

export const rejectProseProposalInputSchema = z.object({
  reason: z.string().max(500).optional(),
});
```

- [ ] **Step 4: Реэкспортировать из пакета**

В `packages/shared/src/index.ts` добавить рядом с реэкспортом из задачи 1:

```ts
export * from "./proposal.js";
```

- [ ] **Step 5: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/shared test -- src/proposal.test.ts`
Ожидаемо: PASS, 9 тестов.

Выполнить: `pnpm --filter @book-forge/shared typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 6: Коммит**

```bash
git add packages/shared/src/proposal.ts packages/shared/src/proposal.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): the prose proposal contract"
```

---

### Task 3: Ревизия черновика и таблица предложений

Миграция и её видимая часть: без монотонной ревизии черновика принятие не может отличить «автор ничего не трогал» от «автор переписал абзац, пока шла генерация», а одной временной метки для этого мало.

**Files:**
- Create: `apps/server/drizzle/0020_prose_proposals.sql` (создаётся скриптом, содержимое пишется руками)
- Modify: `apps/server/drizzle/meta/_journal.json` (дописывается скриптом, руками не трогать)
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/routes/chapters.ts:130-171` (автосохранение), `apps/server/src/routes/chapters.ts:52-126` (`GET /:id`)
- Test: `apps/server/src/routes/__tests__/chapter-drafts.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - Колонка `chapter_drafts.revision INTEGER NOT NULL DEFAULT 0`, растущая на каждое автосохранение.
  - Таблица `prose_proposals` со столбцами, повторяющими `proseProposalSchema` в snake_case.
  - `GET /api/chapters/:id` отдаёт `draft.revision`.

- [ ] **Step 1: Создать файл миграции штатным скриптом**

Выполнить: `pnpm --filter @book-forge/server drizzle:new prose_proposals`
Ожидаемо: `✅ created migration 0020_prose_proposals`, файл `apps/server/drizzle/0020_prose_proposals.sql` и запись в журнале.

- [ ] **Step 2: Написать падающий тест**

Дописать в `apps/server/src/routes/__tests__/chapter-drafts.test.ts` внутри существующего `describe`:

```ts
  it("ревизия черновика растёт на каждое автосохранение", async () => {
    const doc = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });

    const first = await sendJson<{ revision: number }>(
      t.app,
      `/api/chapters/${chapterId}/draft`,
      "PUT",
      { contentJson: doc("Первый вариант.") },
    );
    expect(first.revision).toBe(1);

    const second = await sendJson<{ revision: number }>(
      t.app,
      `/api/chapters/${chapterId}/draft`,
      "PUT",
      { contentJson: doc("Второй вариант.") },
    );
    expect(second.revision).toBe(2);

    const ch = await sendJson<{ draft: { revision: number } | null }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.draft?.revision).toBe(2);
  });

  it("до первого автосохранения черновика нет вовсе", async () => {
    const ch = await sendJson<{ draft: unknown }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.draft).toBeNull();
  });
```

Если в файле нет переменной `chapterId`, взять имя, под которым глава создаётся в его `beforeEach`, и использовать его.

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/chapter-drafts.test.ts`
Ожидаемо: FAIL, `expected undefined to be 1` — маршрут ревизию не возвращает.

- [ ] **Step 4: Написать SQL миграции**

Записать в `apps/server/drizzle/0020_prose_proposals.sql`:

```sql
-- Migration 0020_prose_proposals
-- Генерация главы и repair перестают быть автокоммитом: результат ложится
-- кандидатом, версию из него делает явное принятие автора.
--
-- chapter_drafts.revision — монотонный CAS-токен автосохранения. Временной
-- метки для этого мало: два автосохранения внутри одной секунды неразличимы,
-- а принятие обязано отличить «автор ничего не трогал» от «автор переписал
-- абзац, пока шла генерация».
--
-- prose_proposals.base_draft_revision — NULL значит «черновика не было вовсе»,
-- и это не то же самое, что ревизия 0: переход «черновика нет -> черновик
-- появился» тоже обязан ломать принятие.
--
-- context_fingerprint — отпечаток значимых зависимостей на старте (план главы,
-- текущая версия, время правки книги). Разошёлся к моменту принятия — автор
-- получает предупреждение и принимает осознанно, а не молча.

ALTER TABLE `chapter_drafts` ADD COLUMN `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `prose_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'streaming' NOT NULL,
	`base_version_id` integer,
	`base_draft_revision` integer,
	`context_fingerprint` text NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`content_json` text DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`completion` text DEFAULT 'unconfirmed' NOT NULL,
	`stop_reason` text,
	`model_id` text,
	`backend` text,
	`accepted_version_id` integer,
	`accept_request_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "prose_proposals_kind_check" CHECK(`kind` IN ('write','repair')),
	CONSTRAINT "prose_proposals_status_check" CHECK(`status` IN ('streaming','ready','incomplete','cancelled','failed','accepted','rejected','superseded')),
	CONSTRAINT "prose_proposals_completion_check" CHECK(`completion` IN ('confirmed','unconfirmed'))
);--> statement-breakpoint
CREATE INDEX `idx_prose_proposals_chapter` ON `prose_proposals` (`chapter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_prose_proposals_accept_request` ON `prose_proposals` (`accept_request_id`) WHERE `accept_request_id` IS NOT NULL;
```

- [ ] **Step 5: Обновить schema.ts**

В `apps/server/src/db/schema.ts` в определение `chapterDrafts` (сейчас строки 587-599) добавить поле после `wordCount`:

```ts
  /** Монотонный CAS-токен автосохранения: растёт на каждый UPSERT. */
  revision: integer("revision").notNull().default(0),
```

И дописать в конец файла новую таблицу:

```ts
export const proseProposals = sqliteTable(
  "prose_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("streaming"),
    baseVersionId: integer("base_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    baseDraftRevision: integer("base_draft_revision"),
    contextFingerprint: text("context_fingerprint").notNull(),
    contentText: text("content_text").notNull().default(""),
    contentJson: text("content_json").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    completion: text("completion").notNull().default("unconfirmed"),
    stopReason: text("stop_reason"),
    modelId: text("model_id"),
    backend: text("backend"),
    acceptedVersionId: integer("accepted_version_id").references(
      (): AnySQLiteColumn => chapterVersions.id,
      { onDelete: "set null" },
    ),
    acceptRequestId: text("accept_request_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_prose_proposals_chapter").on(t.chapterId, t.createdAt),
    check("prose_proposals_kind_check", sql`${t.kind} IN ('write','repair')`),
    check(
      "prose_proposals_status_check",
      sql`${t.status} IN ('streaming','ready','incomplete','cancelled','failed','accepted','rejected','superseded')`,
    ),
    check(
      "prose_proposals_completion_check",
      sql`${t.completion} IN ('confirmed','unconfirmed')`,
    ),
  ],
);
```

- [ ] **Step 6: Растить ревизию при автосохранении**

В `apps/server/src/routes/chapters.ts` в обработчике `PUT /:id/draft` заменить UPSERT (строки 156-168) на:

```ts
      const saved = sqlite
        .prepare(
          `INSERT INTO chapter_drafts
             (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(chapter_id) DO UPDATE SET
             content_json = excluded.content_json,
             content_text = excluded.content_text,
             word_count = excluded.word_count,
             base_version_id = excluded.base_version_id,
             revision = chapter_drafts.revision + 1,
             updated_at = excluded.updated_at
           RETURNING revision`,
        )
        .get(id, contentJson, contentText, wordCount, ch.current_version_id, now) as {
        revision: number;
      };
      recordWritingDelta(sqlite, wordCount - (prevCount ?? 0));
      return c.json({ chapterId: id, wordCount, revision: saved.revision, updatedAt: now });
```

- [ ] **Step 7: Отдавать ревизию в GET**

В том же файле в обработчике `GET /:id` дописать `revision` в SELECT черновика (строка 69) и в собираемый объект (строки 82-91):

```ts
      const draftRow = sqlite
        .prepare(
          `SELECT chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at
           FROM chapter_drafts WHERE chapter_id = ?`,
        )
        .get(id) as
        | {
            chapter_id: number;
            content_json: string;
            content_text: string;
            word_count: number;
            base_version_id: number | null;
            revision: number;
            updated_at: string;
          }
        | undefined;
      const draft = draftRow
        ? {
            chapterId: draftRow.chapter_id,
            contentJson: draftRow.content_json,
            contentText: draftRow.content_text,
            wordCount: draftRow.word_count,
            baseVersionId: draftRow.base_version_id,
            revision: draftRow.revision,
            updatedAt: draftRow.updated_at,
          }
        : null;
```

- [ ] **Step 8: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/chapter-drafts.test.ts`
Ожидаемо: PASS, включая два новых теста.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS целиком — тестовая база создаётся миграциями с нуля, так что новая миграция проверяется каждым запуском.

- [ ] **Step 9: Применить миграцию к рабочей базе**

Выполнить: `pnpm migrate`
Ожидаемо: строка `🛟 backup: …` и `✅ migrated`.

- [ ] **Step 10: Коммит**

```bash
git add apps/server/drizzle/0020_prose_proposals.sql apps/server/drizzle/meta/_journal.json apps/server/src/db/schema.ts apps/server/src/routes/chapters.ts apps/server/src/routes/__tests__/chapter-drafts.test.ts
git commit -m "feat(chapters): give the draft a monotonic revision, add the proposals table

A timestamp cannot tell two autosaves inside the same second apart, and
acceptance has to distinguish 'the author touched nothing' from 'the author
rewrote a paragraph while the model was writing'. NULL base_draft_revision
means there was no draft at all, which is a different answer from revision 0."
```

---

### Task 4: Причина остановки потока

AC-37: «упёрлись в лимит вывода» и «модель дописала» сегодня неотличимы, потому что `stop_reason` не читается ни на одном бэкенде. Без этого кандидат нельзя честно пометить незавершённым, а именно на этом держится запрет принимать обрубок за готовую главу.

**Files:**
- Modify: `packages/llm/src/stream.ts:28-34` (`StreamCallResult`), `:16-26` (`StreamCallOptions`), `:62-66` (вызов subscription), `:118-131` (возврат api)
- Modify: `packages/llm/src/clients/subscription.ts:209-217` (возврат)
- Modify: `packages/llm/src/ollama.ts` (возврат, около строки 121)
- Modify: `packages/agents/src/writer.ts:203-231`
- Modify: `packages/agents/src/reviser.ts` (аналогичный хвост генератора)
- Test: `packages/llm/src/__tests__/stream-stop-reason.test.ts` (создать)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `StreamCallResult.stopReason: string | null` — обязательное поле у всех четырёх производителей.
  - `StreamCallOptions.signal?: AbortSignal` — проброшен в оба бэкенда.
  - `runChapterWriter` и `reviseChapter` возвращают `stopReason: string | null` рядом с `text`, `modelId`, `tokens`, и принимают необязательный `signal`.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/llm/src/__tests__/stream-stop-reason.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isConfirmedCompletion } from "../stream.js";

describe("isConfirmedCompletion", () => {
  it("end_turn — модель дописала сама", () => {
    expect(isConfirmedCompletion("end_turn")).toBe(true);
  });

  it("stop_sequence тоже считается завершением", () => {
    expect(isConfirmedCompletion("stop_sequence")).toBe(true);
  });

  it("max_tokens — обрубок, а не глава", () => {
    expect(isConfirmedCompletion("max_tokens")).toBe(false);
  });

  it("бэкенд не сообщил причину — считаем неподтверждённым", () => {
    expect(isConfirmedCompletion(null)).toBe(false);
  });

  it("незнакомая причина — неподтверждённое завершение", () => {
    expect(isConfirmedCompletion("refusal")).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/llm test -- src/__tests__/stream-stop-reason.test.ts`
Ожидаемо: FAIL, `isConfirmedCompletion is not a function`.

- [ ] **Step 3: Расширить контракт потока**

В `packages/llm/src/stream.ts` в `StreamCallOptions` добавить поле:

```ts
  /** Отмена вызова. Бэкенд, который её не поддерживает, просто игнорирует. */
  signal?: AbortSignal;
```

В `StreamCallResult` добавить поле:

```ts
  /** Почему модель остановилась. null — бэкенд этого не сообщает, и тогда
   *  «дописал» от «упёрся в лимит» неотличимо: считаем неподтверждённым. */
  stopReason: string | null;
```

Там же, после определения `StreamCallResult`, добавить функцию:

```ts
/** Только явное завершение считается завершением. Молчание бэкенда — нет:
 *  обрубок, принятый за готовую главу, стоит дороже лишнего вопроса автору. */
export function isConfirmedCompletion(stopReason: string | null): boolean {
  return stopReason === "end_turn" || stopReason === "stop_sequence";
}
```

- [ ] **Step 4: Пробросить signal и вернуть stopReason на api-пути**

В `packages/llm/src/stream.ts` в ветке subscription передать сигнал:

```ts
    const sub = getSubscriptionClient().streamMessages({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
```

В создании потока Anthropic добавить сигнал третьим полем запроса и вернуть причину остановки:

```ts
        {
          model: modelId,
          max_tokens: opts.maxTokens ?? 16384,
          system: systemParam as Anthropic.MessageCreateParams["system"],
          messages: [{ role: "user", content: opts.prompt }],
          ...(opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
        },
        // withRetry owns retries — disable the SDK's internal ones.
        { maxRetries: 0, ...(opts.signal !== undefined ? { signal: opts.signal } : {}) },
```

и в возвращаемом объекте:

```ts
  return {
    text: full,
    modelId,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    stopReason: final.stop_reason ?? null,
  };
```

- [ ] **Step 5: Дополнить остальных производителей результата**

Выполнить: `pnpm --filter @book-forge/llm typecheck`
Ожидаемо: ошибки `Property 'stopReason' is missing` в `clients/subscription.ts`, `ollama.ts` и, возможно, `hybrid.ts`. Это и есть список мест, которые надо дополнить.

В `packages/llm/src/clients/subscription.ts` в возврате `streamMessages` добавить:

```ts
      // SDK подписки причину остановки не отдаёт. Врать «end_turn» нельзя:
      // тогда обрубок по лимиту вывода стал бы «готовой главой».
      stopReason: null,
```

В `packages/llm/src/ollama.ts` в возвращаемом объекте добавить `stopReason: null` с тем же обоснованием. В `packages/llm/src/hybrid.ts`, если компилятор укажет на него, пробросить `stopReason: proseFinal.stopReason`.

- [ ] **Step 6: Вернуть причину из Writer и Reviser**

В `packages/agents/src/writer.ts` в объявление локального `result` добавить `stopReason: null as string | null`, а в финальный `return` — поле:

```ts
  return {
    text: result.text,
    modelId: result.modelId,
    stopReason: result.stopReason,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
```

В `WriteChapterInput` добавить `signal?: AbortSignal` и передать его в `streamText` рядом с `maxTokens`:

```ts
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
```

То же самое сделать в `packages/agents/src/reviser.ts`: `signal` во входе, проброс в `streamText`, `stopReason` в возврате.

- [ ] **Step 7: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/llm test -- src/__tests__/stream-stop-reason.test.ts`
Ожидаемо: PASS, 5 тестов.

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0 по всем пакетам.

Выполнить: `pnpm --filter @book-forge/llm test && pnpm --filter @book-forge/agents test`
Ожидаемо: PASS.

- [ ] **Step 8: Коммит**

```bash
git add packages/llm/src packages/agents/src/writer.ts packages/agents/src/reviser.ts
git commit -m "feat(llm): report why the stream stopped, and accept an abort signal

Hitting the output limit and finishing a chapter were indistinguishable: no
backend read stop_reason. The subscription SDK does not report one at all, so
it returns null and null counts as unconfirmed — a truncated chapter taken for
a finished one costs more than one extra question to the author."
```

---

### Task 5: Генерация создаёт предложение, а не версию

Здесь меняется базовый сценарий автора. До этой задачи `POST /chapters/:id/write` вставлял версию, делал её текущей, ставил задания памяти и удалял черновик — всё это без единого решения автора.

**Files:**
- Create: `apps/server/src/utils/prose-proposals.ts`
- Create: `apps/server/src/routes/__tests__/write-proposal.test.ts`
- Modify: `apps/server/src/routes/plot.ts:454-586`

**Interfaces:**
- Consumes: `proseProposalSchema`, `ProposalKind` (задача 2); `isConfirmedCompletion` (задача 4).
- Produces:
  - `contextFingerprint(sqlite, chapterId): string`
  - `createProposal(sqlite, input): number` — возвращает id, статус `streaming`
  - `finishProposal(sqlite, id, outcome): void`
  - `loadProposal(sqlite, id): ProseProposal | undefined`
  - `toProposal(row): ProseProposal`
  - SSE-событие `proposal` в начале потока и `proposal` вместо `version` в событии `done`.

- [ ] **Step 1: Написать падающий тест**

Создать `apps/server/src/routes/__tests__/write-proposal.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
}));

import { runChapterWriter } from "@book-forge/agents";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runChapterWriterMock = vi.mocked(runChapterWriter);

interface BookJson { id: number }
interface ChapterJson { id: number }

let t: TestApp;
let bookId: number;
let chapterId: number;

/** Собирает SSE-ответ в события: тестам нужен разбор, а не сырой текст. */
async function readSse(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const raw = await res.text();
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = block.match(/^data: (.+)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

function mockWriter(text: string, stopReason: string | null): void {
  runChapterWriterMock.mockImplementation(
    // eslint-disable-next-line require-yield
    async function* () {
      yield text.slice(0, 5);
      return {
        text,
        modelId: "test-model",
        stopReason,
        tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
      };
    } as never,
  );
}

function seedSelectedPlan(): void {
  const db = new Database(`${t.dbDir}/test.sqlite`);
  db.prepare("UPDATE chapters SET plan_json = ? WHERE id = ?").run(
    JSON.stringify({
      variants: [
        {
          label: "v1",
          pov: "Рин",
          emotionalGoal: "решимость",
          estimatedWords: 1200,
          beats: [
            { index: 0, type: "scene", summary: "s", goal: "g", conflict: "c", outcome: "o" },
          ],
        },
      ],
      selectedIndex: 0,
    }),
    chapterId,
  );
  db.close();
}

beforeEach(async () => {
  t = makeTestApp();
  runChapterWriterMock.mockReset();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Кандидат",
    premise: "p",
  });
  bookId = b.id;
  const ch = await sendJson<ChapterJson>(t.app, `/api/books/${bookId}/chapters`, "POST", {
    title: "Глава",
  });
  chapterId = ch.id;
  seedSelectedPlan();
});
afterEach(() => t.cleanup());

describe("POST /api/chapters/:id/write", () => {
  it("создаёт кандидата и не трогает текущую версию главы (AC-16)", async () => {
    mockWriter("Первый абзац.\n\nВторой абзац.", "end_turn");

    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const proposal = (done!.data as { proposal: { id: number; status: string; completion: string } })
      .proposal;
    expect(proposal.status).toBe("ready");
    expect(proposal.completion).toBe("confirmed");

    const chapter = await sendJson<{ currentVersionId: number | null; draft: unknown }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(chapter.currentVersionId).toBeNull();
    expect(chapter.draft).toBeNull();
  });

  it("сообщает идентификатор кандидата в начале потока", async () => {
    mockWriter("Текст.", "end_turn");
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const begin = events.find((e) => e.event === "proposal");
    expect(begin).toBeDefined();
    expect((begin!.data as { proposalId: number }).proposalId).toBeGreaterThan(0);
  });

  it("не ставит заданий памяти до принятия (AC-16)", async () => {
    mockWriter("Текст.", "end_turn");
    await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const db = new Database(`${t.dbDir}/test.sqlite`);
    const jobs = db.prepare("SELECT COUNT(*) c FROM memory_jobs").get() as { c: number };
    db.close();
    expect(jobs.c).toBe(0);
  });

  it("бэкенд без причины остановки даёт незавершённого кандидата (AC-37)", async () => {
    mockWriter("Обрубок", null);
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const proposal = (events.find((e) => e.event === "done")!.data as {
      proposal: { status: string; completion: string };
    }).proposal;
    expect(proposal.status).toBe("incomplete");
    expect(proposal.completion).toBe("unconfirmed");
  });

  it("лимит вывода — тоже незавершённый кандидат (AC-37)", async () => {
    mockWriter("Обрубок по лимиту", "max_tokens");
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const proposal = (events.find((e) => e.event === "done")!.data as {
      proposal: { status: string; stopReason: string | null };
    }).proposal;
    expect(proposal.status).toBe("incomplete");
    expect(proposal.stopReason).toBe("max_tokens");
  });

  it("падение агента помечает кандидата failed, а не оставляет streaming", async () => {
    runChapterWriterMock.mockImplementation(
      // eslint-disable-next-line require-yield
      async function* () {
        throw new Error("бэкенд недоступен");
      } as never,
    );
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    expect(events.find((e) => e.event === "error")).toBeDefined();

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const row = db
      .prepare("SELECT status, error_message FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { status: string; error_message: string | null };
    db.close();
    expect(row.status).toBe("failed");
    expect(row.error_message).toContain("бэкенд недоступен");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/write-proposal.test.ts`
Ожидаемо: FAIL — событие `done` несёт `version`, а `proposal` в нём нет; `currentVersionId` не пуст.

- [ ] **Step 3: Написать модуль предложений**

Создать `apps/server/src/utils/prose-proposals.ts`:

```ts
import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  proseProposalSchema,
  type ProposalKind,
  type ProseProposal,
  type ProseProposalStatus,
} from "@book-forge/shared";

export interface ProseProposalRow {
  id: number;
  book_id: number;
  chapter_id: number;
  kind: string;
  status: string;
  base_version_id: number | null;
  base_draft_revision: number | null;
  context_fingerprint: string;
  content_text: string;
  content_json: string;
  word_count: number;
  completion: string;
  stop_reason: string | null;
  model_id: string | null;
  backend: string | null;
  accepted_version_id: number | null;
  accept_request_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function toProposal(row: ProseProposalRow): ProseProposal {
  return proseProposalSchema.parse({
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    kind: row.kind,
    status: row.status,
    baseVersionId: row.base_version_id,
    baseDraftRevision: row.base_draft_revision,
    contextFingerprint: row.context_fingerprint,
    contentText: row.content_text,
    contentJson: row.content_json,
    wordCount: row.word_count,
    completion: row.completion,
    stopReason: row.stop_reason,
    modelId: row.model_id,
    backend: row.backend,
    acceptedVersionId: row.accepted_version_id,
    acceptRequestId: row.accept_request_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Отпечаток того, от чего кандидат зависит и что могло уехать, пока модель
 *  писала: план главы, текущая версия и время последней правки книги (её
 *  двигают правки персонажей, лора и плана). Совпал — база та же; разошёлся —
 *  автор увидит предупреждение и решит сам, а не примет вслепую. */
export function contextFingerprint(sqlite: DatabaseType, chapterId: number): string {
  const row = sqlite
    .prepare(
      `SELECT c.plan_json, c.current_version_id, c.intent, b.updated_at AS book_updated_at
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    )
    .get(chapterId) as
    | {
        plan_json: string | null;
        current_version_id: number | null;
        intent: string | null;
        book_updated_at: string;
      }
    | undefined;
  if (!row) return "";
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.plan_json,
        row.current_version_id,
        row.intent,
        row.book_updated_at,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

export interface CreateProposalInput {
  bookId: number;
  chapterId: number;
  kind: ProposalKind;
  baseVersionId: number | null;
}

const EMPTY_CONTENT_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';

/** Кандидат заводится ДО первого токена: тогда отмена, падение процесса и
 *  поздний ответ имеют, к чему прицепиться, а «висящий» прогон видно в базе. */
export function createProposal(
  sqlite: DatabaseType,
  input: CreateProposalInput,
): number {
  const draft = sqlite
    .prepare("SELECT revision FROM chapter_drafts WHERE chapter_id = ?")
    .get(input.chapterId) as { revision: number } | undefined;
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO prose_proposals
         (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
          context_fingerprint, content_text, content_json, word_count,
          completion, created_at, updated_at)
       VALUES (?, ?, ?, 'streaming', ?, ?, ?, '', ?, 0, 'unconfirmed', ?, ?)`,
    )
    .run(
      input.bookId,
      input.chapterId,
      input.kind,
      input.baseVersionId,
      draft ? draft.revision : null,
      contextFingerprint(sqlite, input.chapterId),
      EMPTY_CONTENT_JSON,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export interface FinishProposalInput {
  status: Extract<ProseProposalStatus, "ready" | "incomplete" | "cancelled" | "failed">;
  contentText?: string;
  contentJson?: string;
  wordCount?: number;
  completion?: "confirmed" | "unconfirmed";
  stopReason?: string | null;
  modelId?: string | null;
  backend?: string | null;
  errorMessage?: string | null;
}

export function finishProposal(
  sqlite: DatabaseType,
  id: number,
  input: FinishProposalInput,
): void {
  sqlite
    .prepare(
      `UPDATE prose_proposals SET
         status = ?,
         content_text = COALESCE(?, content_text),
         content_json = COALESCE(?, content_json),
         word_count = COALESCE(?, word_count),
         completion = COALESCE(?, completion),
         stop_reason = ?,
         model_id = ?,
         backend = ?,
         error_message = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.contentText ?? null,
      input.contentJson ?? null,
      input.wordCount ?? null,
      input.completion ?? null,
      input.stopReason ?? null,
      input.modelId ?? null,
      input.backend ?? null,
      input.errorMessage ?? null,
      new Date().toISOString(),
      id,
    );
}

export function loadProposal(
  sqlite: DatabaseType,
  id: number,
): ProseProposal | undefined {
  const row = sqlite
    .prepare("SELECT * FROM prose_proposals WHERE id = ?")
    .get(id) as ProseProposalRow | undefined;
  return row ? toProposal(row) : undefined;
}

export function listProposals(
  sqlite: DatabaseType,
  chapterId: number,
  limit = 10,
): ProseProposal[] {
  const rows = sqlite
    .prepare(
      "SELECT * FROM prose_proposals WHERE chapter_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(chapterId, limit) as ProseProposalRow[];
  return rows.map(toProposal);
}
```

- [ ] **Step 4: Переписать хвост маршрута генерации**

В `apps/server/src/routes/plot.ts` добавить импорт рядом с остальными утилитами:

```ts
import {
  createProposal,
  finishProposal,
  loadProposal,
} from "../utils/prose-proposals.js";
import { isConfirmedCompletion } from "@book-forge/llm";
```

Заменить тело `streamSSE` (строки 454-585) так, чтобы вместо вставки версии создавалось предложение. Блок от `return streamSSE(c, async (stream) => {` до закрывающей скобки становится:

```ts
    return streamSSE(c, async (stream) => {
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let modelId = "";
      let stopReason: string | null = null;

      // Кандидат заводится до первого токена: он же — то, что отменяют, и то,
      // что остаётся в базе, если процесс умрёт на середине.
      const proposalId = createProposal(sqlite, {
        bookId: ch.book_id,
        chapterId: ch.id,
        kind: "write",
        baseVersionId: ch.current_version_id,
      });
      await stream.writeSSE({
        event: "proposal",
        data: JSON.stringify({
          proposalId,
          baseVersionId: ch.current_version_id,
        }),
      });

      try {
        const gen = runChapterWriter({
          bookTitle: ctx.title,
          bookPremise: ctx.premise,
          bookOutline: ctx.outlineSelected,
          chapterTitle: ch.title,
          beatSheet,
          previousChaptersSummary: inc.has("rolling") ? prevSummary : null,
          previousChapterTail: inc.has("prevTail") ? prevTail : null,
          characterContext: inc.has("characters") ? characterContextFinal : null,
          povKnowledge: inc.has("pov") ? povKnowledge : null,
          loreContext: inc.has("lore") ? loreContext : null,
          styleContext: inc.has("style") ? styleCtx.prompt : null,
          studioContext: inc.has("studio") ? studioCtx : null,
          retrievedContext: inc.has("retrieval") ? writerRetrieved.promptBlock : null,
          fatigueWords: styleCtx.fatigueBlacklist,
          config: {
            variants: 1,
            ...parsed.data.config,
            model: parsed.data.config?.model ?? ctx.writerModel,
          },
          provider: ctx.writerProvider,
          ...(ctx.writerLocalModel ? { localModelTag: ctx.writerLocalModel } : {}),
        });
        while (true) {
          const next = await gen.next();
          if (next.done) {
            fullText = next.value.text;
            modelId = next.value.modelId;
            stopReason = next.value.stopReason;
            inputTokens = next.value.tokens.input;
            outputTokens = next.value.tokens.output;
            cacheCreationTokens = next.value.tokens.cacheCreation;
            cacheReadTokens = next.value.tokens.cacheRead;
            break;
          }
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ text: next.value }),
          });
        }

        const confirmed = isConfirmedCompletion(stopReason);
        finishProposal(sqlite, proposalId, {
          status: confirmed ? "ready" : "incomplete",
          contentText: fullText,
          contentJson: JSON.stringify(prosePlainTextToProseMirror(fullText)),
          wordCount: countWords(fullText),
          completion: confirmed ? "confirmed" : "unconfirmed",
          stopReason,
          modelId,
          backend: ctx.writerProvider,
        });

        logUsage(sqlite, {
          route: "writer.chapter",
          model: modelId,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            proposal: loadProposal(sqlite, proposalId),
            tokens: {
              input: inputTokens,
              output: outputTokens,
              cacheCreation: cacheCreationTokens,
              cacheRead: cacheReadTokens,
            },
          }),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        finishProposal(sqlite, proposalId, {
          status: "failed",
          errorMessage: message,
          stopReason,
        });
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message, proposalId }),
        });
      }
    });
```

Обратить внимание: вызов `triggerCanonExtractionAfterWriter` и вставка версии из старого кода **удаляются отсюда** — они переезжают в принятие (задача 8). `logUsage` остаётся здесь и теряет `versionId`: версии на этот момент ещё нет.

- [ ] **Step 5: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/write-proposal.test.ts`
Ожидаемо: PASS, 6 тестов.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS. Тесты, которые ждали от генерации новую версию, надо привести к новому поведению — их немного, и правка одинаковая: смотреть предложение, а не версию.

- [ ] **Step 6: Коммит**

```bash
git add apps/server/src/utils/prose-proposals.ts apps/server/src/routes/plot.ts apps/server/src/routes/__tests__/write-proposal.test.ts
git commit -m "feat(writer): a generated chapter lands as a candidate, not as the current version

The route used to insert a version, make it current, enqueue the memory
pipeline and delete the draft — all without a single decision by the author.
Now the run creates a proposal before the first token, so cancellation, a dead
process and a late answer all have something to attach to."
```

---

### Task 6: Repair создаёт предложение

Тот же жизненный цикл для правки. Отличие одно: базой служит версия, которую критиковали, и принятие сделает из кандидата ветвь `repair-N`.

**Files:**
- Modify: `apps/server/src/routes/critique.ts:313-457`
- Test: `apps/server/src/routes/__tests__/repair.test.ts`

**Interfaces:**
- Consumes: `createProposal`, `finishProposal`, `loadProposal` (задача 5); `isConfirmedCompletion` (задача 4).
- Produces: SSE `proposal` в начале, `done` с полем `proposal` вместо `version`; номер итерации остаётся в событии `iteration`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `apps/server/src/routes/__tests__/repair.test.ts` мок агента в начало файла (перед импортом `_helpers.js`):

```ts
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  reviseChapter: vi.fn(),
}));
```

и добавить тест в конец `describe`:

```ts
  it("repair кладёт кандидата и не двигает текущую версию (AC-16)", async () => {
    const { reviseChapter } = await import("@book-forge/agents");
    vi.mocked(reviseChapter).mockImplementation(
      // eslint-disable-next-line require-yield
      async function* () {
        yield "Исправ";
        return {
          text: "Исправленный текст.",
          modelId: "test-model",
          stopReason: "end_turn",
          tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
        };
      } as never,
    );

    const Database = (await import("better-sqlite3")).default;
    const path = `${t.dbDir}/test.sqlite`;
    const db = new Database(path);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
       VALUES (?, 'done', ?, ?, ?)`,
    ).run(
      versionId,
      JSON.stringify({
        critics: [],
        blockingCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        generatedAt: now,
      }),
      now,
      now,
    );
    const before = db
      .prepare(
        "SELECT current_version_id c FROM chapters WHERE id = (SELECT chapter_id FROM chapter_versions WHERE id = ?)",
      )
      .get(versionId) as { c: number };
    db.close();

    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      {},
    );
    const raw = await res.text();
    expect(raw).toContain("event: proposal");

    const db2 = new Database(path);
    const after = db2
      .prepare(
        "SELECT current_version_id c FROM chapters WHERE id = (SELECT chapter_id FROM chapter_versions WHERE id = ?)",
      )
      .get(versionId) as { c: number };
    const proposal = db2
      .prepare("SELECT kind, status FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { kind: string; status: string };
    const jobs = db2
      .prepare("SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id != ?")
      .get(versionId) as { c: number };
    db2.close();

    expect(after.c).toBe(before.c);
    expect(proposal).toMatchObject({ kind: "repair", status: "ready" });
    expect(jobs.c).toBe(0);
  });
```

Добавить `vi` в импорт vitest в этом файле.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/repair.test.ts`
Ожидаемо: FAIL — `expected 'event: proposal' to be in output`, текущая версия сдвинулась.

- [ ] **Step 3: Переписать хвост repair**

В `apps/server/src/routes/critique.ts` добавить импорты:

```ts
import {
  createProposal,
  finishProposal,
  loadProposal,
} from "../utils/prose-proposals.js";
import { isConfirmedCompletion } from "@book-forge/llm";
```

Внутри `streamSSE` обработчика repair сразу после события `iteration` завести кандидата:

```ts
        const proposalId = createProposal(sqlite, {
          bookId: ch.book_id,
          chapterId: ch.id,
          kind: "repair",
          baseVersionId: v.id,
        });
        await stream.writeSSE({
          event: "proposal",
          data: JSON.stringify({ proposalId, baseVersionId: v.id }),
        });
```

Заменить всю транзакцию вставки версии (строки 366-433 старого кода) на завершение кандидата:

```ts
          const confirmed = isConfirmedCompletion(stopReason);
          finishProposal(sqlite, proposalId, {
            status: confirmed ? "ready" : "incomplete",
            contentText: fullText,
            contentJson: JSON.stringify(prosePlainTextToProseMirror(fullText)),
            wordCount: countWords(fullText),
            completion: confirmed ? "confirmed" : "unconfirmed",
            stopReason,
            modelId,
            backend: "anthropic",
          });

          logUsage(sqlite, {
            route: "reviser.repair",
            model: modelId,
            usage: {
              inputTokens,
              outputTokens,
              cacheCreationInputTokens: cacheCreationTokens,
              cacheReadInputTokens: cacheReadTokens,
            },
            bookId: ch.book_id,
            chapterId: ch.id,
          });

          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({
              proposal: loadProposal(sqlite, proposalId),
              iteration: nextIteration,
              tokens: {
                input: inputTokens,
                output: outputTokens,
                cacheCreation: cacheCreationTokens,
                cacheRead: cacheReadTokens,
              },
            }),
          });
```

Объявить `let stopReason: string | null = null;` рядом с `let modelId = "";` и присвоить его из `next.value.stopReason` в цикле. В `catch` добавить `finishProposal(sqlite, proposalId, { status: "failed", errorMessage: message, stopReason })`, для чего объявление `proposalId` вынести перед `try`.

Ветвь `repair-N` создаётся не здесь, а при принятии: имя ветви зависит от того, что автор принял, и до принятия версии не существует. Счётчик итераций (`countRepairAncestors`) продолжает считать по принятым версиям — предложение итерацию не тратит.

- [ ] **Step 4: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/repair.test.ts`
Ожидаемо: PASS.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/server/src/routes/critique.ts apps/server/src/routes/__tests__/repair.test.ts
git commit -m "feat(repair): revision lands as a candidate too

Same lifecycle as generation. The repair-N branch is created on acceptance,
not here: its name depends on what the author accepted, and until then there
is no version to name."
```

---

### Task 7: Остановка запуска

AC-20: отмена, обрыв и поздний ответ не должны ничего заменять. Реестр в памяти процесса решает главное — «поздний ответ не применяется», даже если сам вызов прервать нечем. Сигнал отмены добавляется сверху, там, где бэкенд его понимает.

**Files:**
- Create: `apps/server/src/utils/proposal-cancel.ts`
- Create: `apps/server/src/utils/__tests__/proposal-cancel.test.ts`
- Create: `apps/server/src/routes/proposals.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/routes/plot.ts`, `apps/server/src/routes/critique.ts`

**Interfaces:**
- Consumes: `finishProposal`, `loadProposal`, `listProposals` (задача 5).
- Produces:
  - `createProposalCancelRegistry(): ProposalCancelRegistry` с `begin(id)`, `requestStop(id): boolean`, `shouldStop(id): boolean`, `signal(id): AbortSignal | undefined`, `end(id)`, `size()`
  - `createProposalsRoute(sqlite, cancels, memoryWorker?): Hono`
  - `POST /api/prose-proposals/:id/cancel`, `GET /api/prose-proposals/:id`, `GET /api/chapters/:id/proposals`

- [ ] **Step 1: Написать падающий тест реестра**

Создать `apps/server/src/utils/__tests__/proposal-cancel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createProposalCancelRegistry } from "../proposal-cancel.js";

describe("createProposalCancelRegistry", () => {
  it("незарегистрированный запуск остановить нельзя", () => {
    const reg = createProposalCancelRegistry();
    expect(reg.requestStop(1)).toBe(false);
  });

  it("зарегистрированный запуск помечается на остановку", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.requestStop(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(true);
  });

  it("остановка одного запуска не задевает соседний", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    reg.begin(2);
    reg.requestStop(1);
    expect(reg.shouldStop(2)).toBe(false);
  });

  it("остановка прерывает сигнал запуска", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    const signal = reg.signal(1);
    expect(signal?.aborted).toBe(false);
    reg.requestStop(1);
    expect(signal?.aborted).toBe(true);
  });

  it("завершённый запуск исчезает из реестра", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    reg.end(1);
    expect(reg.size()).toBe(0);
    expect(reg.requestStop(1)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/proposal-cancel.test.ts`
Ожидаемо: FAIL, `Failed to resolve import "../proposal-cancel.js"`.

- [ ] **Step 3: Написать реестр**

Создать `apps/server/src/utils/proposal-cancel.ts`:

```ts
/** Какие запуски генерации идут сейчас и какие из них попросили остановиться.
 *
 *  В памяти процесса, а не в БД: запуск живёт внутри одного запроса, и после
 *  перезапуска останавливать уже нечего. Ключ — id предложения: он уникален
 *  глобально, так что отмена не может задеть соседний запуск. */
export interface ProposalCancelRegistry {
  begin: (proposalId: number) => void;
  /** true, если такой запуск идёт и его пометили на остановку. */
  requestStop: (proposalId: number) => boolean;
  shouldStop: (proposalId: number) => boolean;
  /** Сигнал для бэкендов, умеющих прерываться. Остальные его игнорируют, и
   *  тогда работает второй рубеж: результат позднего ответа не применяется. */
  signal: (proposalId: number) => AbortSignal | undefined;
  end: (proposalId: number) => void;
  size: () => number;
}

export function createProposalCancelRegistry(): ProposalCancelRegistry {
  const runs = new Map<number, { stopping: boolean; controller: AbortController }>();

  return {
    begin: (proposalId) => {
      runs.set(proposalId, { stopping: false, controller: new AbortController() });
    },
    requestStop: (proposalId) => {
      const run = runs.get(proposalId);
      if (!run) return false;
      run.stopping = true;
      run.controller.abort();
      return true;
    },
    shouldStop: (proposalId) => runs.get(proposalId)?.stopping === true,
    signal: (proposalId) => runs.get(proposalId)?.controller.signal,
    end: (proposalId) => {
      runs.delete(proposalId);
    },
    size: () => runs.size,
  };
}
```

- [ ] **Step 4: Написать маршруты предложений**

Создать `apps/server/src/routes/proposals.ts`:

```ts
import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import { finishProposal, listProposals, loadProposal } from "../utils/prose-proposals.js";
import type { ProposalCancelRegistry } from "../utils/proposal-cancel.js";
import { notFound, badRequest } from "../utils/errors.js";

export function createProposalsRoute(
  sqlite: DatabaseType,
  cancels: ProposalCancelRegistry,
): Hono {
  const r = new Hono();

  r.get("/chapters/:id/proposals", (c) => {
    const id = Number(c.req.param("id"));
    const ch = sqlite
      .prepare("SELECT id FROM chapters WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!ch) return notFound(c, "chapter");
    return c.json(listProposals(sqlite, id));
  });

  r.get("/prose-proposals/:id", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    return c.json(proposal);
  });

  r.post("/prose-proposals/:id/cancel", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    if (proposal.status !== "streaming") {
      return badRequest(c, `нельзя остановить предложение в статусе ${proposal.status}`);
    }
    // Порядок важен: сначала помечаем в базе, потом просим поток остановиться.
    // Наоборот — и поток успел бы дописать кандидата раньше, чем отмена легла.
    finishProposal(sqlite, id, { status: "cancelled" });
    cancels.requestStop(id);
    return c.json({ stopping: true });
  });

  return r;
}
```

- [ ] **Step 5: Связать реестр с генерацией и правкой**

В `apps/server/src/app.ts` рядом с созданием `memoryWorker` добавить:

```ts
  // Один реестр на процесс: его смотрит генерация и правка, а маршрут отмены
  // в него пишет.
  const proposalCancels = createProposalCancelRegistry();
```

и в блок монтирования маршрутов (строки 55-69):

```ts
  app.route("/api", createProposalsRoute(sqlite, proposalCancels));
```

Передать реестр в `createPlotRoute(sqlite, hasVec, memoryWorker, proposalCancels)` и `createCritiqueRoute(sqlite, memoryWorker, proposalCancels)`, добавив параметр в обе функции.

В обоих маршрутах после создания кандидата зарегистрировать запуск и передать сигнал агенту:

```ts
      cancels.begin(proposalId);
```

в вызов агента добавить:

```ts
          ...(cancels.signal(proposalId) !== undefined
            ? { signal: cancels.signal(proposalId)! }
            : {}),
```

после завершения потока, перед `finishProposal`, поставить второй рубеж:

```ts
        // Второй рубеж: бэкенд подписки прервать нечем, и поздний ответ
        // приходит уже после отмены. Он не имеет права ничего записать.
        if (cancels.shouldStop(proposalId)) {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({
              proposal: loadProposal(sqlite, proposalId),
              cancelled: true,
            }),
          });
          return;
        }
```

и в `finally` всего обработчика:

```ts
      } finally {
        cancels.end(proposalId);
      }
```

- [ ] **Step 6: Написать тест отмены через маршруты**

Дописать в `apps/server/src/routes/__tests__/write-proposal.test.ts`:

```ts
  it("отменённое предложение не переходит в ready поздним ответом (AC-20)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runChapterWriterMock.mockImplementation(
      // eslint-disable-next-line require-yield
      async function* () {
        yield "нач";
        await gate;
        return {
          text: "Поздний полный текст.",
          modelId: "test-model",
          stopReason: "end_turn",
          tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
        };
      } as never,
    );

    const running = send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    // Ждём, пока кандидат появится в базе: он заводится до первого токена.
    let proposalId = 0;
    for (let i = 0; i < 50 && proposalId === 0; i++) {
      const db = new Database(`${t.dbDir}/test.sqlite`);
      const row = db
        .prepare("SELECT id FROM prose_proposals ORDER BY id DESC LIMIT 1")
        .get() as { id: number } | undefined;
      db.close();
      if (row) proposalId = row.id;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(proposalId).toBeGreaterThan(0);

    const cancelled = await sendJson<{ stopping: boolean }>(
      t.app,
      `/api/prose-proposals/${proposalId}/cancel`,
      "POST",
      {},
    );
    expect(cancelled.stopping).toBe(true);

    release!();
    await running;

    const final = await sendJson<{ status: string; contentText: string }>(
      t.app,
      `/api/prose-proposals/${proposalId}`,
      "GET",
    );
    expect(final.status).toBe("cancelled");
    expect(final.contentText).not.toContain("Поздний полный текст");
  });

  it("остановить можно только идущий запуск", async () => {
    mockWriter("Текст.", "end_turn");
    await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const db = new Database(`${t.dbDir}/test.sqlite`);
    const row = db
      .prepare("SELECT id FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { id: number };
    db.close();
    const res = await send(t.app, `/api/prose-proposals/${row.id}/cancel`, "POST", {});
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 7: Запустить тесты и типы**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/proposal-cancel.test.ts`
Ожидаемо: PASS, 5 тестов.

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/write-proposal.test.ts`
Ожидаемо: PASS, 8 тестов.

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 8: Коммит**

```bash
git add apps/server/src/utils/proposal-cancel.ts apps/server/src/utils/__tests__/proposal-cancel.test.ts apps/server/src/routes/proposals.ts apps/server/src/app.ts apps/server/src/routes/plot.ts apps/server/src/routes/critique.ts apps/server/src/routes/__tests__/write-proposal.test.ts
git commit -m "feat(proposals): stopping a run, and a late answer that changes nothing

The subscription backend cannot be interrupted, so cancellation has two lines
of defence: the abort signal for backends that honour it, and a check before
the result is written for the ones that do not. The candidate is marked
cancelled in the database first, then the stream is asked to stop — the other
order lets the run finish writing before the cancellation lands."
```

---

### Task 8: Принятие кандидата целиком и отклонение

Сердце этапа. Здесь версия наконец создаётся — после проверки того, что автор видел ту же базу, что и сервер, и в одной транзакции с заданиями памяти.

**Files:**
- Modify: `apps/server/src/utils/prose-proposals.ts`
- Create: `apps/server/src/utils/__tests__/prose-proposals.test.ts`
- Modify: `apps/server/src/routes/proposals.ts`
- Create: `apps/server/src/routes/__tests__/proposals.test.ts`

**Interfaces:**
- Consumes: `acceptProseProposalInputSchema`, `rejectProseProposalInputSchema` (задача 2); `enqueueMemoryJobs`, `COMMIT_JOB_KINDS`, `markMemoryStaleOnCommit`, `toVersion` (существующие).
- Produces:
  - `acceptProposal(sqlite, id, input): AcceptOutcome`
  - `class ProposalConflictError extends Error { reason: "version" | "draft" | "status" | "stale" }`
  - `POST /api/prose-proposals/:id/accept`, `POST /api/prose-proposals/:id/reject`

- [ ] **Step 1: Написать падающий тест транзакции**

Создать `apps/server/src/utils/__tests__/prose-proposals.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import {
  acceptProposal,
  createProposal,
  finishProposal,
  loadProposal,
  ProposalConflictError,
} from "../prose-proposals.js";

let t: TestApp;
let db: DatabaseType;
let bookId: number;
let chapterId: number;

const docJson = (text: string): string =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

function readyProposal(text: string): number {
  const id = createProposal(db, {
    bookId,
    chapterId,
    kind: "write",
    baseVersionId: null,
  });
  finishProposal(db, id, {
    status: "ready",
    contentText: text,
    contentJson: docJson(text),
    wordCount: text.split(/\s+/).length,
    completion: "confirmed",
    stopReason: "end_turn",
    modelId: "test-model",
  });
  return id;
}

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Принятие",
    premise: "p",
  });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
  db = new Database(`${t.dbDir}/test.sqlite`);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("acceptProposal", () => {
  it("делает версию текущей и ставит задания памяти", () => {
    const id = readyProposal("Принятый текст.");
    const out = acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    expect(out.versionId).toBeGreaterThan(0);
    expect(out.replayed).toBe(false);

    const ch = db
      .prepare("SELECT current_version_id c FROM chapters WHERE id = ?")
      .get(chapterId) as { c: number };
    expect(ch.c).toBe(out.versionId);

    const jobs = db
      .prepare("SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id = ?")
      .get(out.versionId) as { c: number };
    expect(jobs.c).toBe(4);

    expect(loadProposal(db, id)?.status).toBe("accepted");
  });

  it("повтор с тем же requestId возвращает ту же версию и не удваивает память (AC-19)", () => {
    const id = readyProposal("Текст.");
    const first = acceptProposal(db, id, {
      requestId: "r-same",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    const second = acceptProposal(db, id, {
      requestId: "r-same",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    expect(second.versionId).toBe(first.versionId);
    expect(second.replayed).toBe(true);

    const versions = db
      .prepare("SELECT COUNT(*) c FROM chapter_versions WHERE chapter_id = ?")
      .get(chapterId) as { c: number };
    expect(versions.c).toBe(1);
    const jobs = db.prepare("SELECT COUNT(*) c FROM memory_jobs").get() as { c: number };
    expect(jobs.c).toBe(4);
  });

  it("тот же кандидат с другим requestId — конфликт статуса, а не вторая версия", () => {
    const id = readyProposal("Текст.");
    acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r2",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeStale: false,
      }),
    ).toThrow(ProposalConflictError);
  });

  it("устаревшее ожидание версии отклоняется (AC-17)", () => {
    const id = readyProposal("Текст.");
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: 999,
        expectedDraftRevision: null,
        acknowledgeStale: false,
      }),
    ).toThrow(/version/);
  });

  it("появившийся во время генерации черновик отклоняет принятие (AC-17)", () => {
    const id = readyProposal("Текст.");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_drafts
         (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
       VALUES (?, ?, 'правка автора', 2, NULL, 1, ?)`,
    ).run(chapterId, docJson("правка автора"), now);

    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeStale: false,
      }),
    ).toThrow(/draft/);

    // Правка автора на месте: неудачное принятие ничего не стёрло (INV-06).
    const draft = db
      .prepare("SELECT content_text t FROM chapter_drafts WHERE chapter_id = ?")
      .get(chapterId) as { t: string };
    expect(draft.t).toBe("правка автора");
  });

  it("принятие удаляет черновик, ревизию которого автор подтвердил", () => {
    const id = readyProposal("Текст.");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_drafts
         (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
       VALUES (?, ?, 'черновик', 1, NULL, 3, ?)`,
    ).run(chapterId, docJson("черновик"), now);

    acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: 3,
      acknowledgeStale: false,
    });
    const draft = db
      .prepare("SELECT COUNT(*) c FROM chapter_drafts WHERE chapter_id = ?")
      .get(chapterId) as { c: number };
    expect(draft.c).toBe(0);
  });

  it("незавершённого кандидата нельзя принять без осознанного подтверждения (AC-20)", () => {
    const id = createProposal(db, {
      bookId,
      chapterId,
      kind: "write",
      baseVersionId: null,
    });
    finishProposal(db, id, {
      status: "incomplete",
      contentText: "Обрубок",
      contentJson: docJson("Обрубок"),
      wordCount: 1,
      completion: "unconfirmed",
      stopReason: "max_tokens",
    });
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeStale: false,
      }),
    ).toThrow(/stale|incomplete/);

    const out = acceptProposal(db, id, {
      requestId: "r2",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: true,
    });
    expect(out.versionId).toBeGreaterThan(0);
  });

  it("уехавший контекст требует осознанного принятия", () => {
    const id = readyProposal("Текст.");
    db.prepare("UPDATE chapters SET intent = ? WHERE id = ?").run("другое намерение", chapterId);
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeStale: false,
      }),
    ).toThrow(/stale/);
  });

  it("кандидат repair принимается ветвью repair-N", () => {
    const base = acceptProposal(db, readyProposal("Первый текст."), {
      requestId: "r0",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    const repairId = createProposal(db, {
      bookId,
      chapterId,
      kind: "repair",
      baseVersionId: base.versionId,
    });
    finishProposal(db, repairId, {
      status: "ready",
      contentText: "Исправленный текст.",
      contentJson: docJson("Исправленный текст."),
      wordCount: 2,
      completion: "confirmed",
      stopReason: "end_turn",
    });
    const out = acceptProposal(db, repairId, {
      requestId: "r1",
      expectedVersionId: base.versionId,
      expectedDraftRevision: null,
      acknowledgeStale: false,
    });
    const v = db
      .prepare("SELECT branch_label b, parent_version_id p FROM chapter_versions WHERE id = ?")
      .get(out.versionId) as { b: string | null; p: number | null };
    expect(v.b).toBe("repair-1");
    expect(v.p).toBe(base.versionId);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/prose-proposals.test.ts`
Ожидаемо: FAIL, `acceptProposal is not exported`.

- [ ] **Step 3: Дописать принятие в модуль предложений**

В `apps/server/src/utils/prose-proposals.ts` добавить импорты:

```ts
import {
  applyProseChanges,
  blocksToDoc,
  diffProseBlocks,
  docToBlocks,
  REPAIR_BRANCH_PREFIX,
  type AcceptProseProposalInput,
} from "@book-forge/shared";
import { enqueueMemoryJobs, COMMIT_JOB_KINDS } from "./memory-queue.js";
import { markMemoryStaleOnCommit } from "./memory-activation.js";
import { extractText, countWords } from "./prosemirror.js";
```

и в конец файла:

```ts
export type ProposalConflictReason = "version" | "draft" | "status" | "stale";

export class ProposalConflictError extends Error {
  constructor(
    public readonly reason: ProposalConflictReason,
    message: string,
  ) {
    super(message);
    this.name = "ProposalConflictError";
  }
}

export interface AcceptOutcome {
  versionId: number;
  /** true — этот requestId уже принимали, версия та же самая. */
  replayed: boolean;
}

/** Сколько принятых repair-версий уже есть в предках. Считается по версиям, а
 *  не по предложениям: отклонённый кандидат итерацию не тратит. */
function countRepairAncestors(sqlite: DatabaseType, versionId: number | null): number {
  let count = 0;
  let cursor = versionId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const row = sqlite
      .prepare("SELECT parent_version_id, branch_label FROM chapter_versions WHERE id = ?")
      .get(cursor) as
      | { parent_version_id: number | null; branch_label: string | null }
      | undefined;
    if (!row) break;
    if (row.branch_label?.startsWith(REPAIR_BRANCH_PREFIX)) count++;
    cursor = row.parent_version_id;
  }
  return count;
}

export function acceptProposal(
  sqlite: DatabaseType,
  proposalId: number,
  input: AcceptProseProposalInput,
): AcceptOutcome {
  const tx = sqlite.transaction((): AcceptOutcome => {
    const proposal = loadProposal(sqlite, proposalId);
    if (!proposal) throw new ProposalConflictError("status", "предложение не найдено");

    // Идемпотентность по requestId: повтор после сетевого сбоя возвращает уже
    // созданную версию и не порождает второго обновления памяти.
    if (proposal.status === "accepted") {
      if (proposal.acceptRequestId === input.requestId && proposal.acceptedVersionId) {
        return { versionId: proposal.acceptedVersionId, replayed: true };
      }
      throw new ProposalConflictError("status", "предложение уже принято");
    }
    if (proposal.status === "streaming") {
      throw new ProposalConflictError("status", "предложение ещё пишется");
    }
    if (proposal.status !== "ready" && proposal.status !== "incomplete") {
      throw new ProposalConflictError("status", `нельзя принять предложение в статусе ${proposal.status}`);
    }
    // Незавершённый текст можно посмотреть, но нельзя принять как готовую
    // главу молча: обрыв, лимит вывода и молчащий бэкенд — не «дописано».
    if (proposal.completion === "unconfirmed" && !input.acknowledgeStale) {
      throw new ProposalConflictError(
        "stale",
        "завершение не подтверждено: примите осознанно или перезапустите",
      );
    }

    const ch = sqlite
      .prepare("SELECT id, book_id, order_index, current_version_id FROM chapters WHERE id = ?")
      .get(proposal.chapterId) as
      | { id: number; book_id: number; order_index: number; current_version_id: number | null }
      | undefined;
    if (!ch) throw new ProposalConflictError("status", "глава не найдена");
    // INV-11: предложение и глава обязаны принадлежать одной книге.
    if (ch.book_id !== proposal.bookId) {
      throw new ProposalConflictError("status", "предложение из другой книги");
    }

    // CAS по тому, что видел автор. Сравниваем с ожиданиями клиента, а не с
    // базой предложения: автор мог осознанно перечитать изменившуюся главу и
    // принять поверх неё.
    if ((ch.current_version_id ?? null) !== (input.expectedVersionId ?? null)) {
      throw new ProposalConflictError("version", "текущая версия главы изменилась");
    }
    const draft = sqlite
      .prepare("SELECT revision FROM chapter_drafts WHERE chapter_id = ?")
      .get(proposal.chapterId) as { revision: number } | undefined;
    const actualDraftRevision = draft ? draft.revision : null;
    if (actualDraftRevision !== (input.expectedDraftRevision ?? null)) {
      throw new ProposalConflictError("draft", "черновик изменился, пока шла генерация");
    }

    if (
      contextFingerprint(sqlite, proposal.chapterId) !== proposal.contextFingerprint &&
      !input.acknowledgeStale
    ) {
      throw new ProposalConflictError("stale", "база контекста изменилась с начала генерации");
    }

    // Что именно становится текстом версии: весь кандидат или база с
    // выбранными правками. Слияние делает сервер — иначе принятая версия
    // зависела бы от состояния вкладки.
    let contentJson = proposal.contentJson;
    let contentText = proposal.contentText;
    if (input.selectedChangeIds !== undefined) {
      const baseDoc = ch.current_version_id
        ? (
            sqlite
              .prepare("SELECT content_json FROM chapter_versions WHERE id = ?")
              .get(ch.current_version_id) as { content_json: string }
          ).content_json
        : '{"type":"doc","content":[{"type":"paragraph"}]}';
      const baseBlocks = docToBlocks(JSON.parse(baseDoc));
      const candidateBlocks = docToBlocks(JSON.parse(proposal.contentJson));
      const changes = diffProseBlocks(baseBlocks, candidateBlocks);
      const merged = applyProseChanges(baseBlocks, changes, input.selectedChangeIds);
      const mergedDoc = blocksToDoc(merged);
      contentJson = JSON.stringify(mergedDoc);
      contentText = extractText(mergedDoc);
    }

    const branchLabel =
      proposal.kind === "repair"
        ? `${REPAIR_BRANCH_PREFIX}${countRepairAncestors(sqlite, ch.current_version_id) + 1}`
        : null;
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, branch_label, created_at)
         VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
      )
      .run(
        ch.id,
        ch.current_version_id,
        contentJson,
        contentText,
        countWords(contentText),
        branchLabel,
        now,
      );
    const versionId = Number(info.lastInsertRowid);

    sqlite
      .prepare("UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?")
      .run(versionId, now, ch.id);
    sqlite.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(now, ch.book_id);
    // ADR 0002: принятие — это и есть осознанный коммит, поэтому задания
    // памяти ставятся здесь и только на итоговый принятый текст.
    enqueueMemoryJobs(sqlite, {
      bookId: ch.book_id,
      chapterId: ch.id,
      chapterVersionId: versionId,
      kinds: COMMIT_JOB_KINDS,
    });
    markMemoryStaleOnCommit(sqlite, ch.book_id, ch.order_index);
    sqlite.prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?").run(ch.id);

    sqlite
      .prepare(
        `UPDATE prose_proposals
         SET status = 'accepted', accepted_version_id = ?, accept_request_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(versionId, input.requestId, now, proposalId);
    // Остальные живые кандидаты этой главы посчитаны от базы, которой больше
    // нет: помечаем, а не оставляем автору выбор из устаревшего.
    sqlite
      .prepare(
        `UPDATE prose_proposals SET status = 'superseded', updated_at = ?
         WHERE chapter_id = ? AND id != ? AND status IN ('ready','incomplete')`,
      )
      .run(now, ch.id, proposalId);

    return { versionId, replayed: false };
  });
  return tx.immediate();
}

export function rejectProposal(sqlite: DatabaseType, proposalId: number): void {
  sqlite
    .prepare(
      `UPDATE prose_proposals SET status = 'rejected', updated_at = ?
       WHERE id = ? AND status IN ('ready','incomplete','cancelled','failed')`,
    )
    .run(new Date().toISOString(), proposalId);
}
```

- [ ] **Step 4: Запустить тест транзакции**

Выполнить: `pnpm --filter @book-forge/server test -- src/utils/__tests__/prose-proposals.test.ts`
Ожидаемо: PASS, 9 тестов.

- [ ] **Step 5: Написать падающий тест маршрутов**

Создать `apps/server/src/routes/__tests__/proposals.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
let chapterId: number;
let proposalId: number;

const docJson = (text: string): string =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Маршруты",
    premise: "p",
  });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", {
    title: "Глава",
  });
  chapterId = ch.id;

  const db = new Database(`${t.dbDir}/test.sqlite`);
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO prose_proposals
         (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
          context_fingerprint, content_text, content_json, word_count, completion,
          stop_reason, created_at, updated_at)
       VALUES (?, ?, 'write', 'ready', NULL, NULL, ?, 'Готовый текст.', ?, 2, 'confirmed', 'end_turn', ?, ?)`,
    )
    .run(b.id, chapterId, "fp-не-совпадёт", docJson("Готовый текст."), now, now);
  proposalId = Number(info.lastInsertRowid);
  db.close();
});
afterEach(() => t.cleanup());

describe("маршруты предложений", () => {
  it("404 на неизвестное предложение", async () => {
    const res = await send(t.app, "/api/prose-proposals/9999", "GET");
    expect(res.status).toBe(404);
  });

  it("принятие создаёт версию и возвращает её", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      requestId: "req-1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: { id: number }; replayed: boolean };
    expect(body.version.id).toBeGreaterThan(0);
    expect(body.replayed).toBe(false);

    const ch = await sendJson<{ currentVersionId: number }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.currentVersionId).toBe(body.version.id);
  });

  it("устаревшее ожидание версии даёт 409, а не тихую перезапись (AC-17)", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      requestId: "req-1",
      expectedVersionId: 4242,
      expectedDraftRevision: null,
      acknowledgeStale: true,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details: { reason: string } };
    expect(body.error).toBe("proposal_conflict");
    expect(body.details.reason).toBe("version");
  });

  it("повтор принятия после сетевого сбоя возвращает ту же версию (AC-19)", async () => {
    const body = { requestId: "req-same", expectedVersionId: null, expectedDraftRevision: null, acknowledgeStale: true };
    const first = (await sendJson<{ version: { id: number } }>(
      t.app,
      `/api/prose-proposals/${proposalId}/accept`,
      "POST",
      body,
    )).version.id;
    const second = await sendJson<{ version: { id: number }; replayed: boolean }>(
      t.app,
      `/api/prose-proposals/${proposalId}/accept`,
      "POST",
      body,
    );
    expect(second.version.id).toBe(first);
    expect(second.replayed).toBe(true);
  });

  it("отклонение не создаёт версию и не трогает память (AC-16)", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/reject`, "POST", {});
    expect(res.status).toBe(200);

    const ch = await sendJson<{ currentVersionId: number | null }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.currentVersionId).toBeNull();

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const jobs = db.prepare("SELECT COUNT(*) c FROM memory_jobs").get() as { c: number };
    const status = db
      .prepare("SELECT status FROM prose_proposals WHERE id = ?")
      .get(proposalId) as { status: string };
    db.close();
    expect(jobs.c).toBe(0);
    expect(status.status).toBe("rejected");
  });

  it("тело без requestId отвергается как некорректное", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      expectedVersionId: null,
      expectedDraftRevision: null,
    });
    expect(res.status).toBe(400);
  });

  it("список предложений главы отдаётся новыми вперёд", async () => {
    const list = await sendJson<Array<{ id: number }>>(
      t.app,
      `/api/chapters/${chapterId}/proposals`,
      "GET",
    );
    expect(list[0]?.id).toBe(proposalId);
  });
});
```

- [ ] **Step 6: Дописать маршруты**

В `apps/server/src/routes/proposals.ts` добавить импорты и два обработчика:

```ts
import {
  acceptProseProposalInputSchema,
  rejectProseProposalInputSchema,
} from "@book-forge/shared";
import { acceptProposal, rejectProposal, ProposalConflictError } from "../utils/prose-proposals.js";
import { toVersion, type ChapterVersionRow } from "../db/rows.js";
import { notFound, badRequest, validationFailed } from "../utils/errors.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
```

Сигнатуру расширить до `createProposalsRoute(sqlite, cancels, memoryWorker?: Pick<MemoryWorker, "kick">)` и добавить:

```ts
  r.post("/prose-proposals/:id/accept", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = acceptProseProposalInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    if (!loadProposal(sqlite, id)) return notFound(c, "prose_proposal");

    let outcome;
    try {
      outcome = acceptProposal(sqlite, id, parsed.data);
    } catch (e) {
      if (e instanceof ProposalConflictError) {
        return c.json(
          { error: "proposal_conflict", details: { reason: e.reason, message: e.message } },
          409,
        );
      }
      throw e;
    }
    memoryWorker?.kick();
    const v = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(outcome.versionId) as ChapterVersionRow;
    return c.json({ version: toVersion(v), replayed: outcome.replayed });
  });

  r.post("/prose-proposals/:id/reject", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = rejectProseProposalInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    if (proposal.status === "accepted") {
      return badRequest(c, "предложение уже принято");
    }
    rejectProposal(sqlite, id);
    return c.json(loadProposal(sqlite, id));
  });
```

В `apps/server/src/app.ts` передать воркер: `createProposalsRoute(sqlite, proposalCancels, memoryWorker)`.

- [ ] **Step 7: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/proposals.test.ts`
Ожидаемо: PASS, 7 тестов.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 8: Коммит**

```bash
git add apps/server/src/utils/prose-proposals.ts apps/server/src/utils/__tests__/prose-proposals.test.ts apps/server/src/routes/proposals.ts apps/server/src/routes/__tests__/proposals.test.ts apps/server/src/app.ts
git commit -m "feat(proposals): accept a candidate into a version, or reject it

Acceptance compares against what the author saw, not against what the proposal
recorded: the author may have deliberately re-read a changed chapter and
accepted on top of it. A mismatch is a 409 and the author's draft survives it
untouched. requestId makes a retry after a network failure return the same
version instead of a second one."
```

---

### Task 9: Частичное принятие

Слияние уже написано в задаче 8; здесь появляется то, чем автор выбирает: список правок с их текстом и проверка, что память берётся из итоговой версии, а не из полного кандидата (AC-18).

**Files:**
- Modify: `apps/server/src/routes/proposals.ts`
- Modify: `apps/server/src/routes/__tests__/proposals.test.ts`

**Interfaces:**
- Consumes: `diffProseBlocks`, `docToBlocks` (задача 1); `acceptProposal` с `selectedChangeIds` (задача 8).
- Produces: `GET /api/prose-proposals/:id/changes` → `{ baseVersionId, changes: ProseChange[] }`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `apps/server/src/routes/__tests__/proposals.test.ts`:

```ts
describe("частичное принятие", () => {
  /** Глава с текстом из трёх абзацев и кандидат, который меняет средний и
   *  дописывает четвёртый: две независимые правки, из которых автор берёт одну. */
  async function seedBaseAndCandidate(): Promise<{ versionId: number; proposalId: number }> {
    const doc = (...paragraphs: string[]) => ({
      type: "doc",
      content: paragraphs.map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      })),
    });
    const version = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: doc("Раз.", "Два.", "Три.") },
    );

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const now = new Date().toISOString();
    const book = db
      .prepare("SELECT book_id b FROM chapters WHERE id = ?")
      .get(chapterId) as { b: number };
    const fp = db
      .prepare("SELECT context_fingerprint f FROM prose_proposals WHERE id = ?")
      .get(proposalId) as { f: string };
    void fp;
    const info = db
      .prepare(
        `INSERT INTO prose_proposals
           (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
            context_fingerprint, content_text, content_json, word_count, completion,
            stop_reason, created_at, updated_at)
         VALUES (?, ?, 'write', 'ready', ?, NULL, 'fp', ?, ?, 4, 'confirmed', 'end_turn', ?, ?)`,
      )
      .run(
        book.b,
        chapterId,
        version.id,
        "Раз.\n\nВторой.\n\nТри.\n\nЧетыре.",
        JSON.stringify(doc("Раз.", "Второй.", "Три.", "Четыре.")),
        now,
        now,
      );
    db.close();
    return { versionId: version.id, proposalId: Number(info.lastInsertRowid) };
  }

  it("отдаёт список правок с текстом базы и кандидата", async () => {
    const { proposalId: pid } = await seedBaseAndCandidate();
    const body = await sendJson<{
      baseVersionId: number | null;
      changes: Array<{ id: string; kind: string; baseText: string[]; candidateText: string[] }>;
    }>(t.app, `/api/prose-proposals/${pid}/changes`, "GET");

    expect(body.changes).toHaveLength(2);
    expect(body.changes[0]).toMatchObject({
      kind: "replace",
      baseText: ["Два."],
      candidateText: ["Второй."],
    });
    expect(body.changes[1]).toMatchObject({ kind: "insert", candidateText: ["Четыре."] });
  });

  it("принимает только выбранную правку, а память берёт из итога (AC-18)", async () => {
    const { versionId, proposalId: pid } = await seedBaseAndCandidate();
    const changes = (
      await sendJson<{ changes: Array<{ id: string; kind: string }> }>(
        t.app,
        `/api/prose-proposals/${pid}/changes`,
        "GET",
      )
    ).changes;
    const insertOnly = changes.find((ch) => ch.kind === "insert")!;

    const accepted = await sendJson<{ version: { id: number; contentText: string } }>(
      t.app,
      `/api/prose-proposals/${pid}/accept`,
      "POST",
      {
        requestId: "req-partial",
        expectedVersionId: versionId,
        expectedDraftRevision: null,
        selectedChangeIds: [insertOnly.id],
        acknowledgeStale: true,
      },
    );

    // Взята только вставка: средний абзац остался прежним.
    expect(accepted.version.contentText).toContain("Два.");
    expect(accepted.version.contentText).not.toContain("Второй.");
    expect(accepted.version.contentText).toContain("Четыре.");

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const jobs = db
      .prepare("SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id = ?")
      .get(accepted.version.id) as { c: number };
    const candidateJobs = db
      .prepare(
        "SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id != ?",
      )
      .get(accepted.version.id) as { c: number };
    db.close();
    expect(jobs.c).toBe(4);
    expect(candidateJobs.c).toBe(0);
  });

  it("неизвестный идентификатор правки — 400, а не молча принятый кандидат", async () => {
    const { versionId, proposalId: pid } = await seedBaseAndCandidate();
    const res = await send(t.app, `/api/prose-proposals/${pid}/accept`, "POST", {
      requestId: "req-bad",
      expectedVersionId: versionId,
      expectedDraftRevision: null,
      selectedChangeIds: ["нет-такой"],
      acknowledgeStale: true,
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/proposals.test.ts`
Ожидаемо: FAIL — маршрута `/changes` нет, приходит 404.

- [ ] **Step 3: Добавить маршрут списка правок**

В `apps/server/src/routes/proposals.ts` добавить импорт:

```ts
import { diffProseBlocks, docToBlocks } from "@book-forge/shared";
```

и обработчик:

```ts
  /** Что именно предлагается изменить: сравнение считается на сервере, чтобы
   *  вкладка и принятие видели один и тот же набор идентификаторов правок. */
  r.get("/prose-proposals/:id/changes", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");

    const ch = sqlite
      .prepare("SELECT current_version_id FROM chapters WHERE id = ?")
      .get(proposal.chapterId) as { current_version_id: number | null } | undefined;
    const baseVersionId = ch?.current_version_id ?? null;
    const baseJson = baseVersionId
      ? (
          sqlite
            .prepare("SELECT content_json FROM chapter_versions WHERE id = ?")
            .get(baseVersionId) as { content_json: string }
        ).content_json
      : '{"type":"doc","content":[{"type":"paragraph"}]}';

    let baseBlocks: string[] = [];
    let candidateBlocks: string[] = [];
    try {
      baseBlocks = docToBlocks(JSON.parse(baseJson));
      candidateBlocks = docToBlocks(JSON.parse(proposal.contentJson));
    } catch {
      // Битый JSON версии не должен ронять экран: отдаём пустое сравнение,
      // автор всё ещё может принять кандидата целиком.
      return c.json({ baseVersionId, changes: [] });
    }
    return c.json({
      baseVersionId,
      changes: diffProseBlocks(baseBlocks, candidateBlocks),
    });
  });
```

- [ ] **Step 4: Превратить неизвестную правку в 400**

В обработчике принятия расширить `catch`, чтобы ошибка слияния не превращалась в 500:

```ts
    } catch (e) {
      if (e instanceof ProposalConflictError) {
        return c.json(
          { error: "proposal_conflict", details: { reason: e.reason, message: e.message } },
          409,
        );
      }
      if (e instanceof Error && e.message.startsWith("unknown change")) {
        return badRequest(c, `неизвестная правка: ${e.message.slice("unknown change: ".length)}`);
      }
      throw e;
    }
```

- [ ] **Step 5: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/proposals.test.ts`
Ожидаемо: PASS, 10 тестов.

Выполнить: `pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/server/src/routes/proposals.ts apps/server/src/routes/__tests__/proposals.test.ts
git commit -m "feat(proposals): accept a chosen subset of the edits

The diff is computed on the server so the tab and the acceptance see the same
change ids. Memory jobs are enqueued for the merged version, not for the full
candidate the author only partly took."
```

---

### Task 10: Честный статус критики

AC-27. Сегодня статус считается как `errors.length === report.critics.length`, где `critics` — только успешные отчёты. Четыре падения из четырёх дают `4 === 0`, то есть `done`: автор видит зелёный отчёт, в котором нет ни одной проверки.

**Files:**
- Create: `apps/server/drizzle/0021_critique_partial.sql` (создаётся скриптом)
- Modify: `packages/shared/src/critique.ts`
- Modify: `apps/server/src/db/schema.ts:295-315`
- Modify: `apps/server/src/routes/critique.ts:215-257`
- Test: `apps/server/src/routes/__tests__/critique.test.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces:
  - `CritiqueReportStatus` пополняется значением `partial`.
  - `FullCritiqueReport` получает `requestedCritics: CriticType[]` и `failedCritics: CriticType[]`.

- [ ] **Step 1: Создать миграцию**

Выполнить: `pnpm --filter @book-forge/server drizzle:new critique_partial`
Ожидаемо: `✅ created migration 0021_critique_partial`.

- [ ] **Step 2: Написать падающий тест**

Дописать в `apps/server/src/routes/__tests__/critique.test.ts`:

```ts
  it("все критики упали — статус error, а не done (AC-27)", async () => {
    // ANTHROPIC_API_KEY удалён в beforeEach: каждый критик падает на старте.
    const r = await sendJson<{
      status: string;
      errorMessage: string | null;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    expect(r.status).toBe("error");
    expect(r.errorMessage).toBeTruthy();
    expect(r.report?.failedCritics).toHaveLength(4);
    expect(r.report?.requestedCritics).toHaveLength(4);
  });

  it("статус считается от числа запрошенных критиков, а не от длины списка успешных", async () => {
    const r = await sendJson<{
      status: string;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {
      critics: ["style"],
    });
    expect(r.report?.requestedCritics).toEqual(["style"]);
    expect(r.status).toBe("error");
  });
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/critique.test.ts`
Ожидаемо: FAIL, `expected 'done' to be 'error'`.

- [ ] **Step 4: Написать SQL**

Записать в `apps/server/drizzle/0021_critique_partial.sql`:

```sql
-- Migration 0021_critique_partial
-- Статус разбора «часть критиков отработала, часть упала» не существовал, и
-- агрегация выдавала такой прогон за успешный. SQLite не меняет CHECK через
-- ALTER TABLE, поэтому таблица пересобирается: она маленькая и всегда
-- восстановима повторным запуском критики.

CREATE TABLE `critique_reports_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_version_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`report_json` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "critique_status_check" CHECK(`status` IN ('pending','done','partial','error'))
);--> statement-breakpoint
INSERT INTO `critique_reports_new`
  (`id`, `chapter_version_id`, `status`, `report_json`, `error_message`, `created_at`, `completed_at`)
SELECT `id`, `chapter_version_id`, `status`, `report_json`, `error_message`, `created_at`, `completed_at`
FROM `critique_reports`;--> statement-breakpoint
DROP TABLE `critique_reports`;--> statement-breakpoint
ALTER TABLE `critique_reports_new` RENAME TO `critique_reports`;--> statement-breakpoint
CREATE INDEX `idx_critique_version` ON `critique_reports` (`chapter_version_id`);
```

- [ ] **Step 5: Расширить общий контракт отчёта**

В `packages/shared/src/critique.ts` добавить `partial` в перечень статусов отчёта и два поля в `fullCritiqueReportSchema`:

```ts
  /** Кого просили проверить. Статус прогона считается от этого списка, а не
   *  от длины списка успешных отчётов: четыре падения из четырёх когда-то
   *  давали «всё хорошо». */
  requestedCritics: z.array(criticTypeSchema).default([]),
  failedCritics: z.array(criticTypeSchema).default([]),
```

`default([])` обязателен: старые строки `report_json` этих полей не содержат и должны продолжать разбираться.

- [ ] **Step 6: Починить агрегацию**

В `apps/server/src/routes/critique.ts` заменить вычисление статуса (строки 227-241) на:

```ts
        const requested = parsed.data.critics ?? ALL_CRITIC_TYPES;
        const failed = result.errors.map((e) => e.critic);
        const succeeded = result.report.critics.length;
        const status =
          succeeded === 0 ? "error" : failed.length > 0 ? "partial" : "done";
        const reportJson = JSON.stringify({
          ...result.report,
          requestedCritics: requested,
          failedCritics: failed,
        });
        sqlite
          .prepare(
            `UPDATE critique_reports
             SET status = ?, report_json = ?, error_message = ?, completed_at = ?
             WHERE id = ?`,
          )
          .run(status, reportJson, errorMessage, completedAt, reportRowId);
```

Список запрошенных по умолчанию взять там же, где его берёт граф критики, и не хардкодить второй раз: в начале файла

```ts
import { ALL_CRITIC_TYPES } from "@book-forge/shared";
```

Если такой константы в `packages/shared` нет, завести её там рядом с `criticTypeSchema` (`export const ALL_CRITIC_TYPES = ["canon", "style", "editor", "reader"] as const;`) и использовать в графе критики вместо локального списка — двух копий перечня быть не должно.

- [ ] **Step 7: Обновить schema.ts**

В `apps/server/src/db/schema.ts` в `critiqueReports` заменить CHECK:

```ts
    check(
      "critique_status_check",
      sql`${t.status} IN ('pending','done','partial','error')`,
    ),
```

- [ ] **Step 8: Запустить тесты и миграцию**

Выполнить: `pnpm --filter @book-forge/server test -- src/routes/__tests__/critique.test.ts`
Ожидаемо: PASS.

Выполнить: `pnpm --filter @book-forge/shared test && pnpm --filter @book-forge/server test`
Ожидаемо: PASS.

Выполнить: `pnpm migrate`
Ожидаемо: `✅ migrated`.

- [ ] **Step 9: Коммит**

```bash
git add apps/server/drizzle/0021_critique_partial.sql apps/server/drizzle/meta/_journal.json packages/shared/src/critique.ts apps/server/src/db/schema.ts apps/server/src/routes/critique.ts apps/server/src/routes/__tests__/critique.test.ts
git commit -m "fix(critique): four failures out of four are not a green report

The status compared the number of errors with the length of the successful
reports list, so 4 === 0 was false and the run was called done. It now counts
from the critics that were requested, and a run where some worked and some
failed says so instead of hiding the gap."
```

---

### Task 11: Предпросмотр и принятие в редакторе

До этой задачи автор видит поток и не видит, что с ним делать. Здесь появляется панель: кандидат, список правок, кнопки «Принять», «Принять выбранное», «Отклонить», «Остановить».

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/chapter/ProposalPanel.tsx`
- Create: `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx`
- Modify: `apps/web/src/pages/ChapterPage.tsx`
- Modify: `apps/web/src/components/CritiquePanel.tsx`

**Interfaces:**
- Consumes: маршруты задач 7–9; типы `ProseProposal`, `ProseChange`.
- Produces:
  - `api.getProposal`, `api.getProposalChanges`, `api.acceptProposal`, `api.rejectProposal`, `api.cancelProposal`
  - `WriterStreamHandlers.onProposal?: (proposalId: number) => void`, `onDone` получает `{ proposal, cancelled? }`
  - `<ProposalPanel proposal changes chapter onAccepted onRejected onCancelled />`

- [ ] **Step 1: Написать падающий тест панели**

Создать `apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalPanel } from "../ProposalPanel";
import type { ProseProposal } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    cancelProposal: vi.fn(),
    getProposalChanges: vi.fn(),
  },
}));

import { api } from "@/api/client";

const PROPOSAL: ProseProposal = {
  id: 5,
  bookId: 1,
  chapterId: 2,
  kind: "write",
  status: "ready",
  baseVersionId: 9,
  baseDraftRevision: null,
  contextFingerprint: "fp",
  contentText: "Раз.\n\nВторой.\n\nТри.",
  contentJson: "{}",
  wordCount: 3,
  completion: "confirmed",
  stopReason: "end_turn",
  modelId: "test",
  backend: "anthropic",
  acceptedVersionId: null,
  acceptRequestId: null,
  errorMessage: null,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:01:00.000Z",
};

const CHANGES = [
  { id: "c0", kind: "replace" as const, baseFrom: 1, baseTo: 2, baseText: ["Два."], candidateText: ["Второй."] },
  { id: "c1", kind: "insert" as const, baseFrom: 3, baseTo: 3, baseText: [], candidateText: ["Четыре."] },
];

function renderPanel(overrides: Partial<ProseProposal> = {}) {
  const onAccepted = vi.fn();
  const onRejected = vi.fn();
  render(
    <ProposalPanel
      proposal={{ ...PROPOSAL, ...overrides }}
      changes={CHANGES}
      expectedVersionId={9}
      expectedDraftRevision={null}
      onAccepted={onAccepted}
      onRejected={onRejected}
    />,
  );
  return { onAccepted, onRejected };
}

beforeEach(() => {
  vi.mocked(api.acceptProposal).mockReset();
  vi.mocked(api.rejectProposal).mockReset();
  vi.mocked(api.acceptProposal).mockResolvedValue({
    version: { id: 12 },
    replayed: false,
  } as never);
});

describe("ProposalPanel", () => {
  it("говорит, что глава ещё не изменена", () => {
    renderPanel();
    expect(screen.getByText(/не изменена, пока вы не примете/i)).toBeInTheDocument();
  });

  it("принимает кандидата целиком", async () => {
    const { onAccepted } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(api.acceptProposal).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ expectedVersionId: 9, expectedDraftRevision: null }),
    );
    expect(vi.mocked(api.acceptProposal).mock.calls[0]?.[1]).not.toHaveProperty(
      "selectedChangeIds",
    );
    expect(onAccepted).toHaveBeenCalled();
  });

  it("принимает только отмеченные правки", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("checkbox", { name: /Второй\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Принять выбранное" }));
    expect(api.acceptProposal).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ selectedChangeIds: ["c0"] }),
    );
  });

  it("«Принять выбранное» недоступно, пока ничего не выбрано", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Принять выбранное" })).toBeDisabled();
  });

  it("повторный клик по «Принять целиком» шлёт тот же requestId", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(new Error("сеть"));
    renderPanel();
    const button = screen.getByRole("button", { name: "Принять целиком" });
    await userEvent.click(button);
    await userEvent.click(button);
    const calls = vi.mocked(api.acceptProposal).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1].requestId).toBe(calls[1]?.[1].requestId);
  });

  it("незавершённый кандидат помечен и требует подтверждения", async () => {
    renderPanel({ status: "incomplete", completion: "unconfirmed", stopReason: "max_tokens" });
    expect(screen.getByText(/завершение не подтверждено/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(vi.mocked(api.acceptProposal).mock.calls[0]?.[1].acknowledgeStale).toBe(true);
  });

  it("конфликт версии объясняется словами, а не кодом 409", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(
      Object.assign(new Error("HTTP 409"), { status: 409 }),
    );
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(await screen.findByText(/текст главы изменился/i)).toBeInTheDocument();
  });

  it("отклонение зовёт маршрут отклонения", async () => {
    const { onRejected } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    expect(api.rejectProposal).toHaveBeenCalledWith(5);
    expect(onRejected).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/ProposalPanel.test.tsx`
Ожидаемо: FAIL, `Failed to resolve import "../ProposalPanel"`.

- [ ] **Step 3: Добавить функции в клиент**

В `apps/web/src/api/client.ts` в объект `api` дописать рядом с группой критики:

```ts
  // ── Предложения прозы ──
  getProposal: (id: number) =>
    req<import("@book-forge/shared").ProseProposal>(`/api/prose-proposals/${id}`),
  getProposalChanges: (id: number) =>
    req<{
      baseVersionId: number | null;
      changes: import("@book-forge/shared").ProseChange[];
    }>(`/api/prose-proposals/${id}/changes`),
  acceptProposal: (
    id: number,
    body: import("@book-forge/shared").AcceptProseProposalInput,
  ) =>
    req<{ version: ChapterVersion; replayed: boolean }>(
      `/api/prose-proposals/${id}/accept`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  rejectProposal: (id: number) =>
    req<import("@book-forge/shared").ProseProposal>(
      `/api/prose-proposals/${id}/reject`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  cancelProposal: (id: number) =>
    req<{ stopping: boolean }>(`/api/prose-proposals/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listProposals: (chapterId: number) =>
    req<import("@book-forge/shared").ProseProposal[]>(
      `/api/chapters/${chapterId}/proposals`,
    ),
```

В `WriterStreamHandlers` и `RepairStreamHandlers` заменить полезную нагрузку завершения и добавить обработчик начала:

```ts
  onProposal?: (proposalId: number) => void;
  onDone: (payload: {
    proposal: import("@book-forge/shared").ProseProposal;
    cancelled?: boolean;
    tokens?: { input: number; output: number };
  }) => void;
```

и в разборе событий обоих потоков добавить ветку до `chunk`:

```ts
          if (ev === "proposal") handlers.onProposal?.(data.proposalId as number);
          else if (ev === "chunk") handlers.onChunk(data.text as string);
```

- [ ] **Step 4: Написать панель**

Создать `apps/web/src/components/chapter/ProposalPanel.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { ProseChange, ProseProposal } from "@book-forge/shared";

interface Props {
  proposal: ProseProposal;
  changes: ProseChange[];
  /** Что вкладка считает текущей версией и ревизией черновика: сервер сверит
   *  это со своим состоянием и откажет, если автор смотрит на устаревшее. */
  expectedVersionId: number | null;
  expectedDraftRevision: number | null;
  onAccepted: (versionId: number) => void | Promise<void>;
  onRejected: () => void | Promise<void>;
}

const CHANGE_LABEL: Record<ProseChange["kind"], string> = {
  replace: "Переписано",
  insert: "Добавлено",
  delete: "Убрано",
};

export function ProposalPanel({
  proposal,
  changes,
  expectedVersionId,
  expectedDraftRevision,
  onAccepted,
  onRejected,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Один ключ на жизнь панели: повтор после сетевого сбоя обязан быть повтором
  // того же принятия, а не вторым принятием.
  const requestIdRef = useRef(
    `accept-${proposal.id}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const unconfirmed = proposal.completion === "unconfirmed";
  const paragraphs = useMemo(
    () => proposal.contentText.split(/\n\s*\n/).filter((p) => p.trim().length > 0),
    [proposal.contentText],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function accept(selectedChangeIds?: string[]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptProposal(proposal.id, {
        requestId: requestIdRef.current,
        expectedVersionId,
        expectedDraftRevision,
        acknowledgeStale: unconfirmed,
        ...(selectedChangeIds ? { selectedChangeIds } : {}),
      });
      await onAccepted(result.version.id);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 409
          ? "Текст главы изменился, пока шла генерация. Перечитайте главу и примите ещё раз."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.rejectProposal(proposal.id);
      await onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div className="caption">
        {proposal.kind === "write" ? "Черновик главы" : "Исправленный текст"} ·{" "}
        {proposal.wordCount} слов
      </div>
      <p className="text-sm">
        Глава не изменена, пока вы не примете этот текст.
      </p>
      {unconfirmed && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          Завершение не подтверждено
          {proposal.stopReason === "max_tokens"
            ? ": модель упёрлась в предел длины ответа."
            : ": модель не сообщила, дописала ли она до конца."}{" "}
          Текст можно посмотреть и принять, но проверьте конец главы.
        </p>
      )}

      <div style={{ maxHeight: 320, overflow: "auto" }}>
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm" style={{ marginBottom: 8 }}>
            {p}
          </p>
        ))}
      </div>

      {changes.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="caption">Что меняется</div>
          {changes.map((ch) => (
            <label key={ch.id} className="text-sm" style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={selected.has(ch.id)}
                onChange={() => toggle(ch.id)}
                disabled={busy}
                aria-label={`${CHANGE_LABEL[ch.kind]}: ${
                  ch.candidateText.join(" ") || ch.baseText.join(" ")
                }`}
              />
              <span>
                <strong>{CHANGE_LABEL[ch.kind]}. </strong>
                {ch.baseText.length > 0 && (
                  <s style={{ opacity: 0.7 }}>{ch.baseText.join(" ")}</s>
                )}{" "}
                {ch.candidateText.join(" ")}
              </span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--color-ink-red-fg)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => void accept()} disabled={busy}>
          Принять целиком
        </Button>
        <Button
          variant="secondary"
          onClick={() => void accept([...selected])}
          disabled={busy || selected.size === 0}
        >
          Принять выбранное
        </Button>
        <Button variant="destructive" onClick={() => void reject()} disabled={busy}>
          Отклонить
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Подключить панель к странице главы**

В `apps/web/src/pages/ChapterPage.tsx`:

добавить состояние рядом с `writerBuffer`:

```tsx
  const [proposal, setProposal] = useState<ProseProposal | null>(null);
  const [proposalChanges, setProposalChanges] = useState<ProseChange[]>([]);
  const [runningProposalId, setRunningProposalId] = useState<number | null>(null);
```

в `onRunWriter` добавить обработчик начала и заменить `onDone`:

```tsx
            onProposal: (proposalId) => setRunningProposalId(proposalId),
            onDone: async (payload) => {
              setWriting(false);
              writerAbortRef.current = null;
              setRunningProposalId(null);
              if (payload.cancelled) {
                toast.info("Генерация остановлена");
                return;
              }
              setProposal(payload.proposal);
              const { changes } = await api.getProposalChanges(payload.proposal.id);
              setProposalChanges(changes);
              // Глава намеренно не перезагружается: текущая версия не менялась,
              // а load() затёр бы несохранённые правки автора.
            },
```

заменить `onCancelWriter` на остановку по серверу с прежним прерыванием запроса как запасным:

```tsx
  function onCancelWriter() {
    if (runningProposalId !== null) {
      void api.cancelProposal(runningProposalId).catch(() => undefined);
    }
    writerAbortRef.current?.abort();
    writerAbortRef.current = null;
  }
```

в разметку под блоком потока добавить панель:

```tsx
            {proposal && (
              <ProposalPanel
                proposal={proposal}
                changes={proposalChanges}
                expectedVersionId={chapter?.currentVersionId ?? null}
                expectedDraftRevision={chapter?.draft?.revision ?? null}
                onAccepted={async () => {
                  setProposal(null);
                  setProposalChanges([]);
                  setWriterBuffer("");
                  setCanonRunningSignal((s) => s + 1);
                  await load();
                  toast.success("Глава принята");
                }}
                onRejected={() => {
                  setProposal(null);
                  setProposalChanges([]);
                  setWriterBuffer("");
                }}
              />
            )}
```

Импортировать `ProposalPanel`, типы `ProseProposal`, `ProseChange` и убедиться, что `ChapterWithMemory` в клиенте несёт `draft.revision` (добавлено в задаче 3).

- [ ] **Step 6: Подключить панель к правке**

В `apps/web/src/components/CritiquePanel.tsx` в `onRepair` заменить `onDone`:

```tsx
          onProposal: (proposalId) => setRepairProposalId(proposalId),
          onDone: async (payload) => {
            setRepairing(false);
            setRepairProposal(payload.proposal);
          },
```

и отрисовать ту же `ProposalPanel` под потоком правки, передав `onAccepted`, который зовёт существующий `onRepairDone`. Состояния `repairProposal` и `repairProposalId` завести рядом с `repairBuffer`.

- [ ] **Step 7: Запустить тесты**

Выполнить: `pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/ProposalPanel.test.tsx`
Ожидаемо: PASS, 8 тестов.

Выполнить: `pnpm --filter @book-forge/web test`
Ожидаемо: PASS. Тесты `ChapterPage`, ожидавшие перезагрузку главы после генерации, привести к новому поведению.

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0.

- [ ] **Step 8: Коммит**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/chapter/ProposalPanel.tsx apps/web/src/components/chapter/__tests__/ProposalPanel.test.tsx apps/web/src/pages/ChapterPage.tsx apps/web/src/components/CritiquePanel.tsx
git commit -m "feat(web): read the candidate, then decide

The page no longer reloads the chapter when generation finishes — reloading is
what used to overwrite the author's unsaved edits. The accept request carries
what the tab believes about the version and the draft revision, and one
requestId lives for the life of the panel so a retry after a network failure
is a retry, not a second acceptance."
```

---

### Task 12: Документация и полный прогон

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-05-character-individuality.md` (отметка о выполненном этапе)

- [ ] **Step 1: Описать новый жизненный цикл в CLAUDE.md**

В `CLAUDE.md` после абзаца «Приём материала» добавить:

```markdown
**Предложения прозы (2026-09-05, этап 1 индивидуальности персонажей):** генерация главы (`POST /chapters/:id/write`) и правка (`POST /chapter-versions/:id/repair`) больше не коммитят результат. Обе создают строку в `prose_proposals` **до первого токена** (`status: "streaming"`) и шлют её id событием `proposal`; по завершении кандидат получает `ready` или `incomplete`. `incomplete` — это не ошибка, а честный ответ: `stop_reason` читается только на прямом API, бэкенд подписки его не сообщает вовсе, поэтому `isConfirmedCompletion(null)` — `false`, и такой кандидат принимается только осознанно. Версия создаётся единственным местом — `acceptProposal` ([utils/prose-proposals.ts](apps/server/src/utils/prose-proposals.ts)): одна транзакция, в ней вставка версии, `enqueueMemoryJobs(COMMIT_JOB_KINDS)`, `markMemoryStaleOnCommit` и удаление черновика. До принятия ни `current_version_id`, ни память, ни `chapter_drafts` не трогаются — `DELETE FROM chapter_drafts` из маршрутов генерации и правки убран. Принятие сверяется с ожиданиями **клиента** (`expectedVersionId`, `expectedDraftRevision`), а не с базой предложения: автор мог осознанно перечитать изменившуюся главу. Несовпадение — 409 `proposal_conflict` с `details.reason` (`version`/`draft`/`status`/`stale`), кандидат при этом цел, правки автора целы. Повтор с тем же `requestId` возвращает ту же версию (уникальный индекс по `accept_request_id`). Частичное принятие: сравнение по абзацам ([prose-diff.ts](packages/shared/src/prose-diff.ts), LCS, куски не пересекаются по построению), выбранное подмножество применяет сервер, память ставится на итоговую версию, а не на полного кандидата. Отмена — `POST /prose-proposals/:id/cancel`: сперва статус `cancelled` в базе, затем сигнал; прервать вызов подписки нечем, поэтому есть второй рубеж — перед записью результата раннер смотрит реестр и молча выбрасывает поздний ответ. Ревизия `chapter_drafts.revision` растёт на каждый автосейв; `NULL` в `base_draft_revision` значит «черновика не было вовсе» и отличается от ревизии 0. Статус критики считается от числа **запрошенных** критиков: `error` — не выжил никто, `partial` — часть, `done` — все; прежняя формула сравнивала число ошибок с длиной списка успешных и на четырёх падениях из четырёх рисовала зелёный отчёт.
```

- [ ] **Step 2: Отметить этап в спецификации**

В `docs/superpowers/specs/2026-09-05-character-individuality.md` в таблицу раздела 18 в строку этапа 1 дописать: `Выполнено 2026-09-__, план: docs/superpowers/plans/2026-09-05-character-stage-1-safe-saving.md`.

- [ ] **Step 3: Полный прогон**

Выполнить: `pnpm typecheck`
Ожидаемо: код возврата 0.

Выполнить: `pnpm test`
Ожидаемо: все пакеты зелёные.

Выполнить: `pnpm build`
Ожидаемо: код возврата 0.

- [ ] **Step 4: Проверить миграцию на копии рабочей базы**

```bash
cp data/db.sqlite /tmp/stage1-check.sqlite
DB_PATH=/tmp/stage1-check.sqlite pnpm migrate
```

Ожидаемо: `✅ migrated`. Затем убедиться, что данные на месте:

```bash
node -e "const D=require('better-sqlite3');const d=new D('/tmp/stage1-check.sqlite',{readonly:true});for(const t of ['books','chapters','chapter_versions','chapter_drafts','characters','critique_reports','prose_proposals'])console.log(t, d.prepare('SELECT COUNT(*) c FROM '+t).get().c);"
```

Ожидаемо: счётчики книг, глав, версий и персонажей совпадают с тем, что было до миграции; `prose_proposals` пуста; `critique_reports` сохранила все строки после перестройки таблицы.

- [ ] **Step 5: Коммит**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-05-character-individuality.md
git commit -m "docs: the prose proposal lifecycle"
```

---

## Карта соответствия критериям

| Критерий | Где проверяется |
|---|---|
| AC-16 | `write-proposal.test.ts` («не трогает текущую версию», «не ставит заданий памяти»), `proposals.test.ts` («отклонение не создаёт версию») |
| AC-17 | `prose-proposals.test.ts` («появившийся черновик отклоняет принятие», «устаревшее ожидание версии»), `proposals.test.ts` (409 с `reason: version`) |
| AC-18 | `proposals.test.ts` («принимает только выбранную правку, а память берёт из итога») |
| AC-19 | `prose-proposals.test.ts` («повтор с тем же requestId»), `proposals.test.ts` (повтор через HTTP) |
| AC-20 | `write-proposal.test.ts` («отменённое предложение не переходит в ready поздним ответом»), `prose-proposals.test.ts` («незавершённого кандидата нельзя принять») |
| AC-27 | `critique.test.ts` («все критики упали — статус error», «считается от числа запрошенных») |
| AC-37 | `write-proposal.test.ts` («бэкенд без причины остановки», «лимит вывода»), `ProposalPanel.test.tsx` («незавершённый кандидат помечен») |
| INV-06 | `prose-proposals.test.ts` (правка автора цела после неудачного принятия), задача 11 (страница не перезагружает главу) |
| INV-11 | `acceptProposal` сверяет `book_id` главы и предложения |

Что этот этап **не** закрывает и не должен: AC-30 (чужая книга в запросе) проверяется целиком на этапе 2 вместе с ревизиями сущностей; здесь есть только проверка принадлежности внутри принятия.

## Самопроверка плана

- **Покрытие спецификации.** Раздел 11 разобран по пунктам: 1 — задачи 3 и 5, 2 — задачи 5 и 11, 3 — задача 5, 4 — задачи 8 и 9, 5 — задача 8, 6 — задача 8. Требование монотонной ревизии черновика — задача 3, защита зависимостей контекста — отпечаток в задачах 5 и 8, идемпотентность — задача 8, отмена — задача 7, проверка причины завершения — задачи 4 и 5. Требование «интерфейс не обещает лимитов, которых бэкенд не применяет» выполняется тем, что `incomplete` показывается словами (задача 11).
- **Заглушек нет.** Каждый шаг несёт настоящий код или настоящую команду.
- **Согласованность имён.** `ProseChange`, `diffProseBlocks`, `applyProseChanges`, `docToBlocks`, `blocksToDoc` из задачи 1 используются под теми же именами в задачах 8, 9 и 11. `createProposal`, `finishProposal`, `loadProposal`, `listProposals`, `acceptProposal`, `rejectProposal`, `contextFingerprint`, `ProposalConflictError` объявлены в задачах 5 и 8 и вызываются под теми же именами в задачах 6, 7, 8, 9. `isConfirmedCompletion` объявлена в задаче 4 и вызывается в задачах 5 и 6. Поля `expectedVersionId`, `expectedDraftRevision`, `selectedChangeIds`, `acknowledgeStale`, `requestId` совпадают между схемой (задача 2), сервером (задача 8) и клиентом (задача 11).
- **Известный риск.** Задача 4 меняет обязательное поле общего типа `StreamCallResult`; список мест, которые придётся дополнить, даёт компилятор, и шаг 5 этой задачи прямо на него опирается вместо угадывания.
