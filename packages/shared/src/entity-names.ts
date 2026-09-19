/**
 * Сопоставление имён с поправкой на русские падежи (С2 ревью 2026-09-19).
 *
 * Резолвер сущностей сравнивал имена посимвольно после `toLowerCase`, и
 * «Анна» не находилась ни в «Анны», ни в «Анне», ни в «Анну» — то есть почти
 * во всех падежах, которыми имя и встречается в тексте. Алиасы это лечили,
 * но их автор заводит руками.
 *
 * Полной морфологии здесь нет и не нужно: словарь русских имён — отдельная
 * зависимость размером с проект. Нужно ровно столько, чтобы
 * «Анна/Анны/Анне/Анну/Анной» сошлись, а «Вера» не находилась в «верно»,
 * «Соня» в «сон», «Ян» в «январе».
 *
 * Поэтому совпадение — не по подстроке и не по «основа плюс любые три
 * буквы», а по слову целиком: слово из текста должно быть либо самим именем,
 * либо основой имени с ОДНИМ ИЗ ПАДЕЖНЫХ окончаний. «Верно» = «вер» + «но»,
 * а «но» падежным окончанием не бывает, поэтому Вера в нём не находится.
 */

/** Падежные окончания. Длинные раньше коротких: «ами» должно сработать
 *  прежде «и». Тот же список служит и отрезанием основы, и проверкой
 *  допустимости хвоста. */
const ENDINGS = [
  "ами", "ями", "ому", "ему", "ыми", "ими",
  "ах", "ях", "ой", "ей", "ою", "ею", "ом", "ем", "ов", "ев", "ий", "ая", "яя",
  "а", "я", "ы", "и", "у", "ю", "е", "о", "ь", "й",
] as const;

const ENDING_SET = new Set<string>(ENDINGS);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

/** Основа имени: нижний регистр, ё→е, без падежного окончания. Основа не
 *  короче двух букв — иначе «Ян» превратился бы в «Я» и ловил бы всё. */
export function entityNameStem(name: string): string {
  const base = normalize(name);
  for (const end of ENDINGS) {
    if (base.length - end.length >= 2 && base.endsWith(end)) {
      return base.slice(0, base.length - end.length);
    }
  }
  return base;
}

/** Одно ли это слово с точностью до падежа. */
function wordMatchesName(word: string, name: string): boolean {
  const w = normalize(word);
  const n = normalize(name);
  if (w.length === 0) return false;
  if (w === n) return true;
  const stem = entityNameStem(name);
  if (!w.startsWith(stem)) return false;
  const tail = w.slice(stem.length);
  // Пустой хвост не годится: «сон» — это не «Соня», а самостоятельное слово.
  // Само имя уже проверено точным сравнением выше.
  return tail.length > 0 && ENDING_SET.has(tail);
}

/** Два имени — одно и то же с точностью до падежа. */
export function sameEntityName(a: string, b: string): boolean {
  return wordMatchesName(a, b) || wordMatchesName(b, a);
}

const WORD_SPLIT = /[^\p{L}\p{N}_]+/u;

/** Слово написано с заглавной (или целиком прописными). Имена собственные в
 *  русском пишутся так всегда, и это последнее, что отделяет «Веру» от
 *  «верю», а «светом» от Светы: падежное окончание у них одинаковое, и без
 *  словаря различить их больше нечем. */
function looksProper(word: string): boolean {
  const first = word[0];
  if (first === undefined) return false;
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/** Упоминается ли имя в тексте. Текст режется на слова, каждое слово
 *  сверяется с именем целиком и должно быть написано с заглавной:
 *  подстрочный поиск находил «Ян» в «январе», а «Анну» при герое «Анна» не
 *  находил вовсе. */
export function mentionsEntityName(text: string, name: string): boolean {
  const parts = normalize(name).split(WORD_SPLIT).filter(Boolean);
  if (parts.length === 0) return false;
  const words = text.split(WORD_SPLIT).filter((w) => w.length > 0 && looksProper(w));
  if (parts.length === 1) {
    return words.some((w) => wordMatchesName(w, parts[0]!));
  }
  // Двусловное имя («Анна Каренина»): довольно и одного слова — в тексте
  // героя зовут то по имени, то по фамилии.
  return words.some((w) => parts.some((p) => wordMatchesName(w, p)));
}
