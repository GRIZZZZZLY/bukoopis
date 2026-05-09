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

// Phase A seed — кратко. Расширяется в Phase B1.
export const GENRES: readonly GenreDefinition[] = [
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
    id: "thriller",
    label: "Триллер",
    promptHints: ["напряжение", "опасность", "темп"],
  },
  {
    id: "literary",
    label: "Литературное",
    promptHints: ["язык", "психологизм", "символика"],
  },
] as const;

export const TONES: readonly ToneDefinition[] = [
  { id: "dark", label: "Мрачный", promptHints: ["напряжение", "потери"] },
  { id: "gritty", label: "Жёсткий", promptHints: ["реализм насилия", "грязь"] },
  { id: "romantic", label: "Романтичный", promptHints: ["чувственность", "тоска"] },
  { id: "comedic", label: "Комедийный", promptHints: ["юмор", "лёгкость"] },
  { id: "hopeful", label: "Светлый", promptHints: ["надежда", "тёплые финалы"] },
  { id: "melancholic", label: "Меланхоличный", promptHints: ["осенняя грусть"] },
] as const;

const GENRE_INDEX = new Map(GENRES.map((g) => [g.id, g]));
const TONE_INDEX = new Map(TONES.map((t) => [t.id, t]));

export function getGenreById(id: string): GenreDefinition | undefined {
  return GENRE_INDEX.get(id);
}

export function getToneById(id: string): ToneDefinition | undefined {
  return TONE_INDEX.get(id);
}
