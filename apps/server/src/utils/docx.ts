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
