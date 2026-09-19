import type { Database as DatabaseType } from "better-sqlite3";
import {
  chapterClosingSchema,
  renderChapterContract,
  extractNarrativeArchitecture,
  renderChapterClosing,
  renderNarrativeArchitecture,
} from "@book-forge/shared";
import {
  assembleGenerationContext,
  type AssembledContext,
} from "./generation-context.js";
import type { CompiledContext } from "./context-compiler.js";
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
 * С этапа 4 это тонкий адаптер над общей сборкой (`generation-context.ts`):
 * история, участники, факты и бюджет — те же, что у Writer (AC-36). Здесь
 * остаётся только то, что нужно именно критике: план главы в отрендеренном
 * виде, архитектурный лист и склейка `bookContext` в одну строку.
 */
export interface ChapterProseContext {
  /** POV of the accepted beat-sheet, or "—" when no plan is selected. */
  pov: string;
  emotionalGoal: string;
  /** Rendered beats of the accepted plan variant, closing decision included. */
  beatSheet: string | null;
  /** Контракт главы (слайс 4.5), отрендеренный тем же способом, что у
   *  Писателя: критик канона отличает по нему запланированную отмену факта
   *  от ошибки, редактор — невыполненное обязательство от выполненного. */
  chapterContract: string | null;
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
  /** Карточки участников + действующие факты. */
  characterContext: string | null;
  loreContext: string | null;
  /** Premise + outline + studio + open threads. Факты — в characterContext. */
  bookContext: string;
  /** Что вошло в бюджет и что выпало; `requiredOverflow` — сигнал отказа. */
  compiled: CompiledContext;
  /** Имена, которые резолвер не привязал однозначно (раздел 8.2). */
  ambiguousNames: string[];
  assembled: AssembledContext;
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
  contract?: import("@book-forge/shared").ChapterContract;
  dialogueRegister?: import("@book-forge/shared").VoiceSampleSituation;
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

  let planPov: string | null = null;
  let emotionalGoal = "—";
  let beatSheet: string | null = null;
  let chapterContract: string | null = null;
  let registerFromPlan: import("@book-forge/shared").VoiceSampleSituation | null = null;
  if (ch.plan_json) {
    try {
      const p = JSON.parse(ch.plan_json) as {
        variants: Array<PlanVariantLite>;
        selectedIndex: number | null;
      };
      if (p.selectedIndex !== null && p.variants[p.selectedIndex]) {
        const sel = p.variants[p.selectedIndex]!;
        planPov = sel.pov;
        emotionalGoal = sel.emotionalGoal;
        beatSheet = renderBeatSheetBlock(sel);
        chapterContract = sel.contract ? renderChapterContract(sel.contract) : null;
        registerFromPlan = sel.dialogueRegister ?? null;
      }
    } catch {
      /* ignore corrupt plan */
    }
  }

  // Критика сканирует сам текст главы (кто в нём есть), а ищет по плану —
  // тому, с чем глава должна сходиться, а не тому, что она уже сказала.
  const assembled = await assembleGenerationContext(sqlite, {
    book,
    chapter: ch,
    hasVec: opts.hasVec,
    scanTexts: [emotionalGoal, chapterText],
    retrievalQuery: beatSheet ?? `${ch.title}\n${emotionalGoal}`,
    povName: planPov,
    // Критик стиля судит по отпечатку; дословные образцы звали бы его искать
    // совпадения с ними, а не стиль.
    styleFewShot: 0,
    // План автора на героя — замысел, а не факт книги: критик судит
    // написанное, и «по плану она должна дойти до доверия» толкало бы его
    // требовать от главы того, чего в ней и не должно быть (С3).
    includeAuthorPlan: false,
    ...(registerFromPlan ? { dialogueRegister: registerFromPlan } : {}),
    notesQuery: `${ch.title}\n${emotionalGoal}`,
    label: `prose ch#${ch.order_index}`,
  });

  const bookContext = `${assembled.bookContextBase}${
    assembled.studioContext ? `\n\n${assembled.studioContext}` : ""
  }${assembled.notesPrompt ? `\n\n${assembled.notesPrompt}` : ""}`;

  return {
    pov: planPov === null ? "—" : assembled.pov,
    emotionalGoal,
    beatSheet,
    chapterContract,
    outlineSelected,
    architectureContext: architecture
      ? renderNarrativeArchitecture(architecture)
      : null,
    previousChaptersSummary: assembled.previousChapters,
    previousChapterTail: assembled.previousTail,
    retrievedContext: assembled.retrieval,
    characterContext: assembled.characterContext,
    loreContext: assembled.loreContext,
    bookContext,
    compiled: assembled.compiled,
    ambiguousNames: assembled.ambiguousNames,
    assembled,
  };
}
