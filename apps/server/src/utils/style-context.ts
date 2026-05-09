import type { Database as DatabaseType } from "better-sqlite3";
import {
  styleFingerprintSchema,
  fatigueWordsSchema,
  type StyleFingerprint,
  type FatigueWords,
} from "@book-forge/shared";

export interface StyleContext {
  prompt: string | null;
  fatigueBlacklist: string[];
}

interface ProfileRow {
  id: number;
  fingerprint_json: string | null;
  fatigue_words_json: string | null;
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
      "SELECT id, fingerprint_json, fatigue_words_json FROM style_profiles WHERE id = ?",
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

  // Few-shot: pick random scenes from the corpus, slice to ~600 chars each.
  if (fewShotCount > 0) {
    const scenes = sqlite
      .prepare(
        `SELECT s.text FROM reference_scenes s
         JOIN reference_corpora c ON c.id = s.corpus_id
         WHERE c.profile_id = ?
         ORDER BY random() LIMIT ?`,
      )
      .all(styleProfileId, fewShotCount) as Array<{ text: string }>;
    if (scenes.length > 0) {
      const block = ["## Образцы стиля (только ориентир по голосу — НЕ копировать дословно)"];
      for (let i = 0; i < scenes.length; i++) {
        const snippet = scenes[i]!.text.slice(0, 600).trim();
        block.push(`### Образец ${i + 1}\n${snippet}`);
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
