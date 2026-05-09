export interface GenreDefinition {
  id: string;
  label: string;
  parentId?: string;
  promptHints: string[];
  incompatibleWith?: string[];
}

export interface ToneDefinition {
  id: string;
  label: string;
  promptHints: string[];
}

export const GENRES: readonly GenreDefinition[] = [
  // ─── Fantasy tree ───────────────────────────────────────────
  {
    id: "fantasy",
    label: "Фэнтези",
    promptHints: ["магия как часть мира", "не-современный сеттинг"],
  },
  {
    id: "fantasy.dark_fantasy",
    label: "Тёмное фэнтези",
    parentId: "fantasy",
    promptHints: ["мрак", "моральная серость", "цена силы"],
  },
  {
    id: "fantasy.romantasy",
    label: "Романтэзи",
    parentId: "fantasy",
    promptHints: ["центральная любовная линия", "эмоциональный накал"],
  },
  {
    id: "fantasy.high_fantasy",
    label: "Высокое фэнтези",
    parentId: "fantasy",
    promptHints: ["эпичный масштаб", "выраженная мифология"],
    incompatibleWith: ["sci_fi.hard_sci_fi"],
  },
  {
    id: "fantasy.urban_fantasy",
    label: "Городское фэнтези",
    parentId: "fantasy",
    promptHints: ["современный город", "магия скрыта от обывателей"],
  },
  // ─── Sci-fi tree ────────────────────────────────────────────
  {
    id: "sci_fi",
    label: "Научная фантастика",
    promptHints: ["технологии как двигатель", "будущее или альтернативное настоящее"],
    incompatibleWith: ["fantasy.high_fantasy"],
  },
  {
    id: "sci_fi.hard_sci_fi",
    label: "Твёрдая НФ",
    parentId: "sci_fi",
    promptHints: ["правдоподобная физика", "технические детали"],
    incompatibleWith: ["fantasy"],
  },
  {
    id: "sci_fi.space_opera",
    label: "Космоопера",
    parentId: "sci_fi",
    promptHints: ["масштаб галактики", "героика, политика и звездные флоты"],
  },
  {
    id: "sci_fi.cyberpunk",
    label: "Киберпанк",
    parentId: "sci_fi",
    promptHints: ["high tech / low life", "корпорации", "цифровая идентичность"],
  },
  // ─── Mystery / thriller tree ────────────────────────────────
  {
    id: "mystery",
    label: "Детектив",
    promptHints: ["загадка", "расследование", "ключи и улики"],
  },
  {
    id: "mystery.cozy_mystery",
    label: "Уютный детектив",
    parentId: "mystery",
    promptHints: ["камерное место действия", "минимум насилия"],
  },
  {
    id: "thriller",
    label: "Триллер",
    promptHints: ["напряжение", "опасность", "темп"],
  },
  // ─── Horror ─────────────────────────────────────────────────
  {
    id: "horror",
    label: "Хоррор",
    promptHints: ["страх", "сверхъестественное или психологическое"],
  },
  // ─── Romance tree ──────────────────────────────────────────
  {
    id: "romance",
    label: "Любовный роман",
    promptHints: ["центральная любовная линия", "счастливый или горько-сладкий финал"],
  },
  // ─── Literary ──────────────────────────────────────────────
  {
    id: "literary",
    label: "Литературное",
    promptHints: ["язык", "психологизм", "символика"],
  },
  // ─── Historical ────────────────────────────────────────────
  {
    id: "historical",
    label: "Историческое",
    promptHints: ["реальная эпоха", "достоверность деталей"],
  },
] as const;

export const TONES: readonly ToneDefinition[] = [
  { id: "dark", label: "Мрачный", promptHints: ["напряжение", "потери"] },
  { id: "gritty", label: "Жёсткий", promptHints: ["реализм насилия", "грязь"] },
  { id: "romantic", label: "Романтичный", promptHints: ["чувственность", "тоска"] },
  { id: "comedic", label: "Комедийный", promptHints: ["юмор", "лёгкость"] },
  { id: "hopeful", label: "Светлый", promptHints: ["надежда", "тёплые финалы"] },
  { id: "melancholic", label: "Меланхоличный", promptHints: ["осенняя грусть"] },
  { id: "tense", label: "Напряжённый", promptHints: ["саспенс", "ожидание удара"] },
  { id: "whimsical", label: "Игривый", promptHints: ["сказочность", "лёгкая ирония"] },
  { id: "epic", label: "Эпичный", promptHints: ["масштаб", "патетика"] },
] as const;

const GENRE_INDEX = new Map(GENRES.map((g) => [g.id, g]));
const TONE_INDEX = new Map(TONES.map((t) => [t.id, t]));

export function getGenreById(id: string): GenreDefinition | undefined {
  return GENRE_INDEX.get(id);
}

export function getToneById(id: string): ToneDefinition | undefined {
  return TONE_INDEX.get(id);
}

export function getRootGenres(): GenreDefinition[] {
  return GENRES.filter((g) => g.parentId === undefined);
}

export function getGenreChildren(id: string): GenreDefinition[] {
  return GENRES.filter((g) => g.parentId === id);
}
