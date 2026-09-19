import { describe, it, expect } from "vitest";
import {
  sceneBoundarySchema,
  boundaryForChapter,
  sceneKey,
  IMPLICIT_SCENE_ORDINAL,
} from "./scene-boundary.js";

describe("SceneBoundary", () => {
  it("глава без разбиения даёт одну неявную сцену", () => {
    const b = boundaryForChapter(3, 41, 512);
    expect(b.sceneOrdinal).toBe(IMPLICIT_SCENE_ORDINAL);
    expect(IMPLICIT_SCENE_ORDINAL).toBe(0);
    expect(b.bookId).toBe(3);
    expect(b.chapterId).toBe(41);
    expect(b.chapterVersionId).toBe(512);
  });

  it("версия может отсутствовать — глава ещё не написана", () => {
    const b = boundaryForChapter(3, 41, null);
    expect(b.chapterVersionId).toBeNull();
    expect(sceneBoundarySchema.safeParse(b).success).toBe(true);
  });

  it("ключ сцены стабилен и не равен индексу массива", () => {
    const a = sceneKey(boundaryForChapter(3, 41, 512));
    const b = sceneKey(boundaryForChapter(3, 41, 999));
    // Ключ описывает МЕСТО в книге, а не запуск: смена версии его не меняет.
    expect(a).toBe(b);
    expect(a).toBe("b3:c41:s0");
    expect(sceneKey(boundaryForChapter(3, 42, 512))).not.toBe(a);
    expect(sceneKey(boundaryForChapter(4, 41, 512))).not.toBe(a);
  });

  it("отрицательный порядковый номер сцены отвергается", () => {
    const r = sceneBoundarySchema.safeParse({
      bookId: 1,
      chapterId: 1,
      chapterVersionId: null,
      sceneOrdinal: -1,
    });
    expect(r.success).toBe(false);
  });

  it("дробный порядковый номер сцены отвергается", () => {
    const r = sceneBoundarySchema.safeParse({
      bookId: 1,
      chapterId: 1,
      chapterVersionId: null,
      sceneOrdinal: 1.5,
    });
    expect(r.success).toBe(false);
  });
});
