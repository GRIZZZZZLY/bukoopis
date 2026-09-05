import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IntakePanel } from "../IntakePanel";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({ api: { intake: vi.fn() } }));
const m = vi.mocked(api);

const OK = {
  summary: [{ target: "world" as const, label: "Мир", count: 1, titles: ["Карта"] }],
  ideaSet: false,
  chapters: [],
  failures: [],
  revision: 2,
};

function file(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByLabelText("Перетащите файлы с материалами"), {
    dataTransfer: { files, types: ["Files"] },
  });
}

function renderPanel() {
  const onIntake = vi.fn();
  render(
    <MemoryRouter>
      <IntakePanel bookId={3} onIntake={onIntake} />
    </MemoryRouter>,
  );
  return onIntake;
}

describe("IntakePanel", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads dropped files to text and sends filename plus content", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "Барьер делит два мира.")]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    expect(m.intake).toHaveBeenCalledWith(3, [
      { filename: "Карта.md", content: "Барьер делит два мира." },
    ]);
  });

  it("shows the summary afterwards and tells the page to reload", async () => {
    m.intake.mockResolvedValue(OK as never);
    const onIntake = renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByText("Материалы разобраны")).toBeInTheDocument());
    expect(onIntake).toHaveBeenCalled();
    expect(screen.queryByLabelText("Перетащите файлы с материалами")).toBeNull();
  });

  it("returns to the drop zone when the summary is dismissed", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => screen.getByText("Материалы разобраны"));
    fireEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("surfaces a failed request and keeps the drop zone", async () => {
    m.intake.mockRejectedValue(new Error("offline"));
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("keeps the files it could read when one of them fails to read", async () => {
    // Promise.all rejected the whole batch on one unreadable file and the
    // author lost the drop. The server's whole idiom is per-file failure.
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    const bad = file("Битый.md", "");
    vi.spyOn(bad, "text").mockRejectedValue(new Error("файл недоступен"));
    drop([file("Карта.md", "Барьер делит два мира."), bad]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    expect(m.intake.mock.calls[0]![1]).toEqual([
      { filename: "Карта.md", content: "Барьер делит два мира." },
    ]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Битый.md"));
  });

  it("does not call the server when not one file could be read", async () => {
    renderPanel();
    const bad = file("Битый.md", "");
    vi.spyOn(bad, "text").mockRejectedValue(new Error("файл недоступен"));
    drop([bad]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Битый.md"));
    expect(m.intake).not.toHaveBeenCalled();
  });

  it("sends a .docx as base64 rather than as text", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    const docx = new File([new Uint8Array([80, 75, 3, 4])], "черновик.docx");
    drop([docx]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    const sent = m.intake.mock.calls[0]![1][0] as { filename: string; contentBase64?: string };
    expect(sent.filename).toBe("черновик.docx");
    expect(typeof sent.contentBase64).toBe("string");
  });

  // Regression guard: btoa(String.fromCharCode(...new Uint8Array(buf))) spreads
  // every byte as its own function argument, which throws "Maximum call stack
  // size exceeded" well before a file gets this big (the limit is on the order
  // of 100 KB of arguments) — this payload is deliberately past that ceiling.
  it("base64-encodes a .docx well past the argument-spread call-stack limit", async () => {
    m.intake.mockResolvedValue(OK as never);
    renderPanel();
    const size = 300_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const docx = new File([bytes], "большой.docx");
    drop([docx]);
    await waitFor(() => expect(m.intake).toHaveBeenCalledTimes(1));
    const sent = m.intake.mock.calls[0]![1][0] as { filename: string; contentBase64?: string };
    expect(sent.filename).toBe("большой.docx");
    expect(typeof sent.contentBase64).toBe("string");
    const decoded = atob(sent.contentBase64!);
    expect(decoded.length).toBe(size);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(255)).toBe(255);
    expect(decoded.charCodeAt(size - 1)).toBe((size - 1) % 256);
  });
});
