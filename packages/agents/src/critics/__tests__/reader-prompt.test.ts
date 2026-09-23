import { describe, it, expect } from "vitest";
import { READER_CRITIC_SYSTEM } from "../reader.js";
import { CRITIC_CALIBRATION_RULE } from "../base.js";

// Discourse-level tells from the 2026-09-04 review that only a reader notices:
// the reflection tail, the predictable middle, one cadence for the whole
// chapter, the narrator explaining the theme.

describe("reader critic system prompt — discourse checks", () => {
  // Второй разбор прозы 2026-09-23: вопрос «можно ли пропустить абзац» делал
  // быт и паузы «лишними». Критик называет конкретное место, где трудно.
  it("asks for a concrete place where it is hard to follow, not believable, or repeated", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/трудно следить/);
    expect(READER_CRITIC_SYSTEM).toMatch(/не верится/);
    expect(READER_CRITIC_SYSTEM).toMatch(/повтор/);
    expect(READER_CRITIC_SYSTEM).not.toMatch(/можно ли пропустить абзац/);
  });

  it("does not treat calm or everyday detail as a defect", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/Не считай дефектами сами по себе: спокойствие/);
  });

  it("flags the narrator explaining meaning in words", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/нарратор объясняет смысл словами/i);
  });

  it("carries the shared calibration rule", () => {
    expect(READER_CRITIC_SYSTEM).toContain(CRITIC_CALIBRATION_RULE);
  });
});
