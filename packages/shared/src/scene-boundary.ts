import { z } from "zod";

/** Граница сцены (ТЗ индивидуальности, раздел 7).
 *
 *  В первой реализации сцена одна на главу — решение 2 ТЗ. Но все контракты
 *  принимают границу, а не номер главы, с первого дня: когда появятся
 *  внутриглавные границы, добавится только значение `sceneOrdinal`, и ни один
 *  вызов не придётся переписывать. Обратный порядок — сначала номер главы,
 *  потом «разложить на сцены» — означал бы менять каждый контракт разом. */

/** Единственная сцена главы, пока автор не разбил её на части. */
export const IMPLICIT_SCENE_ORDINAL = 0;

export const sceneBoundarySchema = z.object({
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  /** `null` — у главы ещё нет принятой версии. Граница при этом осмысленна:
   *  знания на её начало считаются по предыдущим главам. */
  chapterVersionId: z.number().int().positive().nullable(),
  sceneOrdinal: z.number().int().nonnegative(),
});
export type SceneBoundary = z.infer<typeof sceneBoundarySchema>;

export function boundaryForChapter(
  bookId: number,
  chapterId: number,
  chapterVersionId: number | null,
): SceneBoundary {
  return {
    bookId,
    chapterId,
    chapterVersionId,
    sceneOrdinal: IMPLICIT_SCENE_ORDINAL,
  };
}

/** Стабильный ключ места в книге. Намеренно **не** включает версию: одна и
 *  та же сцена остаётся той же сценой после перезаписи главы, иначе каждый
 *  перегенерированный текст выглядел бы новым местом и все зависимые снимки
 *  сбрасывались бы без причины (раздел 7: стабильный ID не равен индексу). */
export function sceneKey(b: SceneBoundary): string {
  return `b${b.bookId}:c${b.chapterId}:s${b.sceneOrdinal}`;
}
