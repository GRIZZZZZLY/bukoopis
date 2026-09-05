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

  it("keeps a manual line break as a separator between runs", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Привет</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>мир</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await docxToPlainText(bytes)).toBe("Привет\nмир");
  });

  it("keeps a tab as a separator between runs", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Имя</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Фамилия</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await docxToPlainText(bytes)).toBe("Имя\tФамилия");
  });

  it("also handles the paired <w:br></w:br> and <w:tab></w:tab> forms", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>А</w:t></w:r><w:r><w:br></w:br></w:r><w:r><w:t>Б</w:t></w:r><w:r><w:tab></w:tab></w:r><w:r><w:t>В</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await docxToPlainText(bytes)).toBe("А\nБ\tВ");
  });

  it("treats a <w:br> carrying attributes the same as a bare one", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Раз</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>Два</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await docxToPlainText(bytes)).toBe("Раз\nДва");
  });
});
