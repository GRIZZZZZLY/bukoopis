import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdApprox } from "../money.js";

describe("formatUsd", () => {
  it("ноль печатается как ноль, а не как $0.0000", () => {
    expect(formatUsd(0)).toBe("$0");
  });

  it("нечисловые значения дают прочерк", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
    expect(formatUsd(Number.NaN)).toBe("—");
  });

  it("суммы меньше сотой доли цента не округляются в ноль", () => {
    expect(formatUsd(0.00002)).toBe("<$0.0001");
  });

  it("точность растёт по мере уменьшения суммы", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.42)).toBe("$0.420");
    expect(formatUsd(12.3456)).toBe("$12.35");
  });

  it("отрицательные суммы помечаются минусом", () => {
    expect(formatUsd(-3.5)).toBe("−$3.50");
  });

  it("приблизительная оценка помечена явно", () => {
    expect(formatUsdApprox(1.5)).toBe("≈ $1.50");
    expect(formatUsdApprox(null)).toBe("—");
  });
});
