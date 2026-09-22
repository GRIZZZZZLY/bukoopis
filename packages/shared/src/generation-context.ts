import { z } from "zod";

/**
 * Манифест контекста генерации (этап 4, раздел 8.1 ТЗ).
 *
 * Writer, критика и Reviser собирают вход из одних источников; манифест
 * перечисляет, какие именно — версии глав, ревизии героев и отношений,
 * события знаний, профиль стиля, outline — и что из собранного вошло в
 * бюджет. Отпечаток считается по НАБОРУ ИСТОЧНИКОВ, а не по тексту промпта:
 * представления ролей различаются намеренно, и сравнивать их посимвольно
 * нельзя. Совпал отпечаток — база та же; разошёлся — база уехала, и правка
 * по старым замечаниям может чинить то, чего уже нет.
 *
 * Текст промпта не хранится (решение автора 2026-09-19): всё, на что
 * указывает манифест, версионировано, и восстановить вход можно по ссылкам.
 */

export const CONTEXT_PURPOSES = ["writer", "critique", "repair"] as const;
export const contextPurposeSchema = z.enum(CONTEXT_PURPOSES);
export type ContextPurpose = z.infer<typeof contextPurposeSchema>;

export const CONTEXT_SOURCE_KINDS = [
  "chapter_version",
  "character",
  "relationship",
  "style_profile",
  "outline",
  "event",
  // F12 ревью 2026-09-22: источники, которые доходят до промпта, но в
  // манифест не попадали, — правка любого из них давала `baseChanged=false`.
  // Для них `id` — книга, а `revision` — отпечаток содержимого на границе.
  "studio",
  "scene_state",
  "facts",
  "notes",
  "items",
  "locations",
  "voice_samples",
] as const;

/** Один использованный источник. `versionId` — для того, что версионируется
 *  (глава), `revision` — для того, что живёт ревизиями (профиль, отношение)
 *  или чей отпечаток вычислен (outline). */
export const contextSourceRefSchema = z.object({
  kind: z.enum(CONTEXT_SOURCE_KINDS),
  id: z.number().int().nonnegative(),
  versionId: z.number().int().positive().nullable().default(null),
  revision: z.number().int().nonnegative().nullable().default(null),
});
export type ContextSourceRef = z.infer<typeof contextSourceRefSchema>;

/** Версия правил сборки. Меняется, когда меняется СОСТАВ секций или их
 *  рендер, а не когда меняются данные: два манифеста с разной версией
 *  несравнимы по определению. */
// stage4-2: в манифест добавлены источники F12 и отпечаток стиля по
// содержимому. Прежние манифесты с новыми несравнимы — и должны отвечать
// «сравнивать нечем», а не «база изменилась».
export const CONTEXT_PROMPT_VERSION = "stage4-2";

export const contextManifestSchema = z.object({
  purpose: contextPurposeSchema,
  sources: z.array(contextSourceRefSchema),
  includedSections: z.array(z.string()),
  droppedSections: z.array(
    z.object({ id: z.string(), tokens: z.number().int().nonnegative() }),
  ),
  budgetTokens: z.number().int().positive(),
  usedTokens: z.number().int().nonnegative(),
  promptVersion: z.string(),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;

/** FNV-1a, 32 бита, с заданным начальным значением. Не криптография: нужна
 *  детерминированность и отсутствие зависимости от `node:crypto` — пакет
 *  общий с браузером. */
function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Отпечаток набора источников: порядок перечисления не важен, версия и
 *  ревизия — важны, одинаковые id разных видов различаются. */
export function snapshotFingerprint(
  sources: ReadonlyArray<ContextSourceRef>,
): string {
  const norm = sources
    .map((s) => `${s.kind}:${s.id}:${s.versionId ?? "-"}:${s.revision ?? "-"}`)
    .sort()
    .join("|");
  const a = fnv1a32(norm, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(norm, 0x9747b28c).toString(16).padStart(8, "0");
  return `${a}${b}`;
}
