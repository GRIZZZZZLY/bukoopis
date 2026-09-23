import type { Database as DatabaseType } from "better-sqlite3";
import { computeDialogueShare } from "@book-forge/style-engine";
import {
  styleFingerprintSchema,
  fatigueWordsSchema,
  blendConfigSchema,
  type StyleFingerprint,
  type FatigueWords,
} from "@book-forge/shared";

export interface StyleContext {
  prompt: string | null;
  fatigueBlacklist: string[];
}

interface ProfileRow {
  id: number;
  kind: string;
  blend_config_json: string | null;
  fingerprint_json: string | null;
  fatigue_words_json: string | null;
}

interface SampleSource {
  /** Profile to draw scenes from. */
  profileId: number;
  /** How many scenes to take from it. */
  count: number;
  /** Parent name, shown only for blends so the samples read as raw material. */
  label?: string;
}

/**
 * Splits `total` samples across weighted sources by largest remainder, so the
 * counts sum exactly to `total` and a source with a non-zero weight is not
 * silently rounded out of the picture.
 */
function allocateSamples(
  weights: number[],
  total: number,
): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map((x) => Math.floor(x));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    counts[i] = (counts[i] ?? 0) + 1;
    left--;
  }
  return counts;
}

function fingerprintToPrompt(fp: StyleFingerprint): string {
  const lines: string[] = ["## Стиль (опираться, не подражать)"];
  // Старые профили снимались с частотами («минимум раз в 2–3 страницы»), а
  // частота, выданная как правило, превращает приём в механическую
  // периодичность (второй разбор прозы 2026-09-23).
  lines.push(
    "Ниже — наблюдения о манере автора и измеренные числа корпуса. Это ориентир, а не квоты: не выдерживай частоту приёма, применяй его там, где он уместен в сцене.",
  );
  lines.push(`Голос: ${fp.voiceSummary}`);
  lines.push(
    `Длины предложений: средн. ${fp.sentenceLengths.meanWords} слов, ` +
      `мед. ${fp.sentenceLengths.medianWords}, ` +
      `короткие (<8): ${(fp.sentenceLengths.shortShare * 100).toFixed(0)}%, ` +
      `средние: ${(fp.sentenceLengths.mediumShare * 100).toFixed(0)}%, ` +
      `длинные (>20): ${(fp.sentenceLengths.longShare * 100).toFixed(0)}%`,
  );
  lines.push(
    `Плотность: диалог ${(fp.density.dialogue * 100).toFixed(0)}% / ` +
      `описание ${(fp.density.description * 100).toFixed(0)}% / ` +
      `действие ${(fp.density.action * 100).toFixed(0)}% / ` +
      `интроспекция ${(fp.density.introspection * 100).toFixed(0)}%`,
  );
  lines.push(`Ритм абзаца: ${fp.paragraphRhythm}`);
  lines.push(`Время повествования: ${fp.tense}`);
  lines.push(`Открытие сцены: ${fp.sceneOpenings}`);
  lines.push(`Закрытие сцены: ${fp.sceneClosings}`);
  if (fp.metaphorFamilies.length > 0) {
    lines.push(`Семейства метафор: ${fp.metaphorFamilies.join(", ")}`);
  }
  if (fp.signatureSyntax.length > 0) {
    lines.push(`Сигнатурные синтаксические приёмы:`);
    for (const x of fp.signatureSyntax) lines.push(`  · ${x}`);
  }
  if (fp.signatureTropes.length > 0) {
    lines.push(`Сигнатурные литературные приёмы:`);
    for (const x of fp.signatureTropes) lines.push(`  · ${x}`);
  }
  if (fp.thingsToImitate.length > 0) {
    lines.push(`Что важно воспроизвести:`);
    for (const x of fp.thingsToImitate) lines.push(`  · ${x}`);
  }
  if (fp.thingsToAvoid.length > 0) {
    lines.push(`Чего у автора нет (не делать):`);
    for (const x of fp.thingsToAvoid) lines.push(`  · ${x}`);
  }
  return lines.join("\n");
}

/** Длина образца. Раньше образец обрезался до 600 символов — видна была
 *  лексика, но не ход разговора и не ритм сцены (второй разбор прозы
 *  2026-09-23). Теперь — законченный фрагмент до этой длины, по абзацам. */
export const STYLE_SAMPLE_MAX_CHARS = 2500;

export type SampleKind = "dialogue" | "narrative" | "mixed";

export const SAMPLE_KIND_LABELS: Record<SampleKind, string> = {
  dialogue: "разговор",
  narrative: "повествование без диалога",
  mixed: "действие с репликами",
};

/** Тип фрагмента по измеренной доле прямой речи — без модели. */
export function classifySample(text: string): SampleKind {
  const share = computeDialogueShare([text]);
  if (share >= 0.4) return "dialogue";
  if (share < 0.12) return "narrative";
  return "mixed";
}

/** Законченный фрагмент: целые абзацы до `max`. Первый абзац длиннее
 *  предела режется по концу предложения, а не посреди слова. */
export function wholeParagraphs(text: string, max = STYLE_SAMPLE_MAX_CHARS): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (size + p.length > max) break;
    out.push(p);
    size += p.length + 2;
  }
  if (out.length > 0) return out.join("\n\n");
  const first = paragraphs[0] ?? text;
  const cut = first.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max / 3 ? cut.slice(0, end + 1) : cut).trim();
}

/** Выбор образцов: по одному каждого типа (разговор, повествование,
 *  смешанный), затем добор из общего порядка. Порядок — хеш id сцены, как
 *  раньше: выбор обязан быть стабильным, блок лежит в кэшируемом префиксе. */
function pickDiverse(
  rows: Array<{ id: number; text: string }>,
  count: number,
): Array<{ text: string; kind: SampleKind }> {
  const classified = rows.map((r) => ({ ...r, kind: classifySample(r.text) }));
  const picked: typeof classified = [];
  for (const kind of ["dialogue", "narrative", "mixed"] as const) {
    if (picked.length >= count) break;
    const hit = classified.find((r) => r.kind === kind && !picked.includes(r));
    if (hit) picked.push(hit);
  }
  for (const r of classified) {
    if (picked.length >= count) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.map((r) => ({ text: r.text, kind: r.kind }));
}

/**
 * Where a profile's few-shot samples come from. An extracted profile draws on
 * its own corpus; a blend has none, so it draws on its parents in proportion to
 * their blend weights.
 */
function resolveSampleSources(
  sqlite: DatabaseType,
  profile: ProfileRow,
  styleProfileId: number,
  fewShotCount: number,
): SampleSource[] {
  if (profile.kind !== "blend" || !profile.blend_config_json) {
    return [{ profileId: styleProfileId, count: fewShotCount }];
  }
  let config;
  try {
    config = blendConfigSchema.parse(JSON.parse(profile.blend_config_json));
  } catch {
    return [];
  }
  const counts = allocateSamples(
    config.sources.map((s) => s.weight),
    fewShotCount,
  );
  const sources: SampleSource[] = [];
  for (let i = 0; i < config.sources.length; i++) {
    const src = config.sources[i]!;
    const parent = sqlite
      .prepare("SELECT name FROM style_profiles WHERE id = ?")
      .get(src.profileId) as { name: string } | undefined;
    // A deleted parent simply contributes no samples; the blend's own
    // fingerprint is already materialized and stays valid.
    if (!parent) continue;
    sources.push({
      profileId: src.profileId,
      count: counts[i] ?? 0,
      label: parent.name,
    });
  }
  return sources;
}

export function loadStyleContext(
  sqlite: DatabaseType,
  styleProfileId: number | null,
  fewShotCount = 3,
): StyleContext {
  if (styleProfileId === null) {
    return { prompt: null, fatigueBlacklist: [] };
  }
  const profile = sqlite
    .prepare(
      `SELECT id, kind, blend_config_json, fingerprint_json, fatigue_words_json
       FROM style_profiles WHERE id = ?`,
    )
    .get(styleProfileId) as ProfileRow | undefined;
  if (!profile) return { prompt: null, fatigueBlacklist: [] };

  const sections: string[] = [];

  if (profile.fingerprint_json) {
    try {
      const fp = styleFingerprintSchema.parse(
        JSON.parse(profile.fingerprint_json),
      );
      sections.push(fingerprintToPrompt(fp));
    } catch {
      /* corrupt fingerprint — skip */
    }
  }

  let fatigueBlacklist: string[] = [];
  if (profile.fatigue_words_json) {
    try {
      const fw: FatigueWords = fatigueWordsSchema.parse(
        JSON.parse(profile.fatigue_words_json),
      );
      fatigueBlacklist = fw.blacklist;
    } catch {
      /* skip */
    }
  }

  // Few-shot samples. The choice must be STABLE for a profile: this block sits
  // inside the Writer's cache_control system prefix, so `ORDER BY random()`
  // silently invalidated the whole prompt cache on every generation. A hash of
  // the scene id spreads the picks across the corpus without reintroducing
  // per-call variance.
  const isBlend = profile.kind === "blend";
  if (fewShotCount > 0) {
    const sources = resolveSampleSources(
      sqlite,
      profile,
      styleProfileId,
      fewShotCount,
    );
    const samples: Array<{ text: string; kind: SampleKind; label?: string }> = [];
    // Кандидатов берётся с запасом (не больше 60): тип фрагмента считается по
    // тексту, и среди первых трёх по хешу разговора может не оказаться.
    const pick = sqlite.prepare(
      `SELECT s.id, s.text FROM reference_scenes s
       JOIN reference_corpora c ON c.id = s.corpus_id
       WHERE c.profile_id = ?
       ORDER BY ((s.id * 2654435761) % 4294967291), s.id
       LIMIT 60`,
    );
    for (const source of sources) {
      if (source.count <= 0) continue;
      const rows = pick.all(source.profileId) as Array<{ id: number; text: string }>;
      for (const row of pickDiverse(rows, source.count)) {
        samples.push(
          source.label === undefined
            ? { text: row.text, kind: row.kind }
            : { text: row.text, kind: row.kind, label: source.label },
        );
      }
    }

    if (samples.length > 0) {
      // A blend has no corpus of its own, so its samples come from the parent
      // styles. Framing matters: unlabelled, the writer would drift back into
      // whichever parent it saw last instead of the synthesized voice.
      const block = [
        isBlend
          ? "## Образцы исходных стилей (СЫРЬЁ, из которого синтезирован голос выше)"
          : "## Образцы стиля (только ориентир по голосу — НЕ копировать дословно)",
      ];
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        const kind = SAMPLE_KIND_LABELS[s.kind];
        const heading =
          s.label === undefined
            ? `### Образец ${i + 1} — ${kind}`
            : `### Образец ${i + 1} — ${kind}, источник «${s.label}»`;
        block.push(`${heading}\n${wholeParagraphs(s.text)}`);
      }
      if (isBlend) {
        block.push(
          "ВАЖНО: это разные авторы. Не подражай ни одному из них по отдельности и не переключайся между ними по ходу главы — пиши единым голосом из блока «Стиль» выше. Образцы нужны только как фактура.",
        );
      }
      block.push(
        "ЖЁСТКОЕ ПРАВИЛО: запрещены буквальные совпадения >7 слов подряд с любым образцом.",
      );
      sections.push(block.join("\n\n"));
    }
  }

  return {
    prompt: sections.length > 0 ? sections.join("\n\n---\n\n") : null,
    fatigueBlacklist,
  };
}
