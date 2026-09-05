import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DropZone, ACCEPTED_EXTENSIONS } from "../DropZone";

function file(name: string, text = "содержимое"): File {
  return new File([text], name, { type: "text/plain" });
}

function drop(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

/** Минимальный двойник FileSystemEntry: браузер отдаёт папку именно так, и
 *  `readEntries` честно возвращает записи порциями, пока не отдаст пустую. */
interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FakeEntry[]) => void) => void };
}

function fileEntry(f: File): FakeEntry {
  return { isFile: true, isDirectory: false, name: f.name, file: (cb) => cb(f) };
}

function dirEntry(name: string, children: FakeEntry[]): FakeEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // Отдаём по одной записи за вызов — так проще всего поймать реализацию,
      // которая прочитала только первую порцию и остановилась.
      let i = 0;
      return {
        readEntries: (cb) => {
          const next = children[i];
          i += 1;
          cb(next ? [next] : []);
        },
      };
    },
  };
}

function dropEntries(target: Element, entries: FakeEntry[], files: File[] = []) {
  fireEvent.drop(target, {
    dataTransfer: {
      files,
      items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry })),
      types: ["Files"],
    },
  });
}

describe("DropZone", () => {
  it("accepts the extensions the intake can read", () => {
    expect([...ACCEPTED_EXTENSIONS]).toEqual([".md", ".markdown", ".txt", ".docx"]);
  });

  it("hands dropped files up", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md"), file("Связи.md")]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(["Карта.md", "Связи.md"]);
  });

  it("filters out extensions it cannot read and says so", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md"), file("схема.png")]);
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual(["Карта.md"]);
    expect(screen.getByRole("status")).toHaveTextContent("схема.png");
  });

  it("does not call up when nothing usable was dropped", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("схема.png")]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("схема.png");
  });

  it("ignores drops while busy", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={true} />);
    drop(screen.getByLabelText("Перетащите файлы с материалами"), [file("Карта.md")]);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("walks a dropped folder and takes the files inside it", async () => {
    // Папка приходит в `dataTransfer.files` одной непонятной записью, поэтому
    // читать надо `items[].webkitGetAsEntry()` — иначе автору сообщают, что имя
    // его папки «читать пока не умеем».
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    dropEntries(
      screen.getByLabelText("Перетащите файлы с материалами"),
      [dirEntry("Материалы", [fileEntry(file("Карта.md")), fileEntry(file("Связи.md"))])],
      // Именно это лежало бы в `files` при перетаскивании папки.
      [file("Материалы")],
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name).sort()).toEqual([
      "Карта.md",
      "Связи.md",
    ]);
  });

  it("descends into nested folders and skips what it cannot read", async () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    dropEntries(screen.getByLabelText("Перетащите файлы с материалами"), [
      dirEntry("Материалы", [
        fileEntry(file("Карта.md")),
        fileEntry(file("обложка.png")),
        dirEntry("Персонажи", [fileEntry(file("Нейла.txt"))]),
      ]),
    ]);
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name).sort()).toEqual([
      "Карта.md",
      "Нейла.txt",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("обложка.png");
  });

  it("still takes loose files dropped alongside a folder", async () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} busy={false} />);
    dropEntries(screen.getByLabelText("Перетащите файлы с материалами"), [
      fileEntry(file("Заметка.md")),
      dirEntry("Материалы", [fileEntry(file("Карта.md"))]),
    ]);
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name).sort()).toEqual([
      "Заметка.md",
      "Карта.md",
    ]);
  });

  it("offers a way to pick a whole folder from the dialog", () => {
    render(<DropZone onFiles={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: /папку/i })).toBeInTheDocument();
    const dirInput = document.querySelector("input[webkitdirectory]");
    expect(dirInput).not.toBeNull();
  });
});
