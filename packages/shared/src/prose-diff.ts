/** Сравнение прозы по абзацам: единица выбора для автора — абзац или реплика,
 *  а не буква. Посимвольный diff по всей главе дал бы автору выбор, которым
 *  невозможно пользоваться, и слияние, которое невозможно проверить глазами.
 *
 *  Функции здесь чистые: сервер применяет выбранное подмножество (принимает
 *  сервер, а не вкладка), веб теми же данными рисует выбор. */

import { mentionsEntityName } from "./entity-names.js";

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

/** Те же верхнеуровневые узлы, но как узлы: жирное начертание, заголовок и
 *  пункт списка живут в них, а в строке от `docToBlocks` — нет. Сравнение
 *  по-прежнему идёт по строкам (автор выбирает абзацы), а слияние — по узлам,
 *  иначе принятие одной правки переписывало бы всю главу голыми абзацами. */
export function docToNodes(doc: unknown): unknown[] {
  if (typeof doc !== "object" || doc === null) return [];
  const content = (doc as ProseMirrorNode).content;
  if (!Array.isArray(content)) return [];
  return [...content];
}

export function nodesToBlocks(nodes: readonly unknown[]): string[] {
  return nodes.map(nodeText);
}

export function nodesToDoc(nodes: readonly unknown[]): unknown {
  if (nodes.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return { type: "doc", content: [...nodes] };
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

/** С какого индекса в кандидате начинается текст каждой правки. `ProseChange`
 *  хранит только координаты базы, но правки идут по порядку и не пересекаются,
 *  а между ними блоки совпадают один к одному — этого хватает, чтобы пройти
 *  оба массива разом и восстановить индексы кандидата. Считается по ПОЛНОМУ
 *  списку правок: по одной выбранной восстановить нельзя. */
function candidateOffsets(changes: readonly ProseChange[]): Map<string, number> {
  const ordered = [...changes].sort(
    (a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo,
  );
  const offsets = new Map<string, number>();
  let baseCursor = 0;
  let candCursor = 0;
  for (const ch of ordered) {
    candCursor += ch.baseFrom - baseCursor;
    offsets.set(ch.id, candCursor);
    candCursor += ch.candidateText.length;
    baseCursor = ch.baseTo;
  }
  return offsets;
}

/** Слияние выбранных правок по узлам. Блок, за который автор не голосовал,
 *  переносится ИСХОДНЫМ узлом — со своим жирным, заголовком и пунктом списка;
 *  принятый берёт узел кандидата. Писатель отдаёт сплошные абзацы, так что
 *  сторона кандидата от этого ничего не теряет.
 *
 *  `changes` — весь список сравнения, `selectedIds` — что выбрал автор. */
export function applyProseChangesToNodes(
  baseNodes: readonly unknown[],
  candidateNodes: readonly unknown[],
  changes: readonly ProseChange[],
  selectedIds: readonly string[],
): unknown[] {
  const byId = new Map(changes.map((ch) => [ch.id, ch]));
  const selected: ProseChange[] = [];
  for (const id of selectedIds) {
    const ch = byId.get(id);
    if (!ch) throw new Error(`unknown change: ${id}`);
    selected.push(ch);
  }
  selected.sort((a, b) => a.baseFrom - b.baseFrom || a.baseTo - b.baseTo);
  const offsets = candidateOffsets(changes);

  const out: unknown[] = [];
  let cursor = 0;
  for (const ch of selected) {
    for (let k = cursor; k < ch.baseFrom; k++) out.push(baseNodes[k]);
    const from = offsets.get(ch.id) ?? 0;
    for (let k = 0; k < ch.candidateText.length; k++) {
      // Узла может не оказаться, если кандидат разобрался иначе, чем
      // считалось сравнение: тогда лучше голый абзац, чем дыра в главе.
      const node = candidateNodes[from + k];
      out.push(node ?? textToParagraph(ch.candidateText[k]!));
    }
    cursor = Math.max(cursor, ch.baseTo);
  }
  for (let k = cursor; k < baseNodes.length; k++) out.push(baseNodes[k]);
  return out;
}

function textToParagraph(text: string): unknown {
  return text === ""
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
}

/** Имена героев, встречавшиеся в убранных или заменённых абзацах базы и не
 *  встречающиеся в кандидате вовсе. Правка «убирает частное ради общего»
 *  (наблюдение авторов, цитируемых Литрабом): герой, названный по имени,
 *  становится «он», и глазами это пропускается. Вставки потерей не считаются. */
export function findLostMentions(
  changes: ProseChange[],
  candidateText: string,
  names: string[],
): string[] {
  const removed = changes
    .filter((c) => c.kind !== "insert")
    .flatMap((c) => c.baseText)
    .join("\n");
  if (removed.trim().length === 0) return [];
  return names.filter(
    (n) =>
      n.trim().length > 0 &&
      mentionsEntityName(removed, n) &&
      !mentionsEntityName(candidateText, n),
  );
}
