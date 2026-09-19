import type { Database as DatabaseType } from "better-sqlite3";
import {
  boundaryForChapter,
  chapterClosingSchema,
  extractNarrativeArchitecture,
  renderChapterClosing,
  renderNarrativeArchitecture,
} from "@book-forge/shared";
import {
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
} from "@book-forge/agents";
import { makeCharacterBoundaryReaders } from "./character-events.js";
import { renderActiveFactsPrompt } from "./book-facts.js";
import { gatherRelevantNotes, renderOpenNotesPrompt } from "./book-notes.js";
import { loadStudioContext, studioContextToPrompt } from "./studio-context.js";
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
import type { BookRow, ChapterRow } from "../db/rows.js";

/**
 * The prose context a chapter's critics and the Reviser both work from.
 *
 * Critique and repair used to assemble this twice, in two copies of the same
 * ~90 lines in one file. That is not merely duplication: a field added for the
 * critics silently failed to reach the Reviser (the narrative architecture
 * sheet was missed exactly this way), so repair could undo a structural
 * decision it never saw. One function, both call sites.
 *
 * История книги здесь — ТА ЖЕ, что у Writer (AC-36): сводки по рубежам,
 * дословный финал предыдущей главы, найденные фрагменты, один и тот же
 * бюджет. Прежде критика собирала её сама: первые 1200 символов КАЖДОЙ
 * предыдущей главы, без сводок, без хвоста, без поиска — глава писалась с
 * одной памятью, а критиковалась и правилась с другой.
 */
export interface ChapterProseContext {
  /** POV of the accepted beat-sheet, or "—" when no plan is selected. */
  pov: string;
  emotionalGoal: string;
  /** Rendered beats of the accepted plan variant, closing decision included. */
  beatSheet: string | null;
  /** Selected outline variant as JSON — the shape the prose agents receive. */
  outlineSelected: string | null;
  /** Narrative architecture sheet of that variant, rendered in Russian. */
  architectureContext: string | null;
  /** Сводки по рубежам + окно последних глав — то, что видит Writer. */
  previousChaptersSummary: string | null;
  /** Финал предыдущей главы дословно. */
  previousChapterTail: string | null;
  /** Найденные фрагменты ранних глав. */
  retrievedContext: string | null;
  characterContext: string | null;
  loreContext: string | null;
  /** Premise + outline + studio + active facts + open threads. */
  bookContext: string;
  /** Что вошло в бюджет и что выпало; `requiredOverflow` — сигнал отказа. */
  compiled: CompiledContext;
}

interface PlanVariantLite {
  pov: string;
  emotionalGoal: string;
  beats?: Array<{
    index?: number;
    type: string;
    summary: string;
    goal: string;
    conflict: string;
    outcome: string;
  }>;
  closing?: unknown;
}

/**
 * Render the accepted plan variant's beats in the same shape Writer uses, so
 * Editor/Reviser see the exact beat list the chapter was written against. The
 * closing decision rides along: repair is where a deliberate cut-mid-action
 * ending would otherwise be "fixed" into a tidy resolution.
 */
export function renderBeatSheetBlock(v: PlanVariantLite): string | null {
  if (!v.beats || v.beats.length === 0) return null;
  const beats = v.beats
    .map(
      (b, i) =>
        `${(b.index ?? i) + 1}. [${b.type}] ${b.summary}\n   Цель: ${b.goal}\n   Конфликт: ${b.conflict}\n   Исход: ${b.outcome}`,
    )
    .join("\n\n");
  const closing = chapterClosingSchema.safeParse(v.closing);
  return closing.success
    ? `${beats}\n\nФинал главы: ${renderChapterClosing(closing.data)}`
    : beats;
}

function selectedOutlineJson(book: BookRow): string | null {
  if (!book.outline_json) return null;
  try {
    const o = JSON.parse(book.outline_json) as {
      variants: unknown[];
      selectedIndex: number | null;
    };
    if (o.selectedIndex !== null && o.variants[o.selectedIndex]) {
      return JSON.stringify(o.variants[o.selectedIndex]);
    }
  } catch {
    /* ignore corrupt outline */
  }
  return null;
}

export async function loadChapterProseContext(
  sqlite: DatabaseType,
  book: BookRow,
  ch: ChapterRow,
  chapterText: string,
  opts: { hasVec: boolean },
): Promise<ChapterProseContext> {
  const outlineSelected = selectedOutlineJson(book);
  const architecture = extractNarrativeArchitecture(outlineSelected);

  let pov = "—";
  let emotionalGoal = "—";
  let beatSheet: string | null = null;
  if (ch.plan_json) {
    try {
      const p = JSON.parse(ch.plan_json) as {
        variants: Array<PlanVariantLite>;
        selectedIndex: number | null;
      };
      if (p.selectedIndex !== null && p.variants[p.selectedIndex]) {
        const sel = p.variants[p.selectedIndex]!;
        pov = sel.pov;
        emotionalGoal = sel.emotionalGoal;
        beatSheet = renderBeatSheetBlock(sel);
      }
    } catch {
      /* ignore corrupt plan */
    }
  }

  // История — теми же функциями, что у Writer, и в том же порядке.
  const rolling = loadRollingChapterContext(sqlite, book.id, ch.order_index);
  const tailRow = loadPreviousChapterTailWithOrder(sqlite, book.id, ch.order_index);
  const retrieved = await gatherRetrievedChunks(sqlite, {
    bookId: book.id,
    // Запрос — план главы, как у Writer, а не весь её текст: искать надо то,
    // с чем глава должна сходиться, а не то, что она уже сказала.
    queryText: beatSheet ?? `${ch.title}\n${emotionalGoal}`,
    currentChapterOrder: ch.order_index,
    hasVec: opts.hasVec,
    verbatimChapterOrders: tailRow ? [tailRow.chapterOrder] : [],
  });

  const contextTexts = [
    ch.intent,
    book.title,
    book.premise,
    outlineSelected,
    pov,
    emotionalGoal,
    chapterText,
    rolling,
  ];
  const boundary = boundaryForChapter(book.id, ch.id, ch.current_version_id);
  const charResult = gatherCharacterContext(
    sqlite,
    book.id,
    contextTexts,
    [],
    makeCharacterBoundaryReaders(sqlite, boundary),
  );
  const charNameById = new Map(
    charResult.characters.map((cc) => [
      cc.character.id,
      cc.character.canonicalName,
    ]),
  );
  const characterContext =
    charResult.characters.length > 0
      ? characterContextToPrompt(charResult, charNameById, { chapterOrder: ch.order_index })
      : null;
  const loreResult = gatherLoreContext(
    sqlite,
    book.id,
    contextTexts,
    ch.order_index,
  );
  const loreContext =
    loreResult.locations.length > 0 ||
    loreResult.items.length > 0 ||
    loreResult.openHooks.length > 0
      ? loreContextToPrompt(loreResult)
      : null;

  const bookContextLines: string[] = [
    `Название: "${book.title}"`,
    `Премиса: ${book.premise ?? "(не задана)"}`,
  ];
  if (outlineSelected) bookContextLines.push(`Outline:\n${outlineSelected}`);
  const baseBookContext = bookContextLines.join("\n");
  const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, book.id));
  // Phase 3: feed temporal canon facts to the Canon Guard critic so it can
  // flag contradictions against what is *currently* true.
  const factEntityNames = [
    ...charResult.characters.map((cc) => cc.character.canonicalName),
    ...loreResult.locations.map((l) => l.name),
    ...loreResult.items.map((i) => i.name),
  ];
  const factsPrompt = renderActiveFactsPrompt(
    sqlite,
    book.id,
    ch.order_index,
    factEntityNames.length > 0 ? { entityNames: factEntityNames } : undefined,
  );
  // Phase 4: surface relevant open threads/foreshadowing so the
  // Reader-Experience critic can flag forgotten payoffs.
  const relevantNotes = await gatherRelevantNotes(
    sqlite,
    book.id,
    `${ch.title}\n${emotionalGoal}`,
    ch.order_index,
  );
  const notesPrompt = renderOpenNotesPrompt(
    relevantNotes,
    "Открытые линии",
    ch.order_index,
  );
  const bookContext = `${baseBookContext}${
    studioCtx ? `\n\n${studioCtx}` : ""
  }${factsPrompt ? `\n\n${factsPrompt}` : ""}${
    notesPrompt ? `\n\n${notesPrompt}` : ""
  }`;

  // Тот же бюджет и те же приоритеты, что у Writer. Расхождение одно и
  // названо: у критиков студийный контекст едет внутри bookContext, а не
  // отдельной обрезаемой секцией — это уравнивается извлечением общей
  // сборки (задача 4 плана этапа 4).
  const compiled = compileContext(
    [
      { id: "characters", text: characterContext, priority: 1, required: true },
      { id: "prevTail", text: tailRow?.text ?? null, priority: 2 },
      { id: "rolling", text: rolling, priority: 2 },
      { id: "lore", text: loreContext, priority: 3 },
      { id: "retrieval", text: retrieved.promptBlock, priority: 5 },
    ],
    { maxTokens: MAX_PROSE_CONTEXT_TOKENS },
  );
  console.warn(describeCompiledContext(compiled, `prose ch#${ch.order_index}`));
  const inc = new Set(compiled.includedIds);

  return {
    pov,
    emotionalGoal,
    beatSheet,
    outlineSelected,
    architectureContext: architecture
      ? renderNarrativeArchitecture(architecture)
      : null,
    previousChaptersSummary: inc.has("rolling") ? rolling : null,
    previousChapterTail: inc.has("prevTail") ? (tailRow?.text ?? null) : null,
    retrievedContext: inc.has("retrieval") ? retrieved.promptBlock : null,
    characterContext: inc.has("characters") ? characterContext : null,
    loreContext: inc.has("lore") ? loreContext : null,
    bookContext,
    compiled,
  };
}
