import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { StageAspect } from "@book-forge/shared";

vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/variants", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents/aspects/variants")>()),
  runAspectVariants: vi.fn(),
}));

import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectVariants } from "@book-forge/agents/aspects/variants";
import { createStudioRepository } from "../../db/studio.js";
import { runQuickStart } from "../quick-start-run.js";

/** В12 независимого ревью 2026-09-19: список разделов пишется до генерации
 *  вариантов (осознанно — иначе пятиминутное ожидание с упавшим бэкендом
 *  кончалось пустотой). Но если варианты не собрались, этап оставался с
 *  пустыми заголовками, а повторный сбор его ПРОПУСКАЛ: «здесь уже есть
 *  черновики». Автор оставался с именами разделов и без содержимого. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let repo: ReturnType<typeof createStudioRepository>;
let bookId: number;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "quick-start-resume-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare(
        `INSERT INTO books (title, premise, concept, created_at, updated_at)
         VALUES ('Книга', 'Премиса', ?, ?, ?)`,
      )
      .run(
        JSON.stringify({
          schemaVersion: 1,
          idea: "Замысел",
          pitches: [],
          premise: { logline: "Логлайн" },
          audience: "adult",
        }),
        NOW,
        NOW,
      ).lastInsertRowid,
  );
  repo = createStudioRepository(sqlite);
  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectVariants).mockReset();
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

function seedPendingOnlyStage(): void {
  const state = repo.loadStudioState(bookId);
  const aspects: StageAspect[] = [
    {
      id: "a1",
      name: "география",
      status: "pending",
      order: 0,
      required: true,
      source: "llm",
      payloadKind: "markdown",
      variants: [],
    },
  ];
  repo.patchStudioState(bookId, {
    expectedRevision: state.revision,
    next: {
      ...state,
      stages: {
        ...state.stages,
        world: { status: "in_progress", playbookGenerated: true, aspects },
      },
    },
  });
}

describe("повторный быстрый сбор (В12)", () => {
  it("догенерирует разделы, оставшиеся без вариантов", async () => {
    seedPendingOnlyStage();
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "география", description: "рельеф", required: true, payloadKind: "markdown" },
      ],
    } as never);
    vi.mocked(runAspectVariants).mockResolvedValue({
      variants: [{ label: "вариант", payload: "текст раздела" }],
    } as never);

    const res = await runQuickStart({ sqlite, hasVec: false, repo, bookId }, {});

    const world = res.stages.filter((s) => s.stageId === "world");
    expect(world.some((s) => s.status === "skipped")).toBe(false);
    const state = repo.loadStudioState(bookId);
    const aspect = state.stages.world?.aspects[0];
    expect(aspect?.variants.length).toBeGreaterThan(0);
    expect(aspect?.status).toBe("reviewing");
  });

  it("этап с уже собранными вариантами пропускается по-прежнему", async () => {
    const state = repo.loadStudioState(bookId);
    repo.patchStudioState(bookId, {
      expectedRevision: state.revision,
      next: {
        ...state,
        stages: {
          ...state.stages,
          world: {
            status: "in_progress",
            playbookGenerated: true,
            aspects: [
              {
                id: "a1",
                name: "география",
                status: "reviewing",
                order: 0,
                required: true,
                source: "llm",
                payloadKind: "markdown",
                variants: [
                  {
                    id: "v1",
                    label: "вариант",
                    payloadKind: "markdown",
                    payload: "текст",
                    status: "generated",
                    editSource: "llm",
                    generatedAt: NOW,
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const res = await runQuickStart({ sqlite, hasVec: false, repo, bookId }, {});

    expect(res.stages.some((s) => s.stageId === "world" && s.status === "skipped")).toBe(true);
    expect(vi.mocked(runAspectPlaybook)).not.toHaveBeenCalledWith(
      expect.objectContaining({ stageId: "world" }),
    );
  });
});
