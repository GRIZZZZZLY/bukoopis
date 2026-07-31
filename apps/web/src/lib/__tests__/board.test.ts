import { describe, it, expect } from "vitest";
import {
  boardColumns,
  boardHeight,
  boardWidth,
  BOARD_PAD,
  COLUMN_W,
  HEADER_H,
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
  it("columns are unique values from introduced and resolved chapters, sorted", () => {
    // note 3 resolves in chapter 5, which has no notes of its own introduced
    // there — it must still get a column (Fix 3).
    expect(boardColumns([note(1, 3), note(2, 1), note(3, 3, 5)])).toEqual([1, 3, 5]);
  });

  it("empty board has no columns and zero height", () => {
    expect(boardColumns([])).toEqual([]);
    expect(layoutNotes([])).toEqual([]);
    expect(boardHeight([])).toBe(0);
  });

  it("stacks notes of the same chapter into rows of one column, inset by BOARD_PAD/HEADER_H", () => {
    const placed = layoutNotes([note(1, 1), note(2, 1), note(3, 2)]);
    expect(placed.map((p) => [p.col, p.row])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(placed[0]!.x).toBe(BOARD_PAD);
    expect(placed[0]!.y).toBe(BOARD_PAD + HEADER_H);
    expect(placed[1]!.y).toBe(BOARD_PAD + HEADER_H + ROW_H);
    expect(placed[2]!.x).toBe(BOARD_PAD + COLUMN_W);
  });

  it("thread of a resolved note ends at the resolving column", () => {
    const notes = [note(1, 1, 3), note(2, 3)];
    const cols = boardColumns(notes);            // [1, 3]
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(false);
    expect(span.x2).toBeGreaterThan(span.x1);
    expect(span.x2).toBe(BOARD_PAD + COLUMN_W * 1 + COLUMN_W / 2);
  });

  it("open thread runs to the board edge", () => {
    const notes = [note(1, 1), note(2, 2)];
    const cols = boardColumns(notes);
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(true);
    expect(span.x2).toBe(boardWidth(cols));
  });

  it("a chapter that only resolves a note (no notes introduced there) still gets a column, so the thread is closed, not open", () => {
    const notes = [note(1, 1, 5)]; // resolved in chapter 5, which has zero notes
    const cols = boardColumns(notes);
    expect(cols).toEqual([1, 5]);
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(false);
    expect(span.x2).toBe(BOARD_PAD + COLUMN_W * 1 + COLUMN_W / 2);
  });

  it("an unresolved note (resolved === null) stays open", () => {
    const notes = [note(1, 1)];
    const cols = boardColumns(notes);
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(true);
    expect(span.x2).toBe(boardWidth(cols));
  });

  it("board size grows with columns and tallest stack", () => {
    const notes = [note(1, 1), note(2, 1), note(3, 5)];
    expect(boardWidth(boardColumns(notes))).toBe(BOARD_PAD * 2 + COLUMN_W * 2);
    expect(boardHeight(layoutNotes(notes))).toBe(BOARD_PAD * 2 + HEADER_H + ROW_H * 2);
  });
});
