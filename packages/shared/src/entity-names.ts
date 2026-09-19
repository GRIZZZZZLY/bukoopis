/**
 * Сопоставление имён с поправкой на русские падежи (С2 ревью 2026-09-19).
 *
 * Резолвер сущностей сравнивал имена посимвольно после `toLowerCase`, и
 * «Анна» не находилась ни в «Анны», ни в «Анне», ни в «Анну» — то есть почти
 * во всех падежах, которыми имя и встречается в тексте. Алиасы это лечили,
 * но их автор заводит руками.
 *
 * Полной морфологии здесь нет и не нужно: словарь русских имён — отдельная
 * зависимость размером с проект. Нужна основа, устойчивая к падежным
 * окончаниям, и ровно столько, чтобы «Анна/Анны/Анне/Анну/Анной» сошлись, а
 * «Ян» и «январь» — нет.
 */

/** Падежные окончания существительных, которые отрезаются от основы.
 *  Длинные раньше коротких: «ами» должно сработать прежде «и». */
const ENDINGS = [
  "ами", "ями", "ому", "ему", "ыми", "ими",
  "ах", "ях", "ой", "ей", "ою", "ею", "ом", "ем", "ов", "ев", "ий", "ая", "яя",
  "а", "я", "ы", "и", "у", "ю", "е", "о", "ь", "й",
] as const;

/** Основа имени: нижний регистр, ё→е, без падежного окончания.
 *  Короткие имена (три буквы и меньше) не режутся: «Ян» стал бы «Я». */
export function entityNameStem(name: string): string {
  const base = name.trim().toLowerCase().replace(/ё/g, "е");
  if (base.length <= 3) return base;
  for (const end of ENDINGS) {
    if (base.length - end.length >= 3 && base.endsWith(end)) {
      return base.slice(0, base.length - end.length);
    }
  }
  return base;
}

/** Два имени — одно и то же с точностью до падежа. */
export function sameEntityName(a: string, b: string): boolean {
  const sa = entityNameStem(a);
  const sb = entityNameStem(b);
  return sa.length > 0 && sa === sb;
}

/** Упоминается ли имя в тексте. Сравнение по основе и по границам слова:
 *  подстрочный поиск находил «Ян» в «январе», а «Анну» не находил вовсе. */
export function mentionsEntityName(text: string, name: string): boolean {
  const stem = entityNameStem(name);
  if (stem.length < 2) return false;
  const haystack = text.toLowerCase().replace(/ё/g, "е");

  // Без регулярного выражения: границы слова в JS (`\b`) считаются только по
  // ASCII даже с флагом `u`, а имена здесь кириллические. Проверяем соседей
  // руками — символ перед основой не должен быть буквой, а после основы
  // допускается падежный хвост не длиннее трёх букв.
  for (let from = 0; ; ) {
    const at = haystack.indexOf(stem, from);
    if (at === -1) return false;
    from = at + 1;
    if (at > 0 && isWordChar(haystack[at - 1]!)) continue;
    let end = at + stem.length;
    let tail = 0;
    while (end < haystack.length && isWordChar(haystack[end]!) && tail < 3) {
      end += 1;
      tail += 1;
    }
    if (end < haystack.length && isWordChar(haystack[end]!)) continue;
    return true;
  }
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string): boolean {
  return WORD_CHAR.test(ch);
}
