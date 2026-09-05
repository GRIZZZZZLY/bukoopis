import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  generateChapterPlan,
  type GenerateChapterPlanInput,
} from "../plot.js";
import { writeChapter, type WriteChapterInput } from "../writer.js";
import type { ChapterBeatSheetVariant } from "@book-forge/shared";

// ─────────── Plan-only graph ───────────

const ChapterPlanState = Annotation.Root({
  input: Annotation<GenerateChapterPlanInput>(),
  variants: Annotation<ChapterBeatSheetVariant[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  error: Annotation<string | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});

export type ChapterPlanStateType = typeof ChapterPlanState.State;

async function planNode(
  state: ChapterPlanStateType,
): Promise<Partial<ChapterPlanStateType>> {
  try {
    const variants = await generateChapterPlan(state.input);
    return { variants };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const chapterPlanGraph = new StateGraph(ChapterPlanState)
  .addNode("plan", planNode)
  .addEdge(START, "plan")
  .addEdge("plan", END)
  .compile();

export async function runChapterPlan(
  input: GenerateChapterPlanInput,
): Promise<ChapterBeatSheetVariant[]> {
  const result = await chapterPlanGraph.invoke({ input });
  if (result.error) throw new Error(result.error);
  return result.variants;
}

// ─────────── Writer streaming wrapper (no graph — direct passthrough) ───────────

export async function* runChapterWriter(
  input: WriteChapterInput,
): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    stopReason: string | null;
    tokens: {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    };
  },
  void
> {
  const gen = writeChapter(input);
  while (true) {
    const next = await gen.next();
    if (next.done) return next.value;
    yield next.value;
  }
}
