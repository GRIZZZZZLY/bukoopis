import { describe, it, expect } from "vitest";
import { createIntakeCancelRegistry } from "../intake-cancel.js";

describe("intake cancel registry", () => {
  it("a run that was never begun cannot be stopped", () => {
    const r = createIntakeCancelRegistry();
    expect(r.requestStop(1, "k")).toBe(false);
    expect(r.shouldStop(1, "k")).toBe(false);
  });

  it("marks a begun run as stopping", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    expect(r.shouldStop(1, "k")).toBe(false);
    expect(r.requestStop(1, "k")).toBe(true);
    expect(r.shouldStop(1, "k")).toBe(true);
  });

  it("keeps runs of different books and different keys apart", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.begin(2, "k");
    r.begin(1, "other");
    r.requestStop(1, "k");
    expect(r.shouldStop(1, "k")).toBe(true);
    expect(r.shouldStop(2, "k")).toBe(false);
    expect(r.shouldStop(1, "other")).toBe(false);
  });

  it("end removes the run, so a late stop finds nothing and leaks nothing", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.end(1, "k");
    expect(r.size()).toBe(0);
    expect(r.requestStop(1, "k")).toBe(false);
    expect(r.shouldStop(1, "k")).toBe(false);
  });

  it("end is safe to call twice", () => {
    const r = createIntakeCancelRegistry();
    r.begin(1, "k");
    r.end(1, "k");
    r.end(1, "k");
    expect(r.size()).toBe(0);
  });
});
