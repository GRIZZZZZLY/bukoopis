import type { ChapterBeatSheetVariant } from "@book-forge/shared";

export const LOCAL_SCENE_WORDS = 600;
export const LOCAL_DEFAULT_CHAPTER_WORDS = 3000;

export interface LocalScene {
  events: string[];
  must: string;
  stop: string;
}

const SENTENCE_SPLIT = /(?<=[.!?…])\s+/u;

/** n элементов в g подряд идущих групп: размеры различаются не более чем на 1, большие впереди. */
function groupConsecutive<T>(items: T[], g: number): T[][] {
  const base = Math.floor(items.length / g);
  const extra = items.length % g;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < g; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

export function planLocalScenes(args: {
  beatSheet: ChapterBeatSheetVariant | null;
  chapterContent: string | null;
}): LocalScene[] {
  const { beatSheet, chapterContent } = args;
  const target = beatSheet?.estimatedWords ?? LOCAL_DEFAULT_CHAPTER_WORDS;
  const k = Math.max(1, Math.ceil(target / LOCAL_SCENE_WORDS));

  let items: string[] = (beatSheet?.beats ?? []).map((b) => b.summary);
  if (items.length === 0) {
    items = (chapterContent ?? "")
      .split(SENTENCE_SPLIT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const groups =
    items.length === 0
      ? Array.from({ length: k }, () => ["Продолжение главы"])
      : groupConsecutive(items, Math.min(k, items.length));

  const scenes = groups.map((events): LocalScene => {
    const last = events[events.length - 1] ?? "Продолжение главы";
    return { events, must: last, stop: last };
  });
  const note = beatSheet?.closing?.note?.trim();
  const lastScene = scenes[scenes.length - 1];
  if (note && lastScene) lastScene.stop = note;
  return scenes;
}

export function localTail(text: string | null): string {
  const t = (text ?? "").trim();
  if (!t) return "—";
  if (t.length <= LOCAL_SCENE_WORDS) return t;
  const cut = t.slice(-LOCAL_SCENE_WORDS);
  const i = cut.indexOf(". ");
  return (i === -1 ? cut : cut.slice(i + 2)).trim() || "—";
}

export function localCastLine(c: {
  name: string;
  role?: string | null;
  description?: string | null;
}): string {
  const role = c.role?.trim();
  if (role) return `${c.name} — ${role}`;
  const first = (c.description ?? "").trim().split(/(?<=[.!?…])\s/u)[0]?.trim();
  return first ? `${c.name} — ${first}` : c.name;
}

export function buildLocalScenePrompt(args: {
  chapterTitle: string;
  manner: string | null;
  scene: LocalScene;
  cast: string[];
  tail: string;
}): string {
  const { chapterTitle, manner, scene, cast, tail } = args;
  const events = scene.events.map((e, i) => `${i + 1}. ${e}`).join("\n");
  return (
    `### План главы\nГлава: ${chapterTitle}\n` +
    (manner ? `${manner}\n` : "") +
    `События:\n${events}\n` +
    `Обязано произойти: ${scene.must}\n` +
    `Останавливается на: ${scene.stop}\n\n` +
    `### Действующие лица\n${cast.join("\n")}\n\n` +
    `### Конец предыдущей сцены\n${tail}\n\n` +
    `### Текст главы\n`
  );
}
