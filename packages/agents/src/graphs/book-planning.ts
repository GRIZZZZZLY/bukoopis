import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  generateBookOutline,
  type GenerateBookOutlineInput,
} from "../plot.js";
import type { BookOutlineVariant } from "@book-forge/shared";

const BookPlanningState = Annotation.Root({
  input: Annotation<GenerateBookOutlineInput>(),
  variants: Annotation<BookOutlineVariant[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  error: Annotation<string | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});

export type BookPlanningStateType = typeof BookPlanningState.State;

async function plotNode(
  state: BookPlanningStateType,
): Promise<Partial<BookPlanningStateType>> {
  try {
    const variants = await generateBookOutline(state.input);
    return { variants };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const builder = new StateGraph(BookPlanningState)
  .addNode("plot", plotNode)
  .addEdge(START, "plot")
  .addEdge("plot", END);

export const bookPlanningGraph = builder.compile();

export async function runBookPlanning(
  input: GenerateBookOutlineInput,
): Promise<BookOutlineVariant[]> {
  const result = await bookPlanningGraph.invoke({ input });
  if (result.error) throw new Error(result.error);
  return result.variants;
}
