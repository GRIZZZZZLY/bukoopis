import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBackend, resolveBackendForCall } from "../router.js";

describe("resolveBackend default map", () => {
  beforeEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });
  afterEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });

  it("writer → subscription", () => {
    expect(resolveBackend("writer")).toBe("subscription");
  });
  it("editor → subscription", () => {
    expect(resolveBackend("editor")).toBe("subscription");
  });
  it("summarizer → subscription (etap 0.2.3)", () => {
    expect(resolveBackend("summarizer")).toBe("subscription");
  });
  it("plot_outline → api", () => {
    expect(resolveBackend("plot_outline")).toBe("api");
  });
  it("plot_chapter_plan → api", () => {
    expect(resolveBackend("plot_chapter_plan")).toBe("api");
  });
  it("critic_canon → api", () => {
    expect(resolveBackend("critic_canon")).toBe("api");
  });
  // Проход по фразам — часть критика стиля: без своей записи идёт его путём.
  it("critic_style_phrase follows critic_style unless set explicitly", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_style: "subscription" });
    expect(resolveBackend("critic_style_phrase")).toBe("subscription");
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_style: "subscription", critic_style_phrase: "api" });
    expect(resolveBackend("critic_style_phrase")).toBe("api");
    delete process.env.LLM_AGENT_BACKEND_MAP;
    expect(resolveBackend("critic_style_phrase")).toBe("api");
  });
  it("canon_guard → api", () => {
    expect(resolveBackend("canon_guard")).toBe("api");
  });
});

describe("resolveBackend env override", () => {
  beforeEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });
  afterEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });

  it("env override flips writer → api", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
    expect(resolveBackend("writer")).toBe("api");
  });
  it("ignores unknown agent names in env map", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ bogus: "subscription" });
    expect(resolveBackend("plot_outline")).toBe("api");
  });
  it("ignores invalid backend values in env map", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "magic" });
    expect(resolveBackend("writer")).toBe("subscription");
  });
  it("ignores malformed JSON in env map", () => {
    process.env.LLM_AGENT_BACKEND_MAP = "not json";
    expect(resolveBackend("writer")).toBe("subscription");
  });
});

describe("resolveBackendForCall semantics", () => {
  beforeEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });
  afterEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });

  it("hasOutputSchema=true preserves agent default (subscription) — etap 0.2.4 dropped the hard-rule", () => {
    expect(
      resolveBackendForCall({
        agentName: "writer",
        provider: "anthropic",
        hasOutputSchema: true,
      }),
    ).toBe("subscription");
  });
  it("ollama provider coerces writer (subscription default) to api", () => {
    expect(
      resolveBackendForCall({
        agentName: "writer",
        provider: "ollama",
        hasOutputSchema: false,
      }),
    ).toBe("api");
  });
  it("anthropic + no schema preserves writer → subscription default", () => {
    expect(
      resolveBackendForCall({
        agentName: "writer",
        provider: "anthropic",
        hasOutputSchema: false,
      }),
    ).toBe("subscription");
  });
  it("env override + ollama still coerces to api", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "subscription" });
    expect(
      resolveBackendForCall({
        agentName: "writer",
        provider: "ollama",
        hasOutputSchema: false,
      }),
    ).toBe("api");
  });
  it("env flipping writer to api takes effect on no-schema call", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
    expect(
      resolveBackendForCall({
        agentName: "writer",
        provider: "anthropic",
        hasOutputSchema: false,
      }),
    ).toBe("api");
  });
});
