import { compareToBenchmarks, runBacktest } from "@ct/backtesting";
import type { StrategyTemplate } from "@ct/strategies";
import type { Candle, Signal } from "@ct/shared";
import { describe, expect, it } from "vitest";
import { edgeDataset, EDGE_SYMBOL } from "../helpers";

const fixed = { kind: "fixed-payout" as const, payout: "0.8", lossFraction: "1", feePerTrade: "0" };
const linear = { kind: "linear" as const, feeRate: "0.0005", slippageBps: 0 };

function scripted(signals: Signal[], holdBars = 1): StrategyTemplate {
  return {
    key: "scripted",
    family: "test",
    name: "Scripted",
    description: "",
    hypothesis: "test",
    expectedRegimes: [],
    params: {},
    defaults: {},
    generate: () => ({ signals, exit: { holdBars } }),
  };
}

function candles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: i * 900_000, open: i === 0 ? c : closes[i - 1]!, high: Math.max(c, closes[i - 1] ?? c) + 1, low: Math.min(c, closes[i - 1] ?? c) - 1, close: c, volume: 1 }));
}

const base = { symbol: "T", timeframe: "15m" as const, datasetVersion: "ds_test", stake: "10", initialCapital: "1000", seed: 1 };

describe("backtest engine", () => {
  it("fills at the NEXT bar open (no look-ahead) and settles fixed-payout at expiry close", () => {
    // signal at bar 1 close; entry = bar 2 open (=101); expiry = bar 2 close (=105) → win
    const c = candles([100, 101, 105, 104]);
    const r = runBacktest({ ...base, candles: c, template: scripted([0, 1, 0, 0]), params: {}, instrument: fixed });
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.entryTime).toBe(c[2]!.time);
    expect(t.entryPrice).toBe(101);
    expect(t.exitPrice).toBe(105);
    expect(t.win).toBe(true);
    expect(t.pnl.toString()).toBe("8");
  });

  it("treats a tie as a loss for fixed payout", () => {
    const c = candles([100, 101, 101, 101]);
    const r = runBacktest({ ...base, candles: c, template: scripted([0, 1, 0, 0]), params: {}, instrument: fixed });
    expect(r.trades[0]!.win).toBe(false);
    expect(r.trades[0]!.pnl.toString()).toBe("-10");
  });

  it("charges linear fees on both sides in decimal", () => {
    const c = candles([100, 100, 110, 110]);
    const r = runBacktest({ ...base, candles: c, template: scripted([0, 1, 0, 0]), params: {}, instrument: linear });
    // move = (110-100)/100 = 10% of 10 = 1; fees = 10 × 0.0005 × 2 = 0.01
    expect(r.trades[0]!.pnl.toString()).toBe("0.99");
    expect(r.metrics.totalFees).toBe("0.01000000");
  });

  it("respects tradeFromTime (warm-up bars produce no trades)", () => {
    const c = candles([100, 101, 102, 103, 104, 105]);
    const r = runBacktest({ ...base, candles: c, template: scripted([1, 1, 1, 1, 1, 0]), params: {}, instrument: fixed, tradeFromTime: c[3]!.time });
    expect(r.trades.every((t) => t.signalTime >= c[3]!.time)).toBe(true);
    expect(r.equity[0]!.time).toBe(c[3]!.time);
  });

  it("is reproducible: same inputs → identical run hash and metrics", () => {
    const ds = edgeDataset();
    const cfg = { ...base, symbol: EDGE_SYMBOL, candles: ds.candles.slice(0, 8000), datasetVersion: ds.version, template: "benchmark-random", params: {}, instrument: fixed };
    const a = runBacktest(cfg);
    const b = runBacktest(cfg);
    expect(a.manifest.runHash).toBe(b.manifest.runHash);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.manifest).toMatchObject({ engineVersion: "1.0.0", datasetVersion: ds.version, seed: 1, template: "benchmark-random" });
    expect(runBacktest({ ...cfg, seed: 2 }).manifest.runHash).not.toBe(a.manifest.runHash);
  });

  it("computes the full metric set", () => {
    const ds = edgeDataset();
    const m = runBacktest({ ...base, symbol: EDGE_SYMBOL, candles: ds.candles.slice(0, 20000), datasetVersion: ds.version, template: "atr-expansion", params: { atrPeriod: 20, mult: 2, holdBars: 1 }, instrument: fixed }).metrics;
    for (const k of ["netReturn", "annualisedReturn", "winRate", "lossRate", "expectancyR", "profitFactor", "sharpe", "sortino", "calmar", "maxDrawdown", "recoveryFactor", "exposure", "volatility", "valueAtRisk95", "conditionalValueAtRisk95"]) {
      expect(Number.isFinite(m[k as keyof typeof m] as number)).toBe(true);
    }
    expect(m.breakEvenWinRate).toBeCloseTo(10 / 18, 6);
    expect(m.winRate).toBeGreaterThan(m.breakEvenWinRate!);
  });

  it("benchmarks: a strong edge beats random, momentum, SMA, buy-and-hold and no-trade", () => {
    const ds = edgeDataset();
    const c = ds.candles.slice(0, 20000);
    const m = runBacktest({ ...base, symbol: EDGE_SYMBOL, candles: c, datasetVersion: ds.version, template: "atr-expansion", params: { atrPeriod: 20, mult: 2, holdBars: 1 }, instrument: fixed }).metrics;
    const cmp = compareToBenchmarks(m, { ...base, symbol: EDGE_SYMBOL, candles: c, datasetVersion: ds.version, instrument: fixed });
    expect(Object.keys(cmp.benchmarks)).toEqual(["benchmark-random", "benchmark-buy-hold", "benchmark-sma-cross", "benchmark-momentum", "benchmark-no-trade"]);
    expect(cmp.benchmarks["benchmark-no-trade"]!.tradeCount).toBe(0);
    expect(cmp.passed).toBe(true);
  });
});
