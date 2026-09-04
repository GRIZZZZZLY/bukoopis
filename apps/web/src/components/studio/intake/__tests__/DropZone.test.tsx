import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropZone, ACCEPTED_EXTENSIONS } from "../DropZone";

function file(name: string, text = "содержимое"): File {
  return new File([text], name, { type: "text/plain" });
}

function drop(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
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
});
