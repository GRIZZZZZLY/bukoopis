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

export function emptyBookConcept(): BookConcept {
  return {
    schemaVersion: 1,
    genres: [],
    tones: [],
    audience: "adult",
    premise: {},
  };
}
