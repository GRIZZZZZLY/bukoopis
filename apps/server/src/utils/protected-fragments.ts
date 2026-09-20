/**
 * Защищённые фрагменты правки (ТЗ индивидуальности, раздел 10; AC-29).
 *
 * Автор отмечает куски, которых правка не касается. Привязка — по тому же
 * правилу, что у доказательства события ([character-events.ts](./character-events.ts)):
 * либо однозначна, либо её нет. Фрагмент, встречающийся в главе дважды,
 * защитить нельзя — непонятно, какой из двух имели в виду, а «защитили не то»
 * хуже, чем «не защитили».
 *
 * Сравнение с поправкой на пробелы: редактор нормализует документ при
 * загрузке, а правка возвращает прозу с другими переносами. Требовать
 * совпадения байт в байт значило бы терять фрагмент на ровном месте.
 */

export type ProtectedRejectReason = "not_found" | "ambiguous";

export interface LocateProtectedResult {
  accepted: string[];
  rejected: Array<{ fragment: string; reason: ProtectedRejectReason }>;
}

/** Пробелы, переносы и неразрывные пробелы сводятся к одному пробелу. */
function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + 1;
    // Двух достаточно: дальше считать незачем, ответ уже «неоднозначно».
    if (count > 1) break;
  }
  return count;
}

export function locateProtectedFragments(
  chapterText: string,
  fragments: readonly string[],
): LocateProtectedResult {
  const hay = normalize(chapterText);
  const out: LocateProtectedResult = { accepted: [], rejected: [] };
  for (const fragment of fragments) {
    const needle = normalize(fragment);
    const count = countOccurrences(hay, needle);
    if (count === 0) out.rejected.push({ fragment, reason: "not_found" });
    else if (count > 1) out.rejected.push({ fragment, reason: "ambiguous" });
    else out.accepted.push(fragment);
  }
  return out;
}

export interface SurvivingResult {
  kept: string[];
  lost: string[];
}

/**
 * Что из защищённого дожило до результата правки. Потеря не отвергает
 * кандидата: решать автору — он видит текст целиком и может счесть замену
 * удачной. Молча проглотить её нельзя, поэтому список уезжает в поток.
 */
export function survivingFragments(
  revisedText: string,
  fragments: readonly string[],
): SurvivingResult {
  const hay = normalize(revisedText);
  const kept: string[] = [];
  const lost: string[] = [];
  for (const fragment of fragments) {
    if (hay.includes(normalize(fragment))) kept.push(fragment);
    else lost.push(fragment);
  }
  return { kept, lost };
}
