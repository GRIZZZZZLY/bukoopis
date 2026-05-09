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
