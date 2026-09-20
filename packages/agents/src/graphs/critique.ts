import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  runCanonGuard,
  runStyleAgent,
  runEditorAgent,
  runReaderExperienceAgent,
  runCharacterCritic,
  type CriticInput,
} from "../critics/index.js";
import {
  ALL_CRITIC_TYPES,
  type CriticReport,
  type CriticType,
  type FullCritiqueReport,
} from "@book-forge/shared";

/**
 * Граф критики. Отчёты копятся СПИСКОМ, а не именованными полями по числу
 * критиков: пятый критик (персонажи, этап 5) добавлялся бы иначе правкой в
 * четырёх местах, а агрегация, перечисляющая поля, молча теряла бы того, кого
 * забыли дописать. ТЗ раздела 10 требует этого прямо — «не предполагать
 * фиксированное число критиков».
 */

const CritiqueState = Annotation.Root({
  input: Annotation<CriticInput>(),
  enabledCritics: Annotation<CriticType[]>({
    reducer: (_, n) => n,
    default: () => [...ALL_CRITIC_TYPES],
  }),
  reports: Annotation<CriticReport[]>({
    reducer: (curr, n) => [...curr, ...n],
    default: () => [],
  }),
  skippedCritics: Annotation<CriticType[]>({
    reducer: (_, n) => n,
    default: () => [],
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
) {
  return async (state: StateT): Promise<Partial<StateT>> => {
    if (!state.enabledCritics.includes(critic)) return {};
    try {
      return { reports: [await fn(state.input)] };
    } catch (e) {
      return {
        errors: [
          { critic, message: e instanceof Error ? e.message : String(e) },
        ],
      };
    }
  };
}

/** Один список на всё: узлы, рёбра и порядок отчётов. Добавить критика =
 *  дописать строку здесь. */
const CRITIC_NODES: ReadonlyArray<{
  critic: CriticType;
  run: (input: CriticInput) => Promise<CriticReport>;
}> = [
  { critic: "canon", run: runCanonGuard },
  { critic: "style", run: runStyleAgent },
  { critic: "editor", run: runEditorAgent },
  { critic: "reader", run: runReaderExperienceAgent },
  { critic: "character", run: runCharacterCritic },
];

async function aggregateNode(state: StateT): Promise<Partial<StateT>> {
  // Порядок отчётов — порядок критиков, а не порядок, в котором они успели
  // ответить: иначе панель перетасовывалась бы от прогона к прогону.
  const order = new Map(CRITIC_NODES.map((n, i) => [n.critic, i]));
  const reports = [...state.reports].sort(
    (a, b) => (order.get(a.critic) ?? 0) - (order.get(b.critic) ?? 0),
  );

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
      requestedCritics: state.enabledCritics,
      failedCritics: state.errors.map((e) => e.critic),
      skippedCritics: state.skippedCritics,
      blockingCount: blocking,
      suggestionCount: suggestion,
      nitCount: nit,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** StateGraph меняет свой тип на каждом `addNode`, и цикл по списку критиков
 *  им не типизируется. Одно сужение здесь честнее, чем пять руками
 *  переписанных узлов: список критиков должен жить в одном месте. */
interface CriticGraphBuilder {
  addNode(name: string, fn: (s: StateT) => Promise<Partial<StateT>>): CriticGraphBuilder;
  addEdge(from: string, to: string): CriticGraphBuilder;
  compile(): { invoke(s: Partial<StateT>): Promise<StateT> };
}

function buildGraph() {
  let builder = new StateGraph(CritiqueState).addNode(
    "aggregate",
    aggregateNode,
  ) as unknown as CriticGraphBuilder;
  for (const node of CRITIC_NODES) {
    builder = builder
      .addNode(node.critic, makeCriticNode(node.critic, node.run))
      .addEdge(START, node.critic)
      .addEdge(node.critic, "aggregate");
  }
  return builder.addEdge("aggregate", END);
}

export const critiqueGraph = buildGraph().compile();

export interface RunCritiqueOptions {
  input: CriticInput;
  enabledCritics?: CriticType[];
  /** Кого не запускали по условию сцены. Граф их не зовёт, но обязан
   *  донести до отчёта: пропуск — не успех. */
  skippedCritics?: CriticType[];
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
    // Список по умолчанию — один на проект (`ALL_CRITIC_TYPES`). Копия из
    // четырёх имён здесь и была тем местом, где пятый критик не появился бы
    // никогда.
    enabledCritics: opts.enabledCritics ?? [...ALL_CRITIC_TYPES],
    skippedCritics: opts.skippedCritics ?? [],
  });
  if (!result.aggregated) {
    throw new Error("critique aggregation failed");
  }
  return { report: result.aggregated, errors: result.errors };
}
