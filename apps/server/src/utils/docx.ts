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

// Text runs (`<w:t>`), manual line breaks (`<w:br/>`, and the paired
// `<w:br>...</w:br>` form Word also emits, either possibly carrying
// attributes like `w:type="page"`) and tabs (`<w:tab/>` / `<w:tab>...
// </w:tab>`) can all sit side by side inside one paragraph. Break and tab
// elements carry no text of their own — skipping them silently fuses the
// runs on either side ("Привет" + "мир" -> "Приветмир") with no error and no
// signal to the author, which is worse than the loss of formatting this
// extraction already accepts elsewhere.
//
// `<w:t` must be followed by whitespace, `/` or `>` — not by any other
// letter — or it also matches the *opening* of `<w:tab>` (since `[^>]*`
// happily eats the "ab"); the lazy `w:t` run then doesn't stop until the
// next real `</w:t>`, swallowing the tab and the run after it as literal text.
const RUN_TOKEN =
  /<w:t(?=[\s/>])[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>|<w:br\b[^>]*>[\s\S]*?<\/w:br>|<w:tab\b[^>]*\/>|<w:tab\b[^>]*>[\s\S]*?<\/w:tab>/g;

function extractParagraphText(chunk: string): string {
  let out = "";
  for (const m of chunk.matchAll(RUN_TOKEN)) {
    if (m[1] !== undefined) {
      out += unescapeXml(m[1]);
    } else if (m[0].startsWith("<w:br")) {
      out += "\n";
    } else if (m[0].startsWith("<w:tab")) {
      out += "\t";
    }
  }
  return out;
}

/** Достаёт текст из .docx без новых зависимостей: .docx — это zip, а весь текст
 *  лежит в word/document.xml. Абзац `w:p` становится строкой, прогоны `w:t`
 *  внутри абзаца склеиваются, а ручной перенос (`w:br`) и табуляция (`w:tab`)
 *  между ними становятся `\n`/`\t`, чтобы соседние прогоны не срастались.
 *  Форматирование намеренно теряется — интейку нужен текст, а не вёрстка. */
export async function docxToPlainText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) {
    throw new Error("not a .docx: word/document.xml is missing");
  }
  const xml = await entry.async("string");
  const paragraphs = xml.split(/<\/w:p>/).map(extractParagraphText);
  return paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n");
}
