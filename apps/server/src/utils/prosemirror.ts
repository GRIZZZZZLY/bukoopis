interface PMNode {
  type?: string;
  text?: string;
  content?: PMNode[];
}

export function extractText(node: unknown): string {
  const parts: string[] = [];
  walk(node as PMNode, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function walk(node: PMNode | undefined, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (typeof node.text === "string") out.push(node.text);
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out);
  }
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
