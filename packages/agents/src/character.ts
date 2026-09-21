import { mentionsEntityName } from "@book-forge/shared";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  selectVoiceSamples,
  VOICE_SITUATION_LABELS,
  RELATIONSHIP_QUALITY_LABELS,
  ACQUISITION_LABELS,
  type Character,
  type Relationship,
  type CharacterVoiceSample,
  type VoiceSampleSituation,
  type VoiceSampleOrigin,
  type VoiceSampleStatus,
  type RelationshipQualityKey,
  type ActiveState,
} from "@book-forge/shared";

interface CharacterRow {
  id: number;
  book_id: number;
  canonical_name: string;
  profile_json: string;
  revision: number;
  hidden_from_prompts: number;
  created_at: string;
  updated_at: string;
}
interface RelationshipRow {
  id: number;
  book_id: number;
  from_character_id: number;
  to_character_id: number;
  type: string;
  tension: number;
  notes: string | null;
  profile_json: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}
interface CharacterVoiceSampleRow {
  id: number;
  book_id: number;
  character_id: number;
  text: string;
  situation: string;
  addressee_character_id: number | null;
  note: string | null;
  origin: string;
  status: string;
  source_version_id: number | null;
  source_chapter_order: number | null;
  created_at: string;
  updated_at: string;
}

/** Та же защита, что в `db/rows.ts`: одна кривая строка профиля не должна
 *  срывать сбор контекста для генерации главы. Нечитаемый текст сохраняется —
 *  нормализатор положит его в `extra`. */
function parseJsonOrNull(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { rawProfileJson: json };
  }
}

function rowToCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    bookId: r.book_id,
    canonicalName: r.canonical_name,
    profile: normalizeCharacterProfile(parseJsonOrNull(r.profile_json)),
    revision: r.revision ?? 0,
    hiddenFromPrompts: r.hidden_from_prompts === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToRelationship(r: RelationshipRow): Relationship {
  return {
    id: r.id,
    bookId: r.book_id,
    fromCharacterId: r.from_character_id,
    toCharacterId: r.to_character_id,
    type: r.type,
    tension: r.tension,
    notes: r.notes,
    profile: normalizeRelationshipProfile(parseJsonOrNull(r.profile_json)),
    revision: r.revision ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToVoiceSample(r: CharacterVoiceSampleRow): CharacterVoiceSample {
  return {
    id: r.id,
    bookId: r.book_id,
    characterId: r.character_id,
    text: r.text,
    situation: r.situation as VoiceSampleSituation,
    addresseeCharacterId: r.addressee_character_id,
    note: r.note,
    origin: r.origin as VoiceSampleOrigin,
    status: r.status as VoiceSampleStatus,
    sourceVersionId: r.source_version_id,
    sourceChapterOrder: r.source_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CharacterKnowledge {
  fact: string;
  acquisition: string;
  source: string | null;
  canonFactId: number | null;
  disprovedFromChapterOrder: number | null;
}

export interface CharacterContext {
  character: Character;
  knowledge: CharacterKnowledge[];
}

export interface CharacterAgentResult {
  characters: CharacterContext[];
  relationships: Relationship[];
  /** Принятые образцы речи всех участников, в стабильном порядке. */
  voiceSamples: CharacterVoiceSample[];
  /** Эпизодические состояния персонажей. */
  states: ActiveState[];
}

/**
 * Чтение знаний и состояний на границе сцены. Передаётся снаружи, а не
 * делается здесь: эти запросы уже живут в сервере вместе со своими тестами
 * (`loadKnowledgeAtBoundary`, `loadActiveStates`), а `packages/agents` до
 * `apps/server` не дотягивается. Второй экземпляр той же SQL разошёлся бы с
 * первым на первой же правке — и разошёлся бы молча, потому что именно этот
 * путь идёт в Писателя.
 *
 * Аргумент ОБЯЗАТЕЛЕН, хотя `null` и разрешён. Необязательный он означал бы,
 * что четвёртый вызывающий, забывший его передать, молча теряет все знания и
 * состояния: ни ошибки типов, ни падения теста, ни видимой разницы в промпте.
 * `null` передаётся осознанно и значит «знаний в этом контексте нет».
 */
export interface CharacterBoundaryReaders {
  knowledge(characterId: number): CharacterKnowledge[];
  states(characterIds: number[]): ActiveState[];
}

// Detect characters mentioned in any of the provided text blobs by canonical
// name substring match (case-insensitive). `alwaysIncludeIds` covers protagonist/POV.
export function gatherCharacterContext(
  sqlite: DatabaseType,
  bookId: number,
  texts: Array<string | null | undefined>,
  alwaysIncludeIds: number[] = [],
  readers: CharacterBoundaryReaders | null,
): CharacterAgentResult {
  // «Глазок» (заимствование из litrab.ai): герой, снятый автором с запросов,
  // в скан участников не попадает. Это ЕДИНСТВЕННОЕ место фильтра — все роли
  // (Писатель, критики, правка, inline, замысел сцены) идут через эту функцию.
  // `alwaysIncludeIds` фильтр обходит: POV назван в плане автором явно.
  const allCharacters = sqlite
    .prepare("SELECT * FROM characters WHERE book_id = ? AND hidden_from_prompts = 0")
    .all(bookId) as CharacterRow[];
  if (allCharacters.length === 0 && alwaysIncludeIds.length === 0) {
    return { characters: [], relationships: [], voiceSamples: [], states: [] };
  }

  // Поиск участников — по основе имени и границам слова (С2 ревью
  // 2026-09-19). Подстрочное сравнение находило «Ян» в «январе», а «Анну»
  // при герое «Анна» не находило вовсе: в косвенном падеже имя встречается
  // чаще, чем в именительном.
  const blob = texts.filter(Boolean).join("\n");
  const mentioned = new Set<number>(alwaysIncludeIds);
  for (const c of allCharacters) {
    if (!c.canonical_name) continue;
    if (mentionsEntityName(blob, c.canonical_name)) mentioned.add(c.id);
  }
  if (mentioned.size === 0) {
    return { characters: [], relationships: [], voiceSamples: [], states: [] };
  }

  const ids = [...mentioned];
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT * FROM characters WHERE id IN (${placeholders}) ORDER BY canonical_name ASC`,
    )
    .all(...ids) as CharacterRow[];

  const characters: CharacterContext[] = rows.map((r) => {
    const knowledge = readers ? readers.knowledge(r.id) : [];
    return {
      character: rowToCharacter(r),
      knowledge,
    };
  });

  const rels = sqlite
    .prepare(
      `SELECT * FROM relationships
       WHERE book_id = ?
         AND (from_character_id IN (${placeholders}) OR to_character_id IN (${placeholders}))`,
    )
    .all(bookId, ...ids, ...ids) as RelationshipRow[];

  const voiceRows = sqlite
    .prepare(
      `SELECT * FROM character_voice_samples
       WHERE character_id IN (${placeholders}) AND status = 'accepted'
       ORDER BY id ASC`,
    )
    .all(...ids) as CharacterVoiceSampleRow[];

  const states = readers ? readers.states(ids) : [];

  return {
    characters,
    relationships: rels.map(rowToRelationship),
    voiceSamples: voiceRows.map(rowToVoiceSample),
    states,
  };
}

/** Печатает группу полей профиля одной строкой: «- Метка: подпись — значение;
 *  подпись — значение». Пустые поля и пустые группы не печатаются вовсе:
 *  заголовок без значений читается как утверждение «у героя этого нет». */
function renderProfileGroup(
  label: string,
  group: Record<string, unknown> | undefined,
  labels: Record<string, string>,
): string | null {
  if (!group) return null;
  const parts: string[] = [];
  for (const [key, caption] of Object.entries(labels)) {
    const value = group[key];
    if (typeof value === "string" && value.trim().length > 0) {
      parts.push(`${caption} — ${value.trim()}`);
    }
  }
  return parts.length > 0 ? `- ${label}: ${parts.join("; ")}` : null;
}

const STRATEGY_LABELS = {
  asks: "просит",
  refuses: "отказывает",
  defends: "защищается",
  persuades: "убеждает",
  cares: "заботится",
  argues: "спорит",
} as const;

const EVERYDAY_LABELS = {
  attachments: "дорожит",
  pleasure: "радует",
  irritation: "раздражает",
  habits: "привычки",
  humour: "юмор",
} as const;

const PERCEPTION_LABELS = {
  noticesFirst: "замечает первым",
  misses: "не видит",
  explainsBy: "объясняет через",
} as const;

const VOICE_PROFILE_LABELS = {
  lineLength: "длина реплик",
  pauses: "паузы",
  vocabulary: "лексика",
  abstractness: "отвлечённость",
  jargon: "профессиональное",
  agrees: "соглашается",
  refuses: "отказывает",
  asks: "просит",
  cares: "смягчается",
  irritated: "в раздражении",
  humour: "шутит",
  selfCensorship: "о чём молчит",
  tabooTopics: "не обсуждает",
  underStress: "под ударом",
  whenTired: "устав",
  whenSafe: "в безопасности",
} as const;

const AUTHOR_PLAN_LABELS = {
  arc: "арка",
  futureTrials: "впереди",
  constraints: "чего не делать",
} as const;

export function characterContextToPrompt(
  result: CharacterAgentResult,
  charNameById: Map<number, string>,
  options?: {
    situation?: VoiceSampleSituation;
    addresseeCharacterId?: number | null;
    chapterOrder?: number | null;
    /** План автора на героя — замысел, а не факт книги. Писателю он нужен,
     *  критику нет: тот судит написанное, а не намерение (С3). */
    includeAuthorPlan?: boolean;
  },
): string {
  if (result.characters.length === 0) return "";
  const lines: string[] = ["## Персонажи в сцене"];
  // Правило приехало из отдельного блока «Известно POV-персонажу», который
  // рисовал те же события из той же границы вторым списком и платился дважды
  // из одного бюджета. Оно общее — верно для каждого героя, а не только для
  // POV, — но печатается ТОЛЬКО если хоть у кого-то список есть: иначе оно
  // утверждает, что герой не знает ничего, тогда как знаний просто не
  // собрано.
  if (result.characters.some((cc) => cc.knowledge.length > 0)) {
    lines.push(
      "Под «Знает» — то, что герой знает К НАЧАЛУ сцены. Думать и говорить как своё он может только это; остального он ещё не знает, даже если это правда. У героя без такого списка знания не собраны — это не значит, что он не знает ничего.",
    );
  }

  const samplesFor = (characterId: number) =>
    result.voiceSamples.filter((s) => s.characterId === characterId);

  const statesFor = (characterId: number) =>
    result.states.filter((s) => s.subjectCharacterId === characterId);

  for (const ctx of result.characters) {
    const c = ctx.character;
    lines.push(`### ${c.canonicalName}`);
    lines.push(`- Описание: ${c.profile.description}`);
    if (c.profile.want) lines.push(`- Хочет: ${c.profile.want}`);
    if (c.profile.need) lines.push(`- Нуждается: ${c.profile.need}`);
    if (c.profile.lie) lines.push(`- Самообман: ${c.profile.lie}`);
    if (c.profile.voice) lines.push(`- Голос/манера: ${c.profile.voice}`);
    if (c.profile.appearance)
      lines.push(`- Внешность: ${c.profile.appearance}`);
    // Поля V2 (С3 ревью 2026-09-19). Они лежали в базе с этапа 2, но до
    // промпта не доходили ни одно: карточка печатала шесть полей V1, и
    // индивидуальность, ради которой этап затевался, модели не сообщалась.
    if (c.profile.role) lines.push(`- Роль в истории: ${c.profile.role}`);
    if (c.profile.age) lines.push(`- Возраст: ${c.profile.age}`);
    if (c.profile.background) lines.push(`- Откуда: ${c.profile.background}`);
    if (c.profile.goals.length > 0) {
      lines.push("- Цели:");
      for (const g of c.profile.goals) {
        const tail = [
          g.horizon === "long" ? "долгая" : null,
          g.conflictsWith ? `спорит с: ${g.conflictsWith}` : null,
        ].filter(Boolean);
        lines.push(`  · ${g.goal}${tail.length > 0 ? ` (${tail.join("; ")})` : ""}`);
      }
    }
    if (c.profile.values.length > 0) {
      lines.push(`- Ценности: ${c.profile.values.map((v) => v.value).join("; ")}`);
    }
    if (c.profile.principles.length > 0) {
      lines.push("- Принципы (и чего стоит их держать):");
      for (const pr of c.profile.principles) {
        lines.push(`  · ${pr.rule}${pr.cost ? ` — цена: ${pr.cost}` : ""}`);
      }
    }
    if (c.profile.contradictions.length > 0) {
      lines.push(`- Противоречия: ${c.profile.contradictions.join("; ")}`);
    }
    for (const line of [
      renderProfileGroup("Как ведёт себя", c.profile.strategies, STRATEGY_LABELS),
      renderProfileGroup("Быт", c.profile.everyday, EVERYDAY_LABELS),
      renderProfileGroup("Как видит мир", c.profile.perception, PERCEPTION_LABELS),
      renderProfileGroup("Голос", c.profile.voiceProfile, VOICE_PROFILE_LABELS),
    ]) {
      if (line !== null) lines.push(line);
    }
    const registers = c.profile.voiceProfile?.registers ?? {};
    const registerParts = Object.entries(registers)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k, v]) => `${VOICE_SITUATION_LABELS[k as VoiceSampleSituation] ?? k} — ${v}`);
    if (registerParts.length > 0) {
      lines.push(`- Регистры речи: ${registerParts.join("; ")}`);
    }
    if (options?.includeAuthorPlan !== false) {
      const plan = renderProfileGroup("План автора", c.profile.authorPlan, AUTHOR_PLAN_LABELS);
      if (plan !== null) lines.push(plan);
    }
    if (ctx.knowledge.length > 0) {
      lines.push("- Знает:");
      for (const k of ctx.knowledge) {
        const acqLabel = ACQUISITION_LABELS[k.acquisition as keyof typeof ACQUISITION_LABELS] || "";
        const sourceLabel = k.source ? k.source : null;
        const tail = [acqLabel, sourceLabel].filter(Boolean).join(", ");
        lines.push(`  · ${k.fact}${tail ? ` (${tail})` : ""}`);
      }
    }

    const myStates = statesFor(c.id);
    if (myStates.length > 0) {
      lines.push("- Сейчас с ним:");
      for (const s of myStates) {
        const notes: string[] = [];
        // Давнее состояние подписывается главой, чтобы Писатель не принял его
        // за нынешнее. Номер — порядковый, а не `order_index`.
        if (s.certainty === "stale" && s.observedAtChapterOrder !== null) {
          notes.push(`наблюдалось в главе ${s.observedAtChapterOrder}`);
        } else if (s.certainty === "stale") {
          notes.push("наблюдалось давно");
        }
        // Условие завершения — половина смысла эпизодического состояния
        // (AC-34): без него «устала» читается как черта характера.
        // Условие подставляется как есть, без «до тех пор, пока»: значение
        // свободное, и канонический пример плана — «пока Сарек не ответит»,
        // который дал бы «до тех пор, пока пока Сарек не ответит».
        if (s.endCondition) notes.push(`держится: ${s.endCondition}`);
        lines.push(`  · ${s.state}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`);
      }
    }

    const mine = selectVoiceSamples(samplesFor(c.id), {
      situation: options?.situation ?? "neutral",
      addresseeCharacterId: options?.addresseeCharacterId ?? null,
      excludeFromChapterOrder: options?.chapterOrder ?? null,
    });
    if (mine.length > 0) {
      lines.push("- Образцы речи (диапазон, не образец для копирования):");
      for (const s of mine) {
        lines.push(`  · [${VOICE_SITUATION_LABELS[s.situation]}] ${s.text}`);
      }
    }
  }
  if (result.relationships.length > 0) {
    lines.push("\n## Отношения");
    for (const r of result.relationships) {
      const from = charNameById.get(r.fromCharacterId) ?? `#${r.fromCharacterId}`;
      const to = charNameById.get(r.toCharacterId) ?? `#${r.toCharacterId}`;
      lines.push(
        // Подпись по-русски: в русском промпте «tension: -0.90» — единственная
        // английская строка, и модель читала её как служебную разметку.
        `- ${from} → ${to}: ${r.type} (напряжение: ${r.tension.toFixed(2)})${
          r.notes ? ` — ${r.notes}` : ""
        }`,
      );
      for (const key of Object.keys(RELATIONSHIP_QUALITY_LABELS) as RelationshipQualityKey[]) {
        const value = r.profile[key];
        if (typeof value === "string" && value.trim()) {
          const label = RELATIONSHIP_QUALITY_LABELS[key];
          lines.push(`  · ${label}: ${value}`);
        }
      }
      if (Array.isArray(r.profile.disputes) && r.profile.disputes.length > 0) {
        lines.push(`  · разногласия: ${r.profile.disputes.join(", ")}`);
      }
      if (Array.isArray(r.profile.silences) && r.profile.silences.length > 0) {
        lines.push(`  · умолчания: ${r.profile.silences.join(", ")}`);
      }
    }
  }
  return lines.join("\n");
}
