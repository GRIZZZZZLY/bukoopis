import { describe, it, expect } from "vitest";
import {
  AGENT_NAMES,
  STRUCTURED_AGENT_NAMES,
  getAgentContract,
  listRegisteredAgents,
  type AgentName,
} from "@book-forge/llm";
import { registerAllAgentContracts } from "../bootstrap.js";
import { CHAT_SYSTEM } from "../chat.js";
import { CHAPTER_SUMMARY_SYSTEM } from "../summarize-chapter.js";
import { META_SUMMARY_SYSTEM } from "../meta-summarizer.js";
import {
  AUTHOR_FACING_LANGUAGE_RULES,
  LANGUAGE_RULE_EXEMPT,
  checkLanguageRuleCoverage,
} from "../language-rules.js";

/** Агенты со свободным текстом не регистрируют контракт: их промпты — здесь.
 *  Новый такой агент без записи тут или в LANGUAGE_RULE_EXEMPT валит страж. */
const FREE_TEXT_PROMPTS: Partial<Record<AgentName, readonly string[]>> = {
  book_chat: [CHAT_SYSTEM],
  summarizer: [CHAPTER_SUMMARY_SYSTEM, META_SUMMARY_SYSTEM],
};

function systemPromptsOf(name: string): readonly string[] {
  const free = FREE_TEXT_PROMPTS[name as AgentName];
  if (free) return free;
  const agent = name as AgentName;
  if (STRUCTURED_AGENT_NAMES.has(agent) && listRegisteredAgents().includes(agent)) {
    return [getAgentContract(agent).systemPrompt];
  }
  return [];
}

describe("language rule guard", () => {
  it("every agent carries the language rule or has a stated exemption", () => {
    registerAllAgentContracts();
    expect(checkLanguageRuleCoverage(AGENT_NAMES, systemPromptsOf, LANGUAGE_RULE_EXEMPT)).toEqual(
      [],
    );
  });

  it("unknown agent fails the guard", () => {
    registerAllAgentContracts();
    const problems = checkLanguageRuleCoverage(
      [...AGENT_NAMES, "made_up_agent"],
      systemPromptsOf,
      LANGUAGE_RULE_EXEMPT,
    );
    expect(problems).toEqual(["made_up_agent: no language rule and no exemption reason"]);
  });

  it("rejects an agent that both carries the rule and is exempt, and an unknown exempt key", () => {
    const problems = checkLanguageRuleCoverage(
      ["a"],
      () => [`промпт\n${AUTHOR_FACING_LANGUAGE_RULES}`],
      { a: "reason", ghost: "reason" },
    );
    expect(problems).toEqual([
      "a: carries the language rule and is also listed as exempt",
      "ghost: listed as exempt but is not a known agent",
    ]);
  });

  it("an empty reason is no exemption", () => {
    expect(checkLanguageRuleCoverage(["a"], () => [], { a: "  " })).toEqual([
      "a: no language rule and no exemption reason",
    ]);
  });
});
