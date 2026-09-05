import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { IntakePanel } from "../IntakePanel";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { intake: vi.fn(), intakeStream: vi.fn(), cancelIntake: vi.fn() },
}));
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

/** A promise this test resolves on its own schedule, instead of a same-tick
 *  `setTimeout(0)` racing against `waitFor`'s own internal timers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    renderPanel();
    drop([file("Карта.md", "Барьер делит два мира.")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalledTimes(1));
    expect(m.intakeStream.mock.calls[0]![0]).toBe(3);
    expect(m.intakeStream.mock.calls[0]![1]).toEqual([
      { filename: "Карта.md", content: "Барьер делит два мира." },
    ]);
  });

  it("shows the summary afterwards and tells the page to reload", async () => {
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    const onIntake = renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByText("Материалы разобраны")).toBeInTheDocument());
    expect(onIntake).toHaveBeenCalled();
    expect(screen.queryByLabelText("Перетащите файлы с материалами")).toBeNull();
  });

  it("returns to the drop zone when the summary is dismissed", async () => {
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => screen.getByText("Материалы разобраны"));
    fireEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("surfaces a failed request and keeps the drop zone", async () => {
    m.intakeStream.mockRejectedValue(new Error("offline"));
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    expect(screen.getByLabelText("Перетащите файлы с материалами")).toBeInTheDocument();
  });

  it("keeps the files it could read when one of them fails to read", async () => {
    // Promise.all rejected the whole batch on one unreadable file and the
    // author lost the drop. The server's whole idiom is per-file failure.
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    renderPanel();
    const bad = file("Битый.md", "");
    vi.spyOn(bad, "text").mockRejectedValue(new Error("файл недоступен"));
    drop([file("Карта.md", "Барьер делит два мира."), bad]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalledTimes(1));
    expect(m.intakeStream.mock.calls[0]![1]).toEqual([
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
    expect(m.intakeStream).not.toHaveBeenCalled();
  });

  it("sends a .docx as base64 rather than as text", async () => {
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    renderPanel();
    const docx = new File([new Uint8Array([80, 75, 3, 4])], "черновик.docx");
    drop([docx]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalledTimes(1));
    const sent = m.intakeStream.mock.calls[0]![1][0] as { filename: string; contentBase64?: string };
    expect(sent.filename).toBe("черновик.docx");
    expect(typeof sent.contentBase64).toBe("string");
  });

  // Regression guard: btoa(String.fromCharCode(...new Uint8Array(buf))) spreads
  // every byte as its own function argument, which throws "Maximum call stack
  // size exceeded" well before a file gets this big (the limit is on the order
  // of 100 KB of arguments) — this payload is deliberately past that ceiling.
  it("base64-encodes a .docx well past the argument-spread call-stack limit", async () => {
    m.intakeStream.mockResolvedValue({ ...OK, cancelled: false } as never);
    renderPanel();
    const size = 300_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const docx = new File([bytes], "большой.docx");
    drop([docx]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalledTimes(1));
    const sent = m.intakeStream.mock.calls[0]![1][0] as { filename: string; contentBase64?: string };
    expect(sent.filename).toBe("большой.docx");
    expect(typeof sent.contentBase64).toBe("string");
    const decoded = atob(sent.contentBase64!);
    expect(decoded.length).toBe(size);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(255)).toBe(255);
    expect(decoded.charCodeAt(size - 1)).toBe((size - 1) % 256);
  });

  it("shows live progress while the stream runs and the summary when it ends", async () => {
    let emit!: (e: { index: number; total: number; filename: string; status: string }) => void;
    const stream = deferred<typeof OK & { cancelled: boolean }>();
    m.intakeStream.mockImplementation(
      ((_id: number, _files: unknown, h: { onFile?: (e: unknown) => void }) => {
        emit = h.onFile!;
        return stream.promise;
      }) as never,
    );
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalled());
    act(() => emit({ index: 0, total: 1, filename: "Карта.md", status: "started" }));
    expect(await screen.findByText("Карта.md")).toBeInTheDocument();
    // The stream hasn't resolved yet — the row must still be the only thing
    // on screen, not a summary that got there some other way.
    expect(screen.queryByText("Материалы разобраны")).toBeNull();
    act(() => stream.resolve({ ...OK, cancelled: false }));
    await waitFor(() => screen.getByText("Материалы разобраны"));
  });

  it("asks the server to stop and reports it stopped", async () => {
    let begin!: (e: { requestKey: string; total: number }) => void;
    const stream = deferred<typeof OK & { cancelled: boolean }>();
    m.intakeStream.mockImplementation(
      ((_id: number, _f: unknown, h: { onBegin?: (e: unknown) => void }) => {
        begin = h.onBegin!;
        return stream.promise;
      }) as never,
    );
    m.cancelIntake.mockResolvedValue(undefined as never);
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalled());
    act(() => begin({ requestKey: "k1", total: 1 }));
    await userEvent.click(await screen.findByRole("button", { name: /Остановить/ }));
    expect(m.cancelIntake).toHaveBeenCalledWith(3, "k1");
    act(() => stream.resolve({ ...OK, cancelled: true }));
    await waitFor(() => expect(screen.getByText(/Разбор остановлен/)).toBeInTheDocument());
  });

  it("does not offer a working stop button before the run has a key", async () => {
    // До события `begin` останавливать нечего: раньше кнопка была живой и
    // молча ничего не делала — автор жал её и не понимал, почему разбор идёт.
    let begin!: (e: { requestKey: string; total: number }) => void;
    const stream = deferred<typeof OK & { cancelled: boolean }>();
    m.intakeStream.mockImplementation(
      ((_id: number, _f: unknown, h: { onBegin?: (e: unknown) => void }) => {
        begin = h.onBegin!;
        return stream.promise;
      }) as never,
    );
    renderPanel();
    drop([file("Карта.md", "текст")]);
    const button = await screen.findByRole("button", { name: /Остановить/ });
    expect(button).toBeDisabled();

    act(() => begin({ requestKey: "k1", total: 1 }));
    expect(screen.getByRole("button", { name: /Остановить/ })).not.toBeDisabled();
    act(() => stream.resolve({ ...OK, cancelled: false }));
    await waitFor(() => screen.getByText("Материалы разобраны"));
  });

  it("lets the author retry after a failed stop request", async () => {
    let begin!: (e: { requestKey: string; total: number }) => void;
    const stream = deferred<typeof OK & { cancelled: boolean }>();
    m.intakeStream.mockImplementation(
      ((_id: number, _f: unknown, h: { onBegin?: (e: unknown) => void }) => {
        begin = h.onBegin!;
        return stream.promise;
      }) as never,
    );
    m.cancelIntake.mockRejectedValueOnce(new Error("offline"));
    renderPanel();
    drop([file("Карта.md", "текст")]);
    await waitFor(() => expect(m.intakeStream).toHaveBeenCalled());
    act(() => begin({ requestKey: "k1", total: 1 }));

    await userEvent.click(await screen.findByRole("button", { name: /Остановить/ }));
    // The failed request must not leave the button stuck on "stopping": the
    // author needs a way to try again, and to know the first click did
    // nothing.
    const retryButton = await screen.findByRole("button", { name: /Остановить/ });
    expect(retryButton).not.toBeDisabled();
    expect(screen.getByText(/не удалось/i)).toBeInTheDocument();

    m.cancelIntake.mockResolvedValueOnce(undefined as never);
    await userEvent.click(retryButton);
    expect(m.cancelIntake).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Останавливаем/ })).toBeDisabled();

    act(() => stream.resolve({ ...OK, cancelled: true }));
    await waitFor(() => expect(screen.getByText(/Разбор остановлен/)).toBeInTheDocument());
  });
});
