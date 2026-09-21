import { describe, it, expect } from "vitest";
import { createProposalCancelRegistry } from "../proposal-cancel.js";

describe("createProposalCancelRegistry", () => {
  it("незарегистрированный запуск остановить нельзя", () => {
    const reg = createProposalCancelRegistry();
    expect(reg.requestStop(1)).toBe(false);
  });

  it("зарегистрированный запуск помечается на остановку", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.requestStop(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(true);
  });

  it("остановка одного запуска не задевает соседний", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    reg.begin(2);
    reg.requestStop(1);
    expect(reg.shouldStop(2)).toBe(false);
  });

  it("остановка прерывает сигнал запуска", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    const signal = reg.signal(1);
    expect(signal?.aborted).toBe(false);
    reg.requestStop(1);
    expect(signal?.aborted).toBe(true);
  });

  it("удержание не прерывает сигнал и не считается отменой", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    expect(reg.requestHold(1)).toBe(true);
    expect(reg.shouldHold(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.signal(1)?.aborted).toBe(false);
    expect(reg.requestHold(2)).toBe(false);
  });

  it("завершённый запуск исчезает из реестра", () => {
    const reg = createProposalCancelRegistry();
    reg.begin(1);
    reg.end(1);
    expect(reg.size()).toBe(0);
    expect(reg.requestStop(1)).toBe(false);
  });
});
