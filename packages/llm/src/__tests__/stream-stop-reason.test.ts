import { describe, it, expect } from "vitest";
import { isConfirmedCompletion } from "../stream.js";

describe("isConfirmedCompletion", () => {
  it("end_turn — модель дописала сама", () => {
    expect(isConfirmedCompletion("end_turn")).toBe(true);
  });

  it("stop_sequence тоже считается завершением", () => {
    expect(isConfirmedCompletion("stop_sequence")).toBe(true);
  });

  it("max_tokens — обрубок, а не глава", () => {
    expect(isConfirmedCompletion("max_tokens")).toBe(false);
  });

  it("бэкенд не сообщил причину — считаем неподтверждённым", () => {
    expect(isConfirmedCompletion(null)).toBe(false);
  });

  it("незнакомая причина — неподтверждённое завершение", () => {
    expect(isConfirmedCompletion("refusal")).toBe(false);
  });
});
