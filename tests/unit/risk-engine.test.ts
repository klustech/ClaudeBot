import { CircuitBreakerBoard, RiskEngine } from "@ct/risk";
import { D } from "@ct/shared";
import { describe, expect, it } from "vitest";
import { baseRequest, baseState, ctx, LIMITS, NOW } from "../helpers";

const engine = new RiskEngine(LIMITS);
const codes = (r: ReturnType<RiskEngine["evaluate"]>) => r.violations.map((v) => v.code);

describe("risk engine", () => {
  it("approves a clean paper request", () => {
    const r = engine.evaluate(baseRequest(), baseState(), ctx());
    expect(r.violations).toEqual([]);
    expect(r.approved).toBe(true);
    expect(r.stake.toString()).toBe("10");
  });

  it.each([
    ["MAX_POSITION", baseRequest({ stake: "25" }), baseState()],
    ["MAX_STRATEGY_EXPOSURE", baseRequest(), baseState({ openPositions: [{ strategyVersionId: "ETH-15M-MOMENTUM-001-v1", market: "ETHUSDT", stake: D(45) }] })],
    [
      "MAX_PORTFOLIO_EXPOSURE",
      baseRequest(),
      baseState({ openPositions: [1, 2, 3, 4].map((i) => ({ strategyVersionId: `S${i}`, market: "BTCUSDT", stake: D(36) })) }),
    ],
    ["MAX_DAILY_LOSS", baseRequest(), baseState({ equity: D(969), startOfDayEquity: D(1000) })],
    ["MAX_WEEKLY_LOSS", baseRequest(), baseState({ equity: D(939), startOfDayEquity: D(939), startOfWeekEquity: D(1000), peakEquity: D(1000) })],
    ["MAX_DRAWDOWN", baseRequest(), baseState({ equity: D(840), startOfDayEquity: D(840), startOfWeekEquity: D(840), peakEquity: D(1000) })],
    ["MAX_CONSECUTIVE_LOSSES", baseRequest(), baseState({ consecutiveLosses: 8 })],
    ["MAX_OPEN_POSITIONS", baseRequest({ stake: "1" }), baseState({ openPositions: [1, 2, 3, 4, 5].map((i) => ({ strategyVersionId: `S${i}`, market: "X", stake: D(1) })) })],
    ["MAX_TRADES_PER_HOUR", baseRequest(), baseState({ recentTradeTimes: Array.from({ length: 12 }, (_, i) => NOW - i * 60_000) })],
    ["CONFIDENCE", baseRequest({ confidence: 79 }), baseState()],
    ["EDGE", baseRequest({ edge: 0.001 }), baseState()],
    ["SLIPPAGE", baseRequest({ expectedSlippageBps: 11 }), baseState()],
    ["LATENCY", baseRequest({ quoteLatencyMs: 2500 }), baseState()],
    ["STALE_DATA", baseRequest({ dataAgeMs: 200_000 }), baseState()],
    ["STALE_DATA", baseRequest({ dataAgeMs: undefined }), baseState()],
    ["STALE_SIGNAL", baseRequest({ signalTime: NOW - 120_000 }), baseState()],
    ["STALE_SIGNAL", baseRequest({ signalTime: NOW + 60_000 }), baseState()],
    ["PAYOUT", baseRequest({ payout: 0.6 }), baseState()],
    ["UNEXPECTED_PAYOUT", baseRequest({ payout: 0.75, expectedPayout: 0.85 }), baseState()],
    ["DUPLICATE", baseRequest(), baseState({ seenIdempotencyKeys: new Set(["ETH-15M-20261006T120000-ETH-15M-MOMENTUM-001-v1"]) })],
    ["IDEMPOTENCY", baseRequest({ idempotencyKey: "" }), baseState()],
    ["STAKE", baseRequest({ stake: "-5" }), baseState()],
    ["STAKE", baseRequest({ stake: "abc" }), baseState()],
    ["UNKNOWN_STATE", baseRequest(), baseState({ stateKnown: false })],
    ["STAGE", baseRequest({ strategyStage: "INCUBATING" }), baseState()],
    ["MODE", baseRequest({ mode: "RESEARCH" }), baseState()],
  ] as const)("rejects with %s", (code, req, state) => {
    const r = engine.evaluate(req, state, ctx());
    expect(r.approved).toBe(false);
    expect(codes(r)).toContain(code);
  });

  it("rejects when trading disabled, kill switch engaged or a breaker is open", () => {
    expect(codes(engine.evaluate(baseRequest(), baseState(), ctx({ tradingEnabled: false })))).toContain("TRADING_DISABLED");
    expect(codes(engine.evaluate(baseRequest(), baseState(), ctx({ killSwitchEngaged: true })))).toContain("KILL_SWITCH");
    const b = new CircuitBreakerBoard(() => NOW);
    b.trip("market_feed_stale", "test");
    expect(codes(engine.evaluate(baseRequest(), baseState(), ctx({ breakers: b })))).toContain("CIRCUIT_BREAKER");
  });

  it("strategy-scoped breakers halt only that strategy", () => {
    const b = new CircuitBreakerBoard(() => NOW);
    b.trip("strategy_degradation", "test", "OTHER-v1");
    expect(engine.evaluate(baseRequest(), baseState(), ctx({ breakers: b })).approved).toBe(true);
    expect(codes(engine.evaluate(baseRequest({ strategyVersionId: "OTHER-v1" }), baseState(), ctx({ breakers: b })))).toContain("CIRCUIT_BREAKER");
  });

  it("LIVE requires LIVE_TRADING_ENABLED, eligibility, permission, LIVE stage and a capital ceiling", () => {
    const live = baseRequest({ mode: "LIVE", strategyStage: "LIVE", liveEligible: true });
    const c = codes(engine.evaluate(live, baseState(), ctx()));
    expect(c).toEqual(expect.arrayContaining(["LIVE_DISABLED", "NOT_LIVE_PERMITTED", "LIVE_STAGE"]));
    const ok = engine.evaluate(live, baseState(), {
      ...ctx({ liveTradingEnabled: true }),
      livePermittedStrategies: ["ETH-15M-MOMENTUM-001-v1"],
      liveStakeCeiling: D(25),
    });
    expect(ok.approved).toBe(true);
    const tooBig = engine.evaluate({ ...live, stake: "20" }, baseState({ equity: D(5000), peakEquity: D(5000), startOfDayEquity: D(5000), startOfWeekEquity: D(5000) }), {
      ...ctx({ liveTradingEnabled: true }),
      livePermittedStrategies: ["ETH-15M-MOMENTUM-001-v1"],
      liveStakeCeiling: D(15),
    });
    expect(codes(tooBig)).toContain("LIVE_STAGE");
  });

  it("never increases the stake", () => {
    const r = engine.evaluate(baseRequest({ stake: "5" }), baseState(), ctx());
    expect(r.stake.toString()).toBe("5");
  });
});

describe("circuit breakers", () => {
  it("require a named human to reset", () => {
    const b = new CircuitBreakerBoard();
    b.trip("clock_drift", "drift 3s");
    expect(b.isHalted()).toBe(true);
    expect(() => b.reset("clock_drift", "")).toThrow();
    expect(b.reset("clock_drift", "Jane")).toBe(true);
    expect(b.isHalted()).toBe(false);
    expect(b.history[0]?.resetBy).toBe("Jane");
  });
});
