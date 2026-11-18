/**
 * Живая проверка главы: `pnpm live:chapter --book <id> --chapter <id>`.
 *
 * Пишет главу нашей моделью через настоящие маршруты сервера, собранного в
 * этом же процессе на КОПИИ базы, и меряет результат: сцены, слова, лицо
 * повествования, повторы. Это скрипт, а не тест: он зовёт живую модель
 * (и Claude один раз с `--scene-plan`).
 *
 * База автора не пишется никогда: источник открывается только на чтение и
 * копируется `backup()` в папку отчёта, всё остальное идёт по копии.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import type { Hono } from "hono";
import { registerAllAgentContracts } from "@book-forge/agents/bootstrap";
import {
  registerStyleExtractorContract,
  registerStyleBlenderContract,
} from "@book-forge/style-engine";
import { assertAllStructuredAgentsHaveContracts } from "@book-forge/llm";
import { createApp, type AppHandle } from "../app.js";
import { resolveDbPath } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { configureEmbeddingProvider } from "../utils/embedding-setup.js";
import { preserveDraftAsVersion } from "../utils/chapter-drafts.js";
import { loadPreviousChapterTail } from "../utils/rolling-context.js";
import {
  judgeLiveRun,
  measureChapter,
  plural,
  stopLabel,
  type LiveMetrics,
} from "../utils/live-metrics.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface LiveOptions {
  bookId: number;
  chapterId: number | null;
  newTitle: string | null;
  intent: string | null;
  model: string | null;
  saveDrafts: boolean;
  scenePlan: boolean;
  db: string;
  out: string;
}

export interface LiveDeps {
  log: (line: string) => void;
}

export interface LiveReport {
  options: LiveOptions;
  chapterId: number | null;
  modelId: string | null;
  proposal: { status: string; stopReason: string | null } | null;
  savedDrafts: number;
  metrics: LiveMetrics | null;
  failures: string[];
  warnings: string[];
  timings: {
    totalMs: number;
    scenePlanMs: number | null;
    writeMs: number | null;
    scenesMs: number[];
  };
}

const USAGE = [
  "Живая проверка главы на копии базы.",
  "  pnpm live:chapter --book <id> --chapter <id>",
  "  pnpm live:chapter --book <id> --new-title <название> (--intent <текст> | --intent-file <путь>)",
  "Ещё: --model <тег Ollama>  --save-drafts  --scene-plan  --db <путь к базе>  --out <папка отчёта>",
].join("\n");

class ArgError extends Error {}
/** Отказ, который идёт в отчёт как есть: его текст уже для автора. */
class LiveFailure extends Error {}

function positiveId(name: string, v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ArgError(`${name} ждёт номер, получено «${v}».`);
  return n;
}

/** Относительные пути — от папки, где автор набрал команду (pnpm кладёт её в INIT_CWD). */
export function parseLiveArgs(
  argv: string[],
  base: string = process.env.INIT_CWD ?? process.cwd(),
): LiveOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        book: { type: "string" },
        chapter: { type: "string" },
        "new-title": { type: "string" },
        intent: { type: "string" },
        "intent-file": { type: "string" },
        model: { type: "string" },
        "save-drafts": { type: "boolean" },
        "scene-plan": { type: "boolean" },
        db: { type: "string" },
        out: { type: "string" },
      },
    }));
  } catch (e) {
    throw new ArgError(`Не разобрать аргументы: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (values.book === undefined) throw new ArgError("Нужен --book <номер книги>.");
  const newTitle = values["new-title"] ?? null;
  if (values.chapter !== undefined && newTitle !== null) {
    throw new ArgError("Укажите что-то одно: --chapter или --new-title.");
  }
  if (values.chapter === undefined && newTitle === null) {
    throw new ArgError("Нужна глава: --chapter <номер> или --new-title <название> с --intent.");
  }
  if (values.intent !== undefined && values["intent-file"] !== undefined) {
    throw new ArgError("Укажите что-то одно: --intent или --intent-file.");
  }
  let intent = values.intent ?? null;
  if (values["intent-file"] !== undefined) {
    const path = resolve(base, values["intent-file"]);
    try {
      intent = readFileSync(path, "utf8");
    } catch {
      throw new ArgError(`Не прочитать файл содержания: ${path}`);
    }
  }
  if (newTitle !== null && !intent?.trim()) {
    throw new ArgError("К --new-title нужно содержание: --intent <текст> или --intent-file <путь>.");
  }
  if (newTitle === null && intent !== null) {
    throw new ArgError("--intent и --intent-file работают только с --new-title.");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    bookId: positiveId("--book", values.book),
    chapterId: values.chapter === undefined ? null : positiveId("--chapter", values.chapter),
    newTitle,
    intent,
    model: values.model ?? null,
    saveDrafts: values["save-drafts"] ?? false,
    scenePlan: values["scene-plan"] ?? false,
    db: values.db === undefined ? resolveDbPath() : resolve(base, values.db),
    out:
      values.out === undefined
        ? resolve(REPO_ROOT, "data/live-checks", stamp)
        : resolve(base, values.out),
  };
}

export async function liveChapterMain(argv: string[], deps: LiveDeps): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("--help") || args.includes("-h")) {
    deps.log(USAGE);
    return 0;
  }
  let options: LiveOptions;
  try {
    options = parseLiveArgs(args);
  } catch (e) {
    if (!(e instanceof ArgError)) throw e;
    deps.log(e.message);
    deps.log(USAGE);
    return 2;
  }
  return (await runLiveChapter(options, deps)).exitCode;
}

// ───────── Копия и подготовка ─────────

/**
 * Черновик без версии становится версией — в том же виде, что хранит
 * продукт (`preserveDraftAsVersion`), — и черновик снимается. Через маршрут
 * версий нельзя: он ставит задания памяти, а их исполнитель зовёт Claude.
 * Таблицы памяти не трогаются.
 */
function saveDraftsAsVersions(db: DatabaseType, bookId: number): number {
  const ids = (
    db
      .prepare(
        `SELECT c.id FROM chapters c JOIN chapter_drafts d ON d.chapter_id = c.id
         WHERE c.book_id = ? AND c.current_version_id IS NULL ORDER BY c.order_index`,
      )
      .all(bookId) as { id: number }[]
  ).map((r) => r.id);
  let saved = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (preserveDraftAsVersion(db, id) === null) continue;
      db.prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?").run(id);
      saved += 1;
    }
  })();
  return saved;
}

/** Приложение — как в production (`index.ts`): контракты агентов и фабрика. */
function buildApp(copyPath: string): AppHandle {
  registerAllAgentContracts();
  registerStyleExtractorContract();
  registerStyleBlenderContract();
  assertAllStructuredAgentsHaveContracts();
  // Переранжирование поиска — вызов Claude; в живой проверке модели зовут
  // только Писатель и, с `--scene-plan`, план сцен.
  delete process.env.RETRIEVAL_RERANK;
  const handle = createApp(copyPath);
  // Исполнитель памяти разбирал бы очередь копии (задания из базы автора) и
  // звал Claude. Останавливаем до первого запроса: `kick()` после `stop()`
  // ничего не запускает.
  handle.memoryWorker.stop();
  return handle;
}

// ───────── Маршруты ─────────

function call(app: Hono, path: string, method: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
      new Request(`http://live${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

async function serverMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: string; message?: string; details?: { message?: string } };
    return `сервер ответил ${res.status}: ${j.details?.message ?? j.message ?? j.error ?? text}`;
  } catch {
    return `сервер ответил ${res.status}: ${text}`;
  }
}

async function ok<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new LiveFailure(`${what}: ${await serverMessage(res)}`);
  return (await res.json()) as T;
}

/** Кадры SSE по мере прихода: `event:` и `data:` (JSON). */
async function readSse(res: Response, on: (event: string, data: unknown) => void): Promise<void> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const emit = (frame: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) on(event, JSON.parse(data.join("\n")));
  };
  for (;;) {
    const { done, value } = await reader.read();
    buf += done ? dec.decode() : dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      emit(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
    if (done) break;
  }
  if (buf.trim()) emit(buf);
}

type ProposalWire = {
  status: string;
  stopReason: string | null;
  modelId: string | null;
  contentText: string;
};

// ───────── Прогон ─────────

export async function runLiveChapter(
  o: LiveOptions,
  deps: LiveDeps,
): Promise<{ exitCode: number; report: LiveReport }> {
  const started = Date.now();
  mkdirSync(o.out, { recursive: true });
  const copyPath = join(o.out, "db.sqlite");
  const failures: string[] = [];
  const scenes: string[] = [];
  const scenesMs: number[] = [];
  let scenePlanMs: number | null = null;
  let writeMs: number | null = null;
  let chapterId = o.chapterId;
  let proposal: ProposalWire | null = null;
  let previousText: string | null = null;
  let savedDrafts = 0;
  let db: DatabaseType | null = null;
  let handle: AppHandle | null = null;

  try {
    // Источник только на чтение — запись в него невозможна даже по ошибке.
    let src: DatabaseType;
    try {
      src = new Database(o.db, { readonly: true, fileMustExist: true });
    } catch (e) {
      throw new LiveFailure(`Не открыть базу ${o.db}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await src.backup(copyPath);
    } finally {
      src.close();
    }
    runMigrations(copyPath);
    db = new Database(copyPath);
    db.pragma("foreign_keys = ON");

    if (!db.prepare("SELECT id FROM books WHERE id = ?").get(o.bookId)) {
      throw new LiveFailure(`Книги ${o.bookId} в базе нет.`);
    }
    if (o.model) {
      db.prepare(
        "UPDATE books SET writer_provider = 'ollama', writer_local_model = ? WHERE id = ?",
      ).run(o.model, o.bookId);
    }
    const writer = db
      .prepare("SELECT writer_provider, writer_local_model FROM books WHERE id = ?")
      .get(o.bookId) as { writer_provider: string; writer_local_model: string | null };
    if (writer.writer_provider !== "ollama" || !writer.writer_local_model) {
      throw new LiveFailure(
        "Писатель книги — не наша модель. Укажите --model <тег Ollama>, и проверка пойдёт на ней.",
      );
    }
    if (o.chapterId !== null) {
      const ch = db
        .prepare("SELECT id FROM chapters WHERE id = ? AND book_id = ?")
        .get(o.chapterId, o.bookId);
      if (!ch) throw new LiveFailure(`Главы ${o.chapterId} в книге ${o.bookId} нет.`);
    }
    if (o.saveDrafts) {
      savedDrafts = saveDraftsAsVersions(db, o.bookId);
      deps.log(`Черновиков сохранено версиями: ${savedDrafts}.`);
    }

    handle = buildApp(copyPath);
    const app = handle.app;

    if (o.newTitle !== null) {
      const created = await ok<{ id: number }>(
        await call(app, `/api/books/${o.bookId}/chapters`, "POST", { title: o.newTitle }),
        "Создание главы",
      );
      chapterId = created.id;
      await ok(
        await call(app, `/api/chapters/${chapterId}`, "PATCH", { intent: o.intent }),
        "Содержание главы",
      );
    }

    if (o.scenePlan) {
      deps.log("План сцен (Claude)…");
      const t0 = Date.now();
      const ch = await ok<{ scenePlan: unknown }>(
        await call(app, `/api/chapters/${chapterId}/scene-plan`, "POST", {}),
        "План сцен",
      );
      scenePlanMs = Date.now() - t0;
      writeFileSync(join(o.out, "scene-plan.json"), JSON.stringify(ch.scenePlan, null, 2));
    }

    const t0 = Date.now();
    const res = await call(app, `/api/chapters/${chapterId}/write`, "POST", {});
    if (!res.ok) throw new LiveFailure(`Писатель: ${await serverMessage(res)}`);
    let sceneStart = Date.now();
    let streamError: string | null = null;
    let cancelled = false;
    await readSse(res, (event, data) => {
      if (event === "beat") {
        const { index, total } = data as { index: number; total: number };
        if (scenes.length > 0) scenesMs.push(Date.now() - sceneStart);
        sceneStart = Date.now();
        scenes.push("");
        deps.log(`Сцена ${index + 1} из ${total}…`);
      } else if (event === "chunk") {
        if (scenes.length === 0) scenes.push("");
        scenes[scenes.length - 1] += (data as { text: string }).text;
      } else if (event === "done") {
        const d = data as { proposal?: ProposalWire; cancelled?: boolean };
        proposal = d.proposal ?? null;
        cancelled = d.cancelled === true;
      } else if (event === "error") {
        streamError = (data as { message?: string }).message ?? "без текста";
      }
    });
    if (scenes.length > 0) scenesMs.push(Date.now() - sceneStart);
    writeMs = Date.now() - t0;
    if (streamError !== null) failures.push(`Писатель остановился с ошибкой: ${streamError}`);
    else if (cancelled) failures.push("Генерацию отменили до конца главы.");
    else if (proposal === null) failures.push("Поток оборвался без итога: глава не дописана.");

    const order = db.prepare("SELECT order_index FROM chapters WHERE id = ?").get(chapterId) as
      | { order_index: number }
      | undefined;
    if (order) previousText = loadPreviousChapterTail(db, o.bookId, order.order_index, 200_000);
  } catch (e) {
    failures.push(
      e instanceof LiveFailure ? e.message : `Проверка упала: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    handle?.close();
    db?.close();
  }

  const metrics = scenes.length > 0 ? measureChapter({ scenes, previousChapterText: previousText }) : null;
  const done = proposal as ProposalWire | null;
  const judged =
    metrics && done
      ? judgeLiveRun({ metrics, proposalStatus: done.status, stopReason: done.stopReason })
      : { failures: [], warnings: [] };
  const report: LiveReport = {
    options: o,
    chapterId,
    modelId: done?.modelId ?? null,
    proposal: done ? { status: done.status, stopReason: done.stopReason } : null,
    savedDrafts,
    metrics,
    failures: [...failures, ...judged.failures],
    warnings: judged.warnings,
    timings: { totalMs: Date.now() - started, scenePlanMs, writeMs, scenesMs },
  };

  const chapterText = done?.contentText ?? scenes.map((s) => s.trim()).join("\n\n");
  writeFileSync(join(o.out, "chapter.txt"), chapterText);
  writeFileSync(join(o.out, "report.json"), JSON.stringify(report, null, 2));
  const md = renderReport(report);
  writeFileSync(join(o.out, "report.md"), md);
  deps.log(md);
  deps.log(`Отчёт и копия базы: ${o.out}`);
  return { exitCode: report.failures.length > 0 ? 1 : 0, report };
}

// ───────── Отчёт ─────────

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

const personName = (p: "first" | "third"): string => (p === "first" ? "первое" : "третье");

export function renderReport(r: LiveReport): string {
  const m = r.metrics;
  const rows: [string, string][] = [
    ["Сцен", String(m?.scenes.length ?? 0)],
    ["Слов", m ? `${m.words} ${plural(m.words, "слово", "слова", "слов")}` : "—"],
    ["Время записи главы", duration(r.timings.writeMs)],
    ...(r.timings.scenePlanMs !== null
      ? ([["Время плана сцен", duration(r.timings.scenePlanMs)]] as [string, string][])
      : []),
    ["Как закончилась", r.proposal ? `${stopLabel(r.proposal.stopReason)} (статус «${r.proposal.status}»)` : "не закончилась"],
    [
      "Лицо по сценам",
      m ? m.scenes.map((s, i) => `${i + 1} — ${personName(s.person)}`).join(", ") : "—",
    ],
    [
      "Лицо прошлой главы",
      !m ? "—" : m.previousPerson ? personName(m.previousPerson) : "прошлой главы нет",
    ],
    [
      "Самый частый повтор (6 слов)",
      !m
        ? "—"
        : m.repeat.count > 1
          ? `«${m.repeat.phrase}» — ${m.repeat.count} ${plural(m.repeat.count, "раз", "раза", "раз")}`
          : "повторов нет",
    ],
    ["Модель", r.modelId ?? r.options.model ?? "—"],
  ];
  const list = (items: string[]) => (items.length > 0 ? items.map((x) => `- ${x}`).join("\n") : "нет");
  return [
    "# Живая проверка главы",
    "",
    "| Показатель | Значение |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, "\\|")} |`),
    "",
    m ? `Манера главы, как её увидит следующая глава: ${m.manner.replace(/^Манера: /u, "")}.` : "",
    "",
    "## Сбои",
    list(r.failures),
    "",
    "## Предупреждения",
    list(r.warnings),
    "",
  ].join("\n");
}

// Запуск как скрипт. При импорте из тестов ничего не происходит.
const runAsScript =
  process.argv[1] !== undefined && /live-chapter\.(ts|js)$/.test(process.argv[1]);
if (runAsScript) {
  // Поиск по тексту — та же локальная модель векторов, что у сервера.
  configureEmbeddingProvider();
  liveChapterMain(process.argv.slice(2), { log: (l) => console.log(l) }).then(
    // Выход явный: ни таймер, ни пул ONNX, ни клиент модели не держат процесс.
    (code) => process.exit(code),
    (e) => {
      console.error(`Живая проверка упала: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
