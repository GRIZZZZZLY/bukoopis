import { z } from "zod";

/**
 * Phase 4 — episodic memory (Zettelkasten-style notes).
 *
 * A note captures an open narrative thread, planted foreshadowing, an arc
 * delta, a theme or a mystery. Notes stay "open" until a later chapter
 * resolves them; the extractor proposes new notes and names which open
 * notes a chapter resolves.
 */

export const noteKindSchema = z.enum([
  "thread",
  "foreshadow",
  "arc_delta",
  "theme",
  "mystery",
]);
export type NoteKind = z.infer<typeof noteKindSchema>;

export const extractedNoteSchema = z.object({
  kind: noteKindSchema,
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(1200),
  tags: z.array(z.string().min(1).max(40)).max(8).default([]),
});
export type ExtractedNote = z.infer<typeof extractedNoteSchema>;

export const episodicNoteExtractionSchema = z.object({
  newNotes: z.array(extractedNoteSchema).max(20),
  /** Titles of currently-open notes this chapter resolves/closes. */
  resolvedTitles: z.array(z.string().min(1).max(160)).max(20).default([]),
  notes: z.string().nullable().optional(),
});
export type EpisodicNoteExtraction = z.infer<
  typeof episodicNoteExtractionSchema
>;
