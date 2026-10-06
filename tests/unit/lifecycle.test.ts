import { allowedTransitions, assertTransition, canTransition, createVersionRecord, deriveNextVersion, evaluateGate, isLiveEligible, stageAllowedToTrade, verifyIntegrity, buildStrategyId } from "@ct/core";
import { buildIdempotencyKey } from "@ct/shared";
import { describe, expect, it } from "vitest";

const def = () => ({
  strategyId: "ETH-15M-RSI-MACD-001",
  version: 1,
  name: "ETH Momentum Reversal",
  market: "ETHUSDT",
  timeframe: "15m" as const,
  template: "rsi-macd-momentum",
  family: "momentum",
  hypothesis: "RSI/MACD momentum continuation over the next bar after costs",
  rationale: "flow persistence",
  invalidation: "OOS expectancy <= 0",
  expectedRegimes: ["TREND_UP"],
  parameters: { rsiPeriod: 14, rsiThreshold: 60, holdBars: 1, volumeFilter: false },
  risk: {},
  createdBy: "claude" as const,
  genome: { parent: null, mutations: [], generation: 0 },
});

describe("lifecycle", () => {
  it("forward progression is one stage at a time — no skipping", () => {
    expect(canTransition("IDEA", "RESEARCH")).toBe(true);
    expect(canTransition("IDEA", "BACKTESTED")).toBe(false);
    expect(canTransition("BACKTESTED", "PAPER")).toBe(false);
    expect(canTransition("PAPER", "LIVE")).toBe(false);
    expect(() => assertTransition("RESEARCH", "LIVE")).toThrow(/Illegal/);
  });
  it("allows demotion and retirement", () => {
    expect(allowedTransitions("LIVE")).toEqual(["DEGRADED", "RETIRED"]);
    expect(canTransition("DEGRADED", "PAPER")).toBe(true);
    expect(canTransition("RETIRED", "IDEA")).toBe(false);
  });
  it("stage gates which modes may trade", () => {
    expect(stageAllowedToTrade("INCUBATING", "PAPER")).toBe(false);
    expect(stageAllowedToTrade("PAPER", "PAPER")).toBe(true);
    expect(stageAllowedToTrade("PAPER", "LIVE")).toBe(false);
    expect(stageAllowedToTrade("APPROVED", "LIVE")).toBe(false);
    expect(stageAllowedToTrade("LIVE", "LIVE")).toBe(true);
  });
  it("INCUBATING gate requires frozen + all validation passes + confidence", () => {
    const g = evaluateGate("VALIDATING", "INCUBATING", { oosPassed: true }, { minConfidence: 80, minPaperTrades: 100, liveTradingEnabled: false });
    expect(g.allowed).toBe(false);
    expect(g.failures.join()).toMatch(/frozen/);
  });
  it("LIVE gate requires LIVE_TRADING_ENABLED and human approval even with full evidence", () => {
    const ev = { backtestPassed: true, oosPassed: true, walkForwardPassed: true, monteCarloPassed: true, stabilityPassed: true, paperPassed: true, riskPassed: true };
    expect(isLiveEligible(ev)).toBe(true);
    const g = evaluateGate("APPROVED", "LIVE", ev, { minConfidence: 80, minPaperTrades: 100, liveTradingEnabled: false });
    expect(g.failures).toEqual(expect.arrayContaining(["explicit human approval", "LIVE_TRADING_ENABLED=true"]));
  });
});

describe("strategy versioning", () => {
  it("records are deeply frozen and hash-verified", () => {
    const r = createVersionRecord(def());
    expect(r.id).toBe("ETH-15M-RSI-MACD-001-v1");
    expect(Object.isFrozen(r.parameters)).toBe(true);
    expect(() => {
      (r.parameters as Record<string, unknown>).rsiThreshold = 63;
    }).toThrow();
    const tampered = { ...r, parameters: { ...r.parameters, rsiThreshold: 63 } };
    expect(() => verifyIntegrity(tampered)).toThrow(/modified/);
  });
  it("changes create v2 with lineage instead of overwriting", () => {
    const v1 = createVersionRecord(def());
    const v2 = deriveNextVersion(v1, 1, { parameters: { ...v1.parameters, rsiThreshold: 62 }, mutations: ["rsiThreshold 60→62"] });
    expect(v2.id).toBe("ETH-15M-RSI-MACD-001-v2");
    expect(v2.genome).toEqual({ parent: v1.id, mutations: ["rsiThreshold 60→62"], generation: 1 });
    expect(v1.parameters.rsiThreshold).toBe(60);
    expect(() => deriveNextVersion(v1, 1, { mutations: [] })).toThrow();
  });
  it("builds canonical ids and idempotency keys", () => {
    expect(buildStrategyId("ETHUSDT", "15m", "rsi-macd", 1)).toBe("ETH-15M-RSI-MACD-001");
    expect(buildIdempotencyKey({ market: "ETH", timeframe: "15m", signalTime: Date.UTC(2026, 9, 6, 12), strategyId: "STRATEGY001" })).toBe("ETH-15M-20261006T120000-STRATEGY001");
  });
});
