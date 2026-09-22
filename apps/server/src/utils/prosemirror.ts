interface PMNode {
  type?: string;
  text?: string;
  content?: PMNode[];
}

/** Документ ProseMirror → плоский текст с сохранёнными абзацами (F10 ревью
 *  2026-09-22). Прежде все текстовые узлы склеивались через пробел, и глава
 *  становилась одной строкой: экспорт терял абзацы, доля диалога и абзацы-
 *  удары считались по другому тексту, чанкер получал один огромный абзац.
 *
 *  Блоки разделяются пустой строкой — той же, что понимает
 *  `prosePlainTextToProseMirror`. Внутри блока текстовые узлы склеиваются
 *  встык: слово с жирной серединой — это три узла, и пробел между ними
 *  разрывал бы слово. Мягкий перенос (`hardBreak`) — перевод строки. */
export function extractText(node: unknown): string {
  return blockText(node as PMNode).trim();
}

function isInline(n: PMNode): boolean {
  return typeof n.text === "string" || n.type === "hardBreak";
}

function blockText(node: PMNode | undefined): string {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const children = node.content;
  if (children.every(isInline)) return children.map(blockText).join("");
  return children
    .map((c) => blockText(c).trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Проза с абзацами через пустую строку → документ ProseMirror. Одна копия:
 *  раньше их было две, в маршрутах Писателя и правки. */
export function prosePlainTextToProseMirror(text: string): unknown {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return {
    type: "doc",
    content:
      paragraphs.length === 0
        ? [{ type: "paragraph" }]
        : paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}
