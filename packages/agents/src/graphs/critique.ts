import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  runCanonGuard,
  runStyleAgent,
  runEditorAgent,
  runReaderExperienceAgent,
  type CriticInput,
} from "../critics/index.js";
import type {
  CriticReport,
  CriticType,
  FullCritiqueReport,
} from "@book-forge/shared";

const CritiqueState = Annotation.Root({
  input: Annotation<CriticInput>(),
  enabledCritics: Annotation<CriticType[]>({
    reducer: (_, n) => n,
    default: () => ["canon", "style", "editor", "reader"],
  }),
  canonReport: Annotation<CriticReport | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  styleReport: Annotation<CriticReport | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  editorReport: Annotation<CriticReport | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  readerReport: Annotation<CriticReport | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  errors: Annotation<Array<{ critic: CriticType; message: string }>>({
    reducer: (curr, n) => [...curr, ...n],
    default: () => [],
  }),
  aggregated: Annotation<FullCritiqueReport | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});

type StateT = typeof CritiqueState.State;

function makeCriticNode(
  critic: CriticType,
  fn: (input: CriticInput) => Promise<CriticReport>,
  field: "canonReport" | "styleReport" | "editorReport" | "readerReport",
) {
  return async (state: StateT): Promise<Partial<StateT>> => {
    if (!state.enabledCritics.includes(critic)) return {};
    try {
      const report = await fn(state.input);
      return { [field]: report } as Partial<StateT>;
    } catch (e) {
      return {
        errors: [
          { critic, message: e instanceof Error ? e.message : String(e) },
        ],
      };
    }
  };
}

const canonNode = makeCriticNode("canon", runCanonGuard, "canonReport");
const styleNode = makeCriticNode("style", runStyleAgent, "styleReport");
const editorNode = makeCriticNode("editor", runEditorAgent, "editorReport");
const readerNode = makeCriticNode(
  "reader",
  runReaderExperienceAgent,
  "readerReport",
);

async function aggregateNode(state: StateT): Promise<Partial<StateT>> {
  const reports: CriticReport[] = [
    state.canonReport,
    state.styleReport,
    state.editorReport,
    state.readerReport,
  ].filter((r): r is CriticReport => r !== null);

  let blocking = 0;
  let suggestion = 0;
  let nit = 0;
  for (const r of reports) {
    for (const i of r.issues) {
      if (i.severity === "blocking") blocking++;
      else if (i.severity === "suggestion") suggestion++;
      else nit++;
    }
  }

  return {
    aggregated: {
      critics: reports,
      blockingCount: blocking,
      suggestionCount: suggestion,
      nitCount: nit,
      generatedAt: new Date().toISOString(),
    },
  };
}

const builder = new StateGraph(CritiqueState)
  .addNode("canon", canonNode)
  .addNode("style", styleNode)
  .addNode("editor", editorNode)
  .addNode("reader", readerNode)
  .addNode("aggregate", aggregateNode)
  // Fan-out: START → all 4 critics in parallel
  .addEdge(START, "canon")
  .addEdge(START, "style")
  .addEdge(START, "editor")
  .addEdge(START, "reader")
  // Fan-in: all 4 → aggregate
  .addEdge("canon", "aggregate")
  .addEdge("style", "aggregate")
  .addEdge("editor", "aggregate")
  .addEdge("reader", "aggregate")
  .addEdge("aggregate", END);

export const critiqueGraph = builder.compile();

export interface RunCritiqueOptions {
  input: CriticInput;
  enabledCritics?: CriticType[];
}

export interface RunCritiqueResult {
  report: FullCritiqueReport;
  errors: Array<{ critic: CriticType; message: string }>;
}

export async function runCritique(
  opts: RunCritiqueOptions,
): Promise<RunCritiqueResult> {
  const result = await critiqueGraph.invoke({
    input: opts.input,
    enabledCritics: opts.enabledCritics ?? [
      "canon",
      "style",
      "editor",
      "reader",
    ],
  });
  if (!result.aggregated) {
    throw new Error("critique aggregation failed");
  }
  return { report: result.aggregated, errors: result.errors };
}
