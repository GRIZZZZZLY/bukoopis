import { z } from "zod";

export const audienceSchema = z.enum(["ya", "adult", "all_ages", "mg"]);
export type Audience = z.infer<typeof audienceSchema>;

/** Как аудитория называется для автора и в промптах. */
export const AUDIENCE_LABELS: Record<Audience, string> = {
  ya: "подростки и молодые взрослые",
  adult: "взрослые",
  all_ages: "для всех возрастов",
  mg: "дети 9–12",
};

export const premiseSchema = z.object({
  protagonist: z.string().optional(),
  conflict: z.string().optional(),
  stakes: z.string().optional(),
  logline: z.string().optional(),
});
export type Premise = z.infer<typeof premiseSchema>;

/** Питч — одно целостное предложение книги. Всё, что автор читает на карточке.
 *  Ни одно поле не бывает пустым: пустоту заполняет модель, не автор. */
export const pitchSchema = z.object({
  id: z.string().min(1),
  workingTitle: z.string().min(1).max(120),
  logline: z.string().min(1).max(600),
  protagonist: z.string().min(1).max(2000),
  conflict: z.string().min(1).max(2000),
  stakes: z.string().min(1).max(2000),
  hook: z.string().min(1).max(600),
  genre: z.string().min(1).max(200),
  tone: z.string().min(1).max(200),
  audience: audienceSchema,
  strength: z.string().min(1).max(600),
  risk: z.string().min(1).max(600),
});
export type Pitch = z.infer<typeof pitchSchema>;

/** Поля, которые можно взять из разных питчей при смешивании. */
export const PITCH_MIX_FIELDS = [
  "workingTitle",
  "logline",
  "protagonist",
  "conflict",
  "stakes",
  "hook",
  "genre",
  "tone",
] as const;
export type PitchMixField = (typeof PITCH_MIX_FIELDS)[number];

/** Подписи строк питча и замысла. Единственный источник для интерфейса:
 *  «логлайн», «протагонист», «ставки» автору не показываются. */
export const PITCH_FIELD_LABELS: Record<PitchMixField, string> = {
  workingTitle: "Рабочее название",
  logline: "О чём книга, одной фразой",
  protagonist: "Кто главный и чего хочет",
  conflict: "Что ему мешает",
  stakes: "Что он потеряет",
  hook: "Крючок",
  genre: "Жанр",
  tone: "Тон",
};

export const bookConceptSchema = z.object({
  schemaVersion: z.literal(1),
  /** Задумка автора своими словами. Единственный текст, который он печатает сам. */
  idea: z.string().max(8000).optional(),
  /** Все сгенерированные и смешанные питчи; автор удаляет ненужные вручную. */
  pitches: z.array(pitchSchema).default([]),
  selectedPitchId: z.string().optional(),
  /** ISO-дата утверждения. Наличие поля = этап «Замысел» готов. */
  lockedAt: z.string().optional(),
  /** Свободный текст из питча, не словарь. */
  genre: z.string().max(200).optional(),
  tone: z.string().max(200).optional(),
  hook: z.string().max(600).optional(),
  audience: audienceSchema,
  premise: premiseSchema,
  /** Наследие пикеров: только чтобы старые записи парсились. normalizeConcept
   *  сворачивает их в genre/tone и убирает. */
  genres: z.array(z.string()).optional(),
  customGenres: z.array(z.string()).optional(),
  tones: z.array(z.string()).optional(),
  customTones: z.array(z.string()).optional(),
});
export type BookConcept = z.infer<typeof bookConceptSchema>;

/** Этап «Замысел» готов только после явного «Утвердить замысел». Логлайн сам по
 *  себе больше ничего не завершает: неявная готовность и была причиной того,
 *  что рекомендатор уходил дальше по недоделанному входу. */
export function isConceptComplete(concept: BookConcept): boolean {
  return typeof concept.lockedAt === "string" && concept.lockedAt.length > 0;
}

export function emptyBookConcept(): BookConcept {
  return {
    schemaVersion: 1,
    pitches: [],
    audience: "adult",
    premise: {},
  };
}

function joinLabels(
  ...lists: Array<readonly string[] | undefined>
): string | undefined {
  const seen: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const v = raw.trim();
      if (v.length > 0 && !seen.includes(v)) seen.push(v);
    }
  }
  return seen.length > 0 ? seen.join(", ") : undefined;
}

/** Приводит запись любой давности к текущему виду: гарантирует `pitches`,
 *  выводит `genre`/`tone` из старых массивов, если явных строк нет. Вызывается
 *  при каждом чтении из БД, поэтому миграция данных не нужна. */
export function normalizeConcept(input: BookConcept): BookConcept {
  const { genres, customGenres, tones, customTones, ...rest } = input;
  const genre = (rest.genre ?? "").trim() || joinLabels(genres, customGenres);
  const tone = (rest.tone ?? "").trim() || joinLabels(tones, customTones);
  return {
    ...rest,
    pitches: rest.pitches ?? [],
    ...(genre !== undefined ? { genre } : {}),
    ...(tone !== undefined ? { tone } : {}),
  };
}

/** «Утвердить замысел»: выбранный питч становится замыслом книги. */
export function lockConceptToPitch(
  concept: BookConcept,
  pitchId: string,
  lockedAt: string,
): BookConcept {
  const pitch = concept.pitches.find((p) => p.id === pitchId);
  if (!pitch) throw new Error(`pitch ${pitchId} not found in concept`);
  return {
    ...concept,
    selectedPitchId: pitch.id,
    lockedAt,
    genre: pitch.genre,
    tone: pitch.tone,
    hook: pitch.hook,
    audience: pitch.audience,
    premise: {
      protagonist: pitch.protagonist,
      conflict: pitch.conflict,
      stakes: pitch.stakes,
      logline: pitch.logline,
    },
  };
}

/** «Изменить замысел»: снимает утверждение, ничего не стирая. */
export function unlockConcept(concept: BookConcept): BookConcept {
  const next: BookConcept = { ...concept };
  delete next.lockedAt;
  return next;
}
