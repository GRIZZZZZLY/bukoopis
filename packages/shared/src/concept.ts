import { z } from "zod";

export const audienceSchema = z.enum(["ya", "adult", "all_ages", "mg"]);
export type Audience = z.infer<typeof audienceSchema>;

export const premiseSchema = z.object({
  protagonist: z.string().optional(),
  conflict: z.string().optional(),
  stakes: z.string().optional(),
  logline: z.string().optional(),
});
export type Premise = z.infer<typeof premiseSchema>;

export const bookConceptSchema = z.object({
  schemaVersion: z.literal(1),
  genres: z.array(z.string()),
  customGenres: z.array(z.string()).optional(),
  tones: z.array(z.string()),
  customTones: z.array(z.string()).optional(),
  audience: audienceSchema,
  premise: premiseSchema,
});
export type BookConcept = z.infer<typeof bookConceptSchema>;

/** The concept stage keeps no record in `studio_state`, so its progress is read
 *  off the concept itself. The logline is the gate because it is the one premise
 *  field every aspect agent reads and the outline agent requires; genres and the
 *  rest only soften the prompts (see studio-warnings). */
export function isConceptComplete(concept: BookConcept): boolean {
  return (concept.premise.logline ?? "").trim().length > 0;
}

export function emptyBookConcept(): BookConcept {
  return {
    schemaVersion: 1,
    genres: [],
    tones: [],
    audience: "adult",
    premise: {},
  };
}
