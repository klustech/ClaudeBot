import { deflatedSharpe, expectedMaxSharpe, monteCarlo, probabilisticSharpe, detectDegradationShim } from "./stat-helpers";
import { normCdf, normInv } from "@ct/shared";
import { describe, expect, it } from "vitest";

describe("normal distribution helpers", () => {
  it("inverse CDF round-trips", () => {
    for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) expect(normCdf(normInv(p))).toBeCloseTo(p, 4);
  });
});

describe("deflated Sharpe ratio", () => {
  it("expected max Sharpe grows with the number of trials", () => {
    expect(expectedMaxSharpe(1, 0.01)).toBe(0);
    expect(expectedMaxSharpe(1000, 0.01)).toBeGreaterThan(expectedMaxSharpe(10, 0.01));
  });
  it("penalises the same Sharpe more heavily after more experiments", () => {
    const few = deflatedSharpe({ sharpe: 0.1, observations: 500, skewness: 0, kurtosis: 3, trials: 5 });
    const many = deflatedSharpe({ sharpe: 0.1, observations: 500, skewness: 0, kurtosis: 3, trials: 50_000 });
    expect(many.deflatedSharpeProbability).toBeLessThan(few.deflatedSharpeProbability);
  });
  it("PSR is 0.5 when SR equals the benchmark", () => {
    expect(probabilisticSharpe(0.2, 0.2, 100, 0, 3)).toBeCloseTo(0.5, 6);
  });
});

describe("Monte Carlo", () => {
  const trades = Array.from({ length: 400 }, (_, i) => ({ returnOnStake: i % 10 < 6 ? 0.8 : -1, stakeFraction: 0.01, win: i % 10 < 6 }));
  it("is deterministic for a seed", () => {
    const opts = { simulations: 1000, seed: 3, ruinDrawdown: 0.3, slippageSd: 0.001, missedTradeProbability: 0.02, feeMultiplierMax: 1.5, baseFeeFraction: 0, payoutVariation: 0.05 };
    expect(monteCarlo(trades, opts)).toEqual(monteCarlo(trades, opts));
  });
  it("reports percentiles, ruin and streaks", () => {
    const r = monteCarlo(trades, { simulations: 2000, seed: 1, ruinDrawdown: 0.3, slippageSd: 0, missedTradeProbability: 0, feeMultiplierMax: 1, baseFeeFraction: 0, payoutVariation: 0 });
    expect(r.p05Return).toBeLessThanOrEqual(r.medianReturn);
    expect(r.medianReturn).toBeLessThanOrEqual(r.p95Return);
    expect(r.medianReturn).toBeGreaterThan(0);
    expect(r.probabilityOfRuin).toBeLessThan(0.02);
    expect(r.expectedLongestLosingStreak).toBeGreaterThan(1);
  });
  it("a losing system has high ruin probability with big stakes", () => {
    const bad = trades.map((t) => ({ ...t, returnOnStake: t.win ? 0.5 : -1, stakeFraction: 0.1 }));
    expect(monteCarlo(bad, { simulations: 500, seed: 1, ruinDrawdown: 0.3, slippageSd: 0, missedTradeProbability: 0, feeMultiplierMax: 1, baseFeeFraction: 0, payoutVariation: 0 }).probabilityOfRuin).toBeGreaterThan(0.9);
  });
});

describe("degradation detection", () => {
  const expected = { expectancyR: 0.08, returnSd: 0.9, winRate: 0.6, profitFactor: 1.4, maxDrawdown: 0.08 };
  it("does not act on small samples", () => {
    expect(detectDegradationShim([-1, -1, -1], expected).degraded).toBe(false);
  });
  it("flags statistically significant underperformance", () => {
    const rets = Array.from({ length: 100 }, (_, i) => (i % 10 < 3 ? 0.8 : -1));
    const r = detectDegradationShim(rets, expected);
    expect(r.degraded).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("does not flag in-line performance", () => {
    const rets = Array.from({ length: 100 }, (_, i) => (i % 10 < 6 ? 0.8 : -1));
    expect(detectDegradationShim(rets, expected).degraded).toBe(false);
  });
});
