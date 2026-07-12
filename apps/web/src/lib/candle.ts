export const DEFAULT_WORD_GOAL = 500;
const GOAL_KEY = "bf-word-goal";

/** Доля дневной цели, 0..1. Свеча тает по мере прогресса. */
export function candleLevel(words: number, goal: number): number {
  if (!Number.isFinite(words) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.min(1, words / goal));
}

export function readWordGoal(): number {
  try {
    const n = Number(localStorage.getItem(GOAL_KEY));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_WORD_GOAL;
  } catch {
    return DEFAULT_WORD_GOAL;
  }
}

export function saveWordGoal(goal: number): void {
  try {
    localStorage.setItem(GOAL_KEY, String(Math.round(goal)));
  } catch {
    /* ignore */
  }
}
