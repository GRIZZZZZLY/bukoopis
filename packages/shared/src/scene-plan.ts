import { z } from "zod";

/** Событие сцены: 1–300 знаков после обрезки пробелов, пустым не бывает.
 *  Без `.transform`: схема уйдёт в tool-схему агента. */
const eventSchema = z.string().trim().min(1).max(300);

export const scenePlanWriteSchema = z.object({
  scenes: z
    .array(z.object({ events: z.array(eventSchema).min(3).max(10) }))
    .min(1)
    .max(12),
});

export type ScenePlan = { scenes: { events: string[] }[] };
export type StoredScenePlan = ScenePlan & { basedOn: number };

export const storedScenePlanSchema = scenePlanWriteSchema.extend({
  basedOn: z.number().int().nonnegative(),
});

/** Чтение мягкое: непригодное значение читается как null. */
export function parseStoredScenePlan(raw: string | null): StoredScenePlan | null {
  if (!raw) return null;
  try {
    const r = storedScenePlanSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
