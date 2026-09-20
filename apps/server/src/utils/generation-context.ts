import { chapterPositionLookup } from "./chapter-position.js";
import type { VoiceSampleSituation } from "@book-forge/shared";
import type { Database as DatabaseType } from "better-sqlite3";
import { boundaryForChapter } from "@book-forge/shared";
import {
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
} from "@book-forge/agents";
import { loadEventsAtBoundary, makeCharacterBoundaryReaders } from "./character-events.js";
import { renderActiveFactsPrompt } from "./book-facts.js";
import { gatherRelevantNotes, renderOpenNotesPrompt } from "./book-notes.js";
import { loadStudioContext, studioContextToPrompt } from "./studio-context.js";
import { loadStyleContext, type StyleContext } from "./style-context.js";
import {
  loadPreviousChapterTailWithOrder,
  loadRollingChapterContext,
} from "./rolling-context.js";
import { gatherRetrievedChunks } from "./chapter-retrieval.js";
import {
  compileContext,
  describeCompiledContext,
  MAX_PROSE_CONTEXT_TOKENS,
  type CompiledContext,
} from "./context-compiler.js";
import { resolveEntityDetailed } from "./entity-resolve.js";
import { loadBookContext } from "./book-context.js";
import type { BookRow, ChapterRow } from "../db/rows.js";

/**
 * Этап 4 ТЗ индивидуальности — ОДНА сборка контекста для Writer, критиков и
 * Reviser'а (раздел 8.1). До неё было две: Writer собирал историю сводками,
 * хвостом и поиском, критика — срезом первых 1200 символов каждой главы; в
 * одной студийный контекст был обрезаемой секцией, в другой — частью
 * неотрезаемого блока; премиса в одной выводилась из замысла, в другой
 * читалась сырой колонкой. Роли по-прежнему получают разные ПРЕДСТАВЛЕНИЯ
 * (что сканировать, чем искать, сколько стилевых образцов), но база у них
 * одна — и отсюда же берутся ссылки на источники для отпечатка.
 */

export interface AssembleContextArgs {
  book: BookRow;
  chapter: ChapterRow;
  hasVec: boolean;
  /** Тексты, по которым ищутся участники и предметы: у Writer — план и
   *  беат-лист, у критики — сам текст главы. Название, премиса, outline и
   *  история добавляются здесь сами. */
  scanTexts: Array<string | null | undefined>;
  /** Запрос поиска по прозе ранних глав. */
  retrievalQuery: string;
  /** Имя POV из плана; резолвится в id и входит в участники всегда. */
  povName: string | null;
  /** Стилевых образцов в промпте: Writer — по умолчанию, критикам — 0, иначе
   *  они ловили бы совпадения с образцом вместо стиля. */
  styleFewShot?: number;
  /** Запрос по открытым линиям (заметкам); null — не собирать. */
  notesQuery?: string | null;
  /**
   * Где кончается канон для этой сборки (В7 ревью 2026-09-19).
   *
   * `at_chapter` (по умолчанию) — вместе с фактами и заметками самой главы.
   * Так нужно критике: она проверяет главу против того, что глава же и
   * утверждает.
   *
   * `before_chapter` — строго до неё. Так нужно Писателю и планировщику: у
   * главы может быть уже принятая версия, и её факты — это утверждения
   * текста, который автор сейчас переписывает. Подавать их как действующий
   * канон значит заставить новую версию повторить старую.
   */
  factsBoundary?: "at_chapter" | "before_chapter";
  /** Регистр диалога сцены из плана главы. По нему отбираются образцы речи;
   *  без него берутся нейтральные, и в допрос ехала бытовая болтовня (С3). */
  dialogueRegister?: VoiceSampleSituation | null;
  /** План автора на героя — замысел, а не факт книги. Писателю он нужен,
   *  критике нет: та судит написанное. */
  includeAuthorPlan?: boolean;
  budgetTokens?: number;
  /** Подпись для инспектора контекста в логе. */
  label: string;
}

export interface ContextSourceRefLite {
  kind:
    | "chapter_version"
    | "character"
    | "relationship"
    | "style_profile"
    | "outline"
    | "event";
  id: number;
  versionId: number | null;
  revision: number | null;
}

export interface AssembledContext {
  /** Каноническое имя POV, если оно разрешилось; иначе имя из плана. */
  pov: string;
  povCharacterId: number | null;
  /** Имена, которые резолвер не смог привязать однозначно: два героя с
   *  одним именем. Не угадываются — отдаются наверх (раздел 8.2). */
  ambiguousNames: string[];
  /** Название, премиса (выведенная, как у Writer), выбранный outline. */
  bookContextBase: string;
  /** Карточки участников + действующие факты. Обязательная секция. */
  characterContext: string | null;
  /** Кто в сцене: тот же состав, из которого собраны карточки. Наружу он
   *  нужен замыслу сцены (решения приходят по `characterId`) и критику
   *  персонажей (он не запускается на монологе). Второй поиск участников
   *  завести нельзя — он разошёлся бы с карточками молча. */
  participants: Array<{ characterId: number; name: string }>;
  loreContext: string | null;
  studioContext: string | null;
  previousChapters: string | null;
  previousTail: string | null;
  retrieval: string | null;
  /** Открытые линии; не бюджетируется — только критикам и планировщику. */
  notesPrompt: string | null;
  styleContext: StyleContext;
  compiled: CompiledContext;
  sourceRefs: ContextSourceRefLite[];
}

/** FNV-1a: детерминированный 32-битный отпечаток строки, чтобы outline без
 *  собственной ревизии всё же попадал в ссылки на источники. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export async function assembleGenerationContext(
  sqlite: DatabaseType,
  args: AssembleContextArgs,
): Promise<AssembledContext> {
  const { book, chapter: ch, hasVec } = args;
  const budget = args.budgetTokens ?? MAX_PROSE_CONTEXT_TOKENS;

  // Премиса — выведенная из замысла, когда колонка пуста: так делал Writer,
  // а критика читала сырую колонку и получала «(не задана)».
  const bookCtx = loadBookContext(sqlite, book.id);
  const title = bookCtx?.title ?? book.title;
  const premise = bookCtx?.premise ?? book.premise ?? "(премиса не задана)";
  const outlineSelected = bookCtx?.outlineSelected ?? null;

  // История — теми же тремя функциями и в том же порядке для всех ролей.
  // Один справочник позиций на всю сборку: номера глав в промпте должны
  // быть порядковыми, а не разрежёнными `order_index` (С4).
  const positionOf = chapterPositionLookup(sqlite, book.id);
  const rolling = loadRollingChapterContext(sqlite, book.id, ch.order_index, {
    positionOf,
  });
  const tailRow = loadPreviousChapterTailWithOrder(sqlite, book.id, ch.order_index);
  const retrieved = await gatherRetrievedChunks(sqlite, {
    bookId: book.id,
    queryText: args.retrievalQuery,
    currentChapterOrder: ch.order_index,
    hasVec,
    // Дословно подана ровно одна глава — та, чей хвост едет отдельным
    // блоком; её фрагменты повторение. Остальным окно даёт пересказ, и
    // деталь, не попавшая в него, достаётся только поиском (AC-12).
    verbatimChapterOrders: tailRow ? [tailRow.chapterOrder] : [],
    positionOf,
  });

  // POV — отдельным идентификатором, а не надеждой на совпадение имени в
  // тексте: план может звать героя псевдонимом, а резолвер знает псевдонимы.
  // Два героя с одним именем — неоднозначность, которую решает автор, а не
  // случайный выбор первого.
  const ambiguousNames: string[] = [];
  let povCharacterId: number | null = null;
  let pov = args.povName ?? "—";
  if (args.povName) {
    const r = resolveEntityDetailed(sqlite, book.id, "character", args.povName);
    if (r.status === "resolved") {
      povCharacterId = r.entity.entityId;
      pov = r.entity.canonicalName;
    } else if (r.status === "ambiguous") {
      ambiguousNames.push(args.povName);
    }
  }

  // Состав сцены ищется по СЦЕНЕ, а не по книге (С1 ревью 2026-09-19).
  // Прежде сюда входили весь выбранный аутлайн и все пересказы прошлых глав,
  // поэтому участником каждой сцены оказывался почти каждый герой книги — с
  // карточкой, знаниями и событиями, в обязательном слое, который нельзя
  // урезать. На тридцати главах это и переполняло бюджет, а сообщение
  // «сократите состав сцены» автор выполнить не мог: состав он не задавал.
  // Намерение главы, её беат-лист (или её текст у критики), название,
  // премиса и POV — то, что про сцену и есть.
  const scanTexts = [
    ch.intent,
    title,
    premise,
    pov,
    ...args.scanTexts,
    // Хвост предыдущей главы — часть этой же сцены: герой, действующий в
    // продолжающемся эпизоде, может быть не назван в беат-листе, и без
    // этого его карточка пропадала. Пересказы всей книги сюда по-прежнему
    // не идут — именно они и раздували состав (С1).
    tailRow?.text ?? null,
  ];
  const boundary = boundaryForChapter(book.id, ch.id, ch.current_version_id ?? null);
  const charResult = gatherCharacterContext(
    sqlite,
    book.id,
    scanTexts,
    povCharacterId !== null ? [povCharacterId] : [],
    makeCharacterBoundaryReaders(sqlite, boundary),
  );
  const charNameById = new Map(
    charResult.characters.map((cc) => [cc.character.id, cc.character.canonicalName]),
  );
  const characterCards =
    charResult.characters.length > 0
      ? characterContextToPrompt(charResult, charNameById, {
          chapterOrder: ch.order_index,
          ...(args.dialogueRegister ? { situation: args.dialogueRegister } : {}),
          ...(args.includeAuthorPlan !== undefined
            ? { includeAuthorPlan: args.includeAuthorPlan }
            : {}),
        })
      : null;
  const loreResult = gatherLoreContext(sqlite, book.id, scanTexts, ch.order_index);
  const loreContext =
    loreResult.locations.length > 0 ||
    loreResult.items.length > 0 ||
    loreResult.openHooks.length > 0
      ? loreContextToPrompt(loreResult)
      : null;

  // Действующие факты канона — рядом с карточками участников: это часть
  // обязательного слоя, а не фон книги. Критик канона сверяет главу с
  // разделом «Персонажи», и факты должны лежать там же.
  const factEntityNames = [
    ...charResult.characters.map((cc) => cc.character.canonicalName),
    ...loreResult.locations.map((l) => l.name),
    ...loreResult.items.map((i) => i.name),
  ];
  // Разрежённая нумерация (шаг 10) делает `order - 1` точным «строго до»:
  // между соседними главами других номеров не бывает.
  const factsOrder =
    args.factsBoundary === "before_chapter"
      ? Math.max(0, ch.order_index - 1)
      : ch.order_index;
  // Заголовок блока называет главу, для которой собран контекст, а не
  // границу канона: `factsOrder` у Писателя — это `order_index - 1`, номера
  // главы с таким индексом в книге нет, и `positionOf` вернул бы `null` —
  // в промпте рядом со строками «с главы 3» печаталось «#29».
  const factsLabelOrder = ch.order_index;
  const factsPrompt = renderActiveFactsPrompt(
    sqlite,
    book.id,
    factsOrder,
    {
      ...(factEntityNames.length > 0 ? { entityNames: factEntityNames } : {}),
      positionOf,
      headingOrder: factsLabelOrder,
    },
  );
  const characterContext =
    factsPrompt !== null
      ? `${characterCards ? `${characterCards}\n\n` : ""}${factsPrompt}`
      : characterCards;

  const studioContext = studioContextToPrompt(loadStudioContext(sqlite, book.id));
  const styleContext = loadStyleContext(
    sqlite,
    book.style_profile_id,
    ...(args.styleFewShot !== undefined ? [args.styleFewShot] : []),
  );
  const notesPrompt = args.notesQuery
    ? renderOpenNotesPrompt(
        await gatherRelevantNotes(sqlite, book.id, args.notesQuery, factsOrder),
        "Открытые линии",
        factsOrder,
        { positionOf, headingOrder: factsLabelOrder },
      )
    : null;

  const bookContextLines = [`Название: "${title}"`, `Премиса: ${premise}`];
  if (outlineSelected) bookContextLines.push(`Outline:\n${outlineSelected}`);

  // Один бюджет и одни приоритеты для всех ролей (раздел 8.4). Обязательный
  // слой — участники с их знаниями, обещаниями и фактами; при переполнении
  // вызывающий отказывает, а не пишет без ограничений.
  const compiled = compileContext(
    [
      { id: "characters", text: characterContext, priority: 1, required: true },
      { id: "prevTail", text: tailRow?.text ?? null, priority: 2 },
      { id: "rolling", text: rolling, priority: 2 },
      { id: "lore", text: loreContext, priority: 3 },
      // Поиск по прошлым главам и стиль — выше принятых разделов Мастерской
      // (С6). Мир и лор автор задал один раз и читает сам; поиск отвечает за
      // непротиворечивость деталей, а стилевые образцы — за голос, и
      // вытеснять их большой «библией» значит терять ровно то, за чем
      // Писателя и зовут.
      { id: "retrieval", text: retrieved.promptBlock, priority: 4 },
      { id: "style", text: styleContext.prompt, priority: 5 },
      { id: "studio", text: studioContext, priority: 6 },
    ],
    { maxTokens: budget },
  );
  console.warn(describeCompiledContext(compiled, args.label));
  const inc = new Set(compiled.includedIds);

  // Ссылки на источники — сырьё для отпечатка. Считаются по БАЗЕ КНИГИ на
  // этой границе, а не по тому, что попало в карточки: Writer сканирует
  // план, критика — текст главы, и глава, введя героя, которого в плане не
  // было, давала бы разные наборы карточек при той же базе. Отпечаток по
  // карточкам кричал бы «база уехала» на каждой второй главе, и автор
  // перестал бы ему верить. Всё перечисленное версионировано или
  // ревизионировано, поэтому текст промпта хранить не нужно.
  const sourceRefs: ContextSourceRefLite[] = [];
  const prevVersions = sqlite
    .prepare(
      `SELECT id, current_version_id FROM chapters
       WHERE book_id = ? AND order_index < ? AND current_version_id IS NOT NULL
       ORDER BY order_index ASC`,
    )
    .all(book.id, ch.order_index) as Array<{ id: number; current_version_id: number }>;
  for (const p of prevVersions) {
    sourceRefs.push({ kind: "chapter_version", id: p.id, versionId: p.current_version_id, revision: null });
  }
  const allCharacters = sqlite
    .prepare("SELECT id, revision FROM characters WHERE book_id = ? ORDER BY id")
    .all(book.id) as Array<{ id: number; revision: number }>;
  for (const c of allCharacters) {
    sourceRefs.push({ kind: "character", id: c.id, versionId: null, revision: c.revision });
  }
  const allRelationships = sqlite
    .prepare("SELECT id, revision FROM relationships WHERE book_id = ? ORDER BY id")
    .all(book.id) as Array<{ id: number; revision: number }>;
  for (const r of allRelationships) {
    sourceRefs.push({ kind: "relationship", id: r.id, versionId: null, revision: r.revision });
  }
  // События всех героев на границе сцены — та же SQL границы, что у карточек.
  for (const e of loadEventsAtBoundary(sqlite, allCharacters.map((c) => c.id), boundary)) {
    sourceRefs.push({ kind: "event", id: e.id, versionId: null, revision: null });
  }
  if (book.style_profile_id !== null) {
    sourceRefs.push({ kind: "style_profile", id: book.style_profile_id, versionId: null, revision: null });
  }
  if (outlineSelected) {
    sourceRefs.push({ kind: "outline", id: book.id, versionId: null, revision: hash32(outlineSelected) });
  }

  return {
    pov,
    povCharacterId,
    participants: charResult.characters.map((cc) => ({
      characterId: cc.character.id,
      name: cc.character.canonicalName,
    })),
    ambiguousNames,
    bookContextBase: bookContextLines.join("\n"),
    characterContext: inc.has("characters") ? characterContext : null,
    loreContext: inc.has("lore") ? loreContext : null,
    studioContext: inc.has("studio") ? studioContext : null,
    previousChapters: inc.has("rolling") ? rolling : null,
    previousTail: inc.has("prevTail") ? (tailRow?.text ?? null) : null,
    retrieval: inc.has("retrieval") ? retrieved.promptBlock : null,
    notesPrompt,
    styleContext: {
      prompt: inc.has("style") ? styleContext.prompt : null,
      fatigueBlacklist: styleContext.fatigueBlacklist,
    },
    compiled,
    sourceRefs,
  };
}
