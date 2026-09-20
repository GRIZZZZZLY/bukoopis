import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CriticInput } from "../../critics/base.js";

const runCanonGuard = vi.hoisted(() => vi.fn());
const runStyleAgent = vi.hoisted(() => vi.fn());
const runEditorAgent = vi.hoisted(() => vi.fn());
const runReaderExperienceAgent = vi.hoisted(() => vi.fn());
const runCharacterCritic = vi.hoisted(() => vi.fn());

vi.mock("../../critics/index.js", () => ({
  runCanonGuard,
  runStyleAgent,
  runEditorAgent,
  runReaderExperienceAgent,
  runCharacterCritic,
}));

const { runCritique } = await import("../critique.js");

/**
 * Пятый критик (этап 5). Проверяется не он сам, а то, что граф перестал
 * предполагать фиксированное число критиков: агрегация собирает отчёты
 * списком, статус считается от запрошенных, и невыполненный критик не
 * превращается в зелёный отчёт.
 */

const input = { chapterText: "текст" } as unknown as CriticInput;

function report(critic: string, severity: "blocking" | "nit" = "nit") {
  return {
    critic,
    overallNotes: "заметки",
    issues: [{ severity, summary: "замечание" }],
  };
}

beforeEach(() => {
  for (const m of [
    runCanonGuard,
    runStyleAgent,
    runEditorAgent,
    runReaderExperienceAgent,
    runCharacterCritic,
  ]) {
    m.mockReset();
  }
});

describe("runCritique — критик персонажей", () => {
  it("запускается, когда его запросили, и попадает в отчёт", async () => {
    runCharacterCritic.mockResolvedValue(report("character"));
    const { report: out } = await runCritique({
      input,
      enabledCritics: ["character"],
    });
    expect(runCharacterCritic).toHaveBeenCalledOnce();
    expect(out.critics.map((c) => c.critic)).toEqual(["character"]);
    expect(out.requestedCritics).toEqual(["character"]);
  });

  it("не запускается, когда его не просили", async () => {
    runStyleAgent.mockResolvedValue(report("style"));
    await runCritique({ input, enabledCritics: ["style"] });
    expect(runCharacterCritic).not.toHaveBeenCalled();
  });

  it("его падение не уносит остальных и попадает в список упавших", async () => {
    runStyleAgent.mockResolvedValue(report("style"));
    runCharacterCritic.mockRejectedValue(new Error("таймаут"));
    const { report: out } = await runCritique({
      input,
      enabledCritics: ["style", "character"],
    });
    expect(out.critics.map((c) => c.critic)).toEqual(["style"]);
    expect(out.failedCritics).toEqual(["character"]);
  });

  it("его замечания входят в общий счёт по серьёзности", async () => {
    runCharacterCritic.mockResolvedValue(report("character", "blocking"));
    const { report: out } = await runCritique({
      input,
      enabledCritics: ["character"],
    });
    expect(out.blockingCount).toBe(1);
  });

  it("набор по умолчанию включает всех пятерых", async () => {
    for (const [m, name] of [
      [runCanonGuard, "canon"],
      [runStyleAgent, "style"],
      [runEditorAgent, "editor"],
      [runReaderExperienceAgent, "reader"],
      [runCharacterCritic, "character"],
    ] as const) {
      m.mockResolvedValue(report(name));
    }
    const { report: out } = await runCritique({ input });
    expect(out.requestedCritics).toHaveLength(5);
    expect(out.critics).toHaveLength(5);
  });
});
