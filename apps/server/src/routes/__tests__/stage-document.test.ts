import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const runDocumentMock = vi.fn();
vi.mock("@book-forge/agents/aspects/document", () => ({
  runAspectDocument: (...args: unknown[]) => runDocumentMock(...args),
  toStoredDocumentVariant: () => {
    throw new Error("маршрут не должен строить варианты сам");
  },
}));

import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  runDocumentMock.mockReset();
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Stage document test",
  });
  bookId = r.id;
});
afterEach(() => {
  t.cleanup();
});

describe("POST /books/:id/stages/:stageId/document", () => {
  it("отдаёт разделы и передаёт агенту заметки автора", async () => {
    runDocumentMock.mockResolvedValue({
      sections: [
        {
          name: "география",
          description: "рельеф",
          markdown: "Текст географии, достаточно длинный.",
        },
      ],
    });
    const res = await send(
      t.app,
      `/api/books/${bookId}/stages/world/document`,
      "POST",
      {
        existingSections: [{ name: "власть", text: "Правит совет." }],
        emptySectionNames: ["ремёсла"],
        authorNotes: "Без магии.",
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: Array<{ name: string }>;
      modelId: string;
    };
    expect(body.sections).toHaveLength(1);
    expect(body.modelId).toBeTruthy();
    const arg = runDocumentMock.mock.calls[0]?.[0] as {
      authorNotes?: string;
      existingSections: Array<{ name: string }>;
      emptySectionNames: string[];
    };
    expect(arg.authorNotes).toBe("Без магии.");
    expect(arg.existingSections[0]?.name).toBe("власть");
    expect(arg.emptySectionNames).toEqual(["ремёсла"]);
  });

  it("отказывает этапу, который не документный", async () => {
    const res = await send(
      t.app,
      `/api/books/${bookId}/stages/characters/document`,
      "POST",
      {},
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("stage_not_document");
    expect(runDocumentMock).not.toHaveBeenCalled();
  });

  it("падение агента не роняет запрос молча", async () => {
    runDocumentMock.mockRejectedValue(new Error("модель недоступна"));
    const res = await send(
      t.app,
      `/api/books/${bookId}/stages/world/document`,
      "POST",
      {},
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details: { message: string } };
    expect(body.error).toBe("aspect_document_failed");
    expect(body.details.message).toContain("модель недоступна");
  });

  it("поток отдаёт done с теми же разделами", async () => {
    runDocumentMock.mockResolvedValue({
      sections: [{ name: "вера", description: "во что верят", markdown: "Длинный текст о вере." }],
    });
    const res = await send(
      t.app,
      `/api/books/${bookId}/stages/lore/document-stream`,
      "POST",
      {},
    );
    expect(res.status).toBe(200);
    // SSE надо дочитать: без этого обработчик до вызова агента не доходит и
    // счётчик вызовов лжёт (грабли живого прогона 2026-09-22).
    const text = await res.text();
    expect(text).toContain("event: done");
    expect(text).toContain("вера");
  });
});
