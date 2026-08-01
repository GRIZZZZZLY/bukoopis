import type { Database as DatabaseType } from "better-sqlite3";
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
    const samples: Array<{ text: string; label?: string }> = [];
    const pick = sqlite.prepare(
      `SELECT s.text FROM reference_scenes s
       JOIN reference_corpora c ON c.id = s.corpus_id
       WHERE c.profile_id = ?
       ORDER BY ((s.id * 2654435761) % 4294967291), s.id
       LIMIT ?`,
    );
    for (const source of sources) {
      if (source.count <= 0) continue;
      const rows = pick.all(source.profileId, source.count) as Array<{
        text: string;
      }>;
      for (const row of rows) {
        samples.push(
          source.label === undefined
            ? { text: row.text }
            : { text: row.text, label: source.label },
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
        const heading =
          s.label === undefined
            ? `### Образец ${i + 1}`
            : `### Образец ${i + 1} — источник «${s.label}»`;
        block.push(`${heading}\n${s.text.slice(0, 600).trim()}`);
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
