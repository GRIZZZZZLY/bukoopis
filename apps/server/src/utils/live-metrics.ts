import { mannerLine, narrationPerson } from "@book-forge/style-engine";

/** Замеры живой проверки главы (`pnpm live:chapter`). Чистые функции. */

export type Person = "first" | "third";

export interface LiveMetrics {
  words: number;
  scenes: { words: number; person: Person }[];
  person: Person;
  previousPerson: Person | null;
  personKept: boolean | null;
  repeat: { count: number; phrase: string };
  manner: string;
}

// Слово — буквы и цифры, со внутренним дефисом или апострофом («кто-то»).
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

const wordList = (text: string): string[] => text.match(WORD) ?? [];

/** Самый частый отрезок из `n` слов подряд; при равенстве — первый по тексту. */
export function mostRepeatedPhrase(text: string, n = 6): { count: number; phrase: string } {
  const w = wordList(text).map((x) => x.toLocaleLowerCase("ru"));
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= w.length; i += 1) {
    const phrase = w.slice(i, i + n).join(" ");
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  let best = { count: 0, phrase: "" };
  for (const [phrase, count] of counts) if (count > best.count) best = { count, phrase };
  return best;
}

export function measureScene(text: string): { words: number; person: Person } {
  return { words: wordList(text).length, person: narrationPerson(text) };
}

export function measureChapter(input: {
  scenes: string[];
  previousChapterText: string | null;
}): LiveMetrics {
  const scenes = input.scenes.map((s) => s.trim());
  const text = scenes.join("\n\n");
  const person = narrationPerson(text);
  const previousPerson =
    input.previousChapterText === null ? null : narrationPerson(input.previousChapterText);
  return {
    words: wordList(text).length,
    scenes: scenes.map(measureScene),
    person,
    previousPerson,
    personKept: previousPerson === null ? null : previousPerson === person,
    repeat: mostRepeatedPhrase(text),
    manner: mannerLine(text),
  };
}

/** Русское число: 1 слово, 2 слова, 5 слов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

/** Как остановилась генерация, словами автора. */
export function stopLabel(stopReason: string | null): string {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "модель закончила сама";
    case "max_tokens":
      return "оборвалась на пределе длины";
    case "held":
      return "остановлена после сцены";
    case "interrupted":
      return "прервалась ошибкой";
    case null:
      return "причина остановки неизвестна";
    default:
      return `причина остановки «${stopReason}»`;
  }
}

export const personWord = (p: Person): string => (p === "first" ? "первого" : "третьего");

const SHORT_SCENE_WORDS = 150;
const REPEAT_WARN = 4;

/** `metrics` — null, когда сцен нет вовсе: статус кандидата судится и тогда. */
export function judgeLiveRun(input: {
  metrics: LiveMetrics | null;
  proposalStatus: string;
  stopReason: string | null;
}): { failures: string[]; warnings: string[] } {
  const { metrics: m } = input;
  const failures: string[] = [];
  const warnings: string[] = [];
  if (input.proposalStatus !== "ready") {
    failures.push(
      `Глава не готова: статус «${input.proposalStatus}», ${stopLabel(input.stopReason)}.`,
    );
  }
  if (!m) return { failures, warnings };
  if (m.personKept === false && m.previousPerson !== null) {
    failures.push(
      `Лицо повествования сменилось: прошлая глава написана от ${personWord(m.previousPerson)} лица, эта от ${personWord(m.person)}.`,
    );
  }
  if (m.repeat.count >= REPEAT_WARN) {
    warnings.push(
      `Фраза «${m.repeat.phrase}» повторяется ${m.repeat.count} ${plural(m.repeat.count, "раз", "раза", "раз")}.`,
    );
  }
  m.scenes.forEach((s, i) => {
    if (s.words < SHORT_SCENE_WORDS) {
      warnings.push(
        `Сцена ${i + 1} короткая: ${s.words} ${plural(s.words, "слово", "слова", "слов")}, меньше ${SHORT_SCENE_WORDS}.`,
      );
    }
    if (s.person !== m.person) {
      warnings.push(
        `Сцена ${i + 1} написана от ${personWord(s.person)} лица, глава в целом от ${personWord(m.person)}.`,
      );
    }
  });
  return { failures, warnings };
}
