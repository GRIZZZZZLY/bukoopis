import { describe, it, expect, beforeEach } from "vitest";
import { finishJob, getJob, startJob, updateJob } from "../jobs";

describe("jobs — идущая работа в верхней панели", () => {
  beforeEach(() => {
    const id = startJob({ label: "сброс" });
    finishJob(id);
  });

  it("обновляет подпись, не сбрасывая часы", () => {
    const id = startJob({ label: "Разбор · 0 из 3" });
    const started = getJob()!.startedAt;
    updateJob(id, { label: "Разбор · 1 из 3" });
    expect(getJob()).toMatchObject({ label: "Разбор · 1 из 3", startedAt: started });
  });

  it("поздний finish прежней работы не снимает новую", () => {
    const first = startJob({ label: "первая" });
    const second = startJob({ label: "вторая" });
    finishJob(first);
    updateJob(first, { label: "чужая правка" });
    expect(getJob()?.label).toBe("вторая");
    finishJob(second);
    expect(getJob()).toBeNull();
  });
});
