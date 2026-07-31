import { describe, it, expect } from "vitest";
import {
  boardColumns,
  boardHeight,
  boardWidth,
  COLUMN_W,
  layoutNotes,
  ROW_H,
  threadSpan,
} from "../board";
import type { BookNote } from "@book-forge/shared";

function note(id: number, introduced: number, resolved: number | null = null): BookNote {
  return {
    id, bookId: 1, kind: "thread", introduced, resolved,
    title: `n${id}`, body: "", tags: [], createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("board geometry", () => {
  it("columns are unique introduced values, sorted", () => {
    expect(boardColumns([note(1, 3), note(2, 1), note(3, 3)])).toEqual([1, 3]);
  });

  it("empty board has no columns and zero height", () => {
    expect(boardColumns([])).toEqual([]);
    expect(layoutNotes([])).toEqual([]);
    expect(boardHeight([])).toBe(0);
  });

  it("stacks notes of the same chapter into rows of one column", () => {
    const placed = layoutNotes([note(1, 1), note(2, 1), note(3, 2)]);
    expect(placed.map((p) => [p.col, p.row])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(placed[0]!.x).toBe(0);
    expect(placed[1]!.y).toBe(ROW_H);
    expect(placed[2]!.x).toBe(COLUMN_W);
  });

  it("thread of a resolved note ends at the resolving column", () => {
    const notes = [note(1, 1, 3), note(2, 3)];
    const cols = boardColumns(notes);            // [1, 3]
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(false);
    expect(span.x2).toBeGreaterThan(span.x1);
    expect(span.x2).toBe(COLUMN_W * 1 + COLUMN_W / 2);
  });

  it("open thread runs to the board edge", () => {
    const notes = [note(1, 1), note(2, 2)];
    const cols = boardColumns(notes);
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(true);
    expect(span.x2).toBe(boardWidth(cols));
  });

  it("thread resolved in an unknown chapter is treated as open", () => {
    const notes = [note(1, 1, 99)];
    const cols = boardColumns(notes);
    expect(threadSpan(notes[0]!, cols).open).toBe(true);
  });

  it("board size grows with columns and tallest stack", () => {
    const notes = [note(1, 1), note(2, 1), note(3, 5)];
    expect(boardWidth(boardColumns(notes))).toBe(COLUMN_W * 2);
    expect(boardHeight(layoutNotes(notes))).toBe(ROW_H * 2);
  });
});
