/** Геометрия книжной полки: всё детерминировано от данных книги,
    без Math.random — полка не «прыгает» между рендерами. */

export interface BookStats {
  chapters: number;
  done: number;
  words: number;
}

export function titleSeed(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Толщина корешка: 46px базово, +2px за главу, максимум 78px. */
export function spineWidth(chapters: number): number {
  if (!Number.isFinite(chapters) || chapters < 0) return 46;
  return Math.min(78, 46 + Math.round(chapters) * 2);
}

/** Высота корешка: 170..234px — вписывается в ряд полки 252px. */
export function spineHeight(chapters: number, seed: number): number {
  const ch = Number.isFinite(chapters) && chapters > 0 ? Math.min(chapters, 24) : 0;
  return 170 + ch * 2 + (Math.abs(seed) % 3) * 8;
}

export function spineTone(seed: number): number {
  return Math.abs(seed) % 4;
}

export function shelfProgress(done: number, chapters: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(chapters) || chapters <= 0) return 0;
  return Math.max(0, Math.min(1, done / chapters));
}
