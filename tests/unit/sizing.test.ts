import { allocateRisk, effectiveKellyFraction, fixedStake, kellyFraction, kellyStake, percentRiskNotional, volatilityAdjustedNotional } from "@ct/portfolio";
import { describe, expect, it } from "vitest";

describe("Kelly", () => {
  it("f* = (bp − q)/b", () => {
    expect(kellyFraction(0.6, 1).toString()).toBe("0.2");
    expect(kellyFraction(0.6, 0.8).toString()).toBe("0.1");
  });
  it("never bets with negative edge", () => {
    expect(kellyFraction(0.5, 0.8).toString()).toBe("0");
  });
  it("applies fractional multiplier and confidence/regime discounts (30% raw → 0.5 × 0.5 → 7.5%)", () => {
    const r = effectiveKellyFraction({ winProbability: 0.65, payoutPerUnit: 1, kellyMultiplier: 0.5, confidenceDiscount: 0.5, maxPositionPercent: 100 });
    expect(r.raw.toString()).toBe("0.3");
    expect(r.effective.toString()).toBe("0.075");
  });
  it("defaults to 0.1 Kelly and refuses full Kelly", () => {
    const r = effectiveKellyFraction({ winProbability: 0.65, payoutPerUnit: 1, maxPositionPercent: 100 });
    expect(r.effective.toString()).toBe("0.03");
    expect(() => effectiveKellyFraction({ winProbability: 0.65, payoutPerUnit: 1, kellyMultiplier: 1, maxPositionPercent: 100 })).toThrow();
  });
  it("caps at max position percent", () => {
    expect(kellyStake("1000", { winProbability: 0.9, payoutPerUnit: 1, kellyMultiplier: 0.5, maxPositionPercent: 2 }).toString()).toBe("20");
  });
});

describe("position sizing", () => {
  it("fixed stake is capped by max position percent", () => {
    expect(fixedStake("50", "1000", 2).toString()).toBe("20");
    expect(fixedStake("5", "1000", 2).toString()).toBe("5");
  });
  it("percentage risk", () => {
    expect(percentRiskNotional("1000", 1, 0.02).toString()).toBe("500");
  });
  it("volatility adjusted", () => {
    expect(volatilityAdjustedNotional("1000", 0.1, 0.5).toString()).toBe("200");
  });
  it("allocates risk across strategies with caps", () => {
    const a = allocateRisk(
      [
        { id: "a", volatility: 0.1, confidence: 90, expectedRegimes: [] },
        { id: "b", volatility: 0.2, confidence: 90, expectedRegimes: [] },
        { id: "c", volatility: 0.4, confidence: 90, expectedRegimes: [] },
      ],
      "100",
      0.5,
    );
    expect(a.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 6);
    expect(Math.max(...a.map((x) => x.weight))).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(a[0]!.weight).toBeGreaterThan(a[2]!.weight);
  });
});
