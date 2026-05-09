import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  studioEventPayloadSchema,
  studioEventTypeSchema,
  emptyBookConcept,
  emptyStudioState,
  assertStudioStateInvariants,
  type BookConcept,
  type StudioEventPayload,
  type StudioEventType,
  type StudioState,
} from "@book-forge/shared";

export class StudioConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `studio_state revision conflict: expected ${expected}, got ${actual}`,
    );
    this.name = "StudioConflictError";
  }
}

export class StudioBookNotFoundError extends Error {
  constructor(bookId: number) {
    super(`book ${bookId} not found`);
    this.name = "StudioBookNotFoundError";
  }
}

export interface PatchStudioStateInput {
  expectedRevision: number;
  next: StudioState;
}

export interface LogStudioEventInput {
  bookId: number;
  eventType: StudioEventType;
  stageId?: string;
  aspectId?: string;
  revisionBefore: number;
  revisionAfter: number;
  payload: StudioEventPayload;
}

export interface StudioRepository {
  loadStudioState: (bookId: number) => StudioState;
  patchStudioState: (
    bookId: number,
    input: PatchStudioStateInput,
  ) => StudioState;
  loadConcept: (bookId: number) => BookConcept;
  patchConcept: (bookId: number, next: BookConcept) => BookConcept;
  events: {
    log: (input: LogStudioEventInput) => void;
  };
}

export function createStudioRepository(
  sqlite: DatabaseType,
): StudioRepository {
  function readBook(bookId: number): {
    studio_state: string | null;
    concept: string | null;
  } {
    const row = sqlite
      .prepare("SELECT studio_state, concept FROM books WHERE id = ?")
      .get(bookId) as
      | { studio_state: string | null; concept: string | null }
      | undefined;
    if (!row) throw new StudioBookNotFoundError(bookId);
    return row;
  }

  function loadStudioState(bookId: number): StudioState {
    const row = readBook(bookId);
    if (!row.studio_state) return emptyStudioState();
    return studioStateSchema.parse(JSON.parse(row.studio_state));
  }

  function patchStudioState(
    bookId: number,
    input: PatchStudioStateInput,
  ): StudioState {
    const current = loadStudioState(bookId);
    if (current.revision !== input.expectedRevision) {
      throw new StudioConflictError(input.expectedRevision, current.revision);
    }
    const nextState: StudioState = {
      ...input.next,
      schemaVersion: 1,
      revision: current.revision + 1,
    };
    // Hard-invariant guard before persistence.
    assertStudioStateInvariants(nextState);
    studioStateSchema.parse(nextState);
    const now = new Date().toISOString();
    sqlite
      .prepare("UPDATE books SET studio_state = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(nextState), now, bookId);
    return nextState;
  }

  function loadConcept(bookId: number): BookConcept {
    const row = readBook(bookId);
    if (!row.concept) return emptyBookConcept();
    return bookConceptSchema.parse(JSON.parse(row.concept));
  }

  function patchConcept(bookId: number, next: BookConcept): BookConcept {
    bookConceptSchema.parse(next);
    const now = new Date().toISOString();
    const info = sqlite
      .prepare("UPDATE books SET concept = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(next), now, bookId);
    if (info.changes === 0) throw new StudioBookNotFoundError(bookId);
    return next;
  }

  function logEvent(input: LogStudioEventInput): void {
    studioEventTypeSchema.parse(input.eventType);
    const safePayload = studioEventPayloadSchema.parse(input.payload);
    sqlite
      .prepare(
        `INSERT INTO studio_events
           (book_id, event_type, stage_id, aspect_id, payload,
            revision_before, revision_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.bookId,
        input.eventType,
        input.stageId ?? null,
        input.aspectId ?? null,
        JSON.stringify(safePayload),
        input.revisionBefore,
        input.revisionAfter,
        new Date().toISOString(),
      );
  }

  return {
    loadStudioState,
    patchStudioState,
    loadConcept,
    patchConcept,
    events: { log: logEvent },
  };
}
