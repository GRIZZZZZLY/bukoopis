import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseEpub } from "../parsers.js";

/** F20 ревью 2026-09-22: OPF разбирался парсером без атрибутов, spine был
 *  пуст, и главы шли в алфавитном порядке имён файлов. */

const xhtml = (body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>${body}</p></body></html>`;

describe("parseEpub — порядок spine", () => {
  it("читает главы в порядке spine, а не имён файлов", async () => {
    const zip = new JSZip();
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf">
        <manifest>
          <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
          <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="b"/><itemref idref="a"/></spine>
      </package>`,
    );
    zip.file("OEBPS/a.xhtml", xhtml("SECOND_IN_SPINE"));
    zip.file("OEBPS/b.xhtml", xhtml("FIRST_IN_SPINE"));
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const { text } = await parseEpub(buf);
    expect(text.indexOf("FIRST_IN_SPINE")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("FIRST_IN_SPINE")).toBeLessThan(text.indexOf("SECOND_IN_SPINE"));
  });
});
