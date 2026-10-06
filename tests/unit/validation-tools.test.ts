import { runBacktest } from "@ct/backtesting";
import { compositeObjective, parameterGrid, specValues } from "@ct/optimisation";
import { dailyReturnStream, selectDiversified } from "@ct/portfolio";
import { getTemplate } from "@ct/strategies";
import { D, LockedPeriodViolation } from "@ct/shared";
import { classifyRegimes, DataPartitioner, loadLockedPeriods, loadValidationThresholds, parameterStability } from "@ct/validation";
import { describe, expect, it } from "vitest";
import { edgeDataset, EDGE_SYMBOL, TEST_PERIODS } from "../helpers";

const inst = { kind: "fixed-payout" as const, payout: "0.8", lossFraction: "1", feePerTrade: "0" };

describe("locked periods", () => {
  it("repository config loads and is strictly ordered", () => {
    const p = loadLockedPeriods();
    expect(p.ETHUSDT?.trainEnd).toBe("2024-01-01");
    expect(loadValidationThresholds().minTrades).toBe(300);
  });
  it("TEST is inaccessible until the strategy version is frozen", () => {
    const part = new DataPartitioner(edgeDataset(), TEST_PERIODS);
    expect(part.train().length).toBeGreaterThan(0);
    expect(() => part.test({ id: "X-v1", frozenAt: null })).toThrow(LockedPeriodViolation);
    expect(part.test({ id: "X-v1", frozenAt: new Date().toISOString() }).length).toBeGreaterThan(0);
    expect(part.accessLog.map((a) => a.partition)).toEqual(["train", "test"]);
  });
  it("partitions never overlap", () => {
    const part = new DataPartitioner(edgeDataset(), TEST_PERIODS);
    const tr = part.train();
    const va = part.validation();
    const te = part.test({ id: "X", frozenAt: "now" });
    expect(tr.at(-1)!.time).toBeLessThan(va[0]!.time);
    expect(va.at(-1)!.time).toBeLessThan(te[0]!.time);
  });
  it("refuses markets without locked periods", () => {
    expect(() => new DataPartitioner({ ...edgeDataset(), symbol: "NOPEUSDT" }, TEST_PERIODS)).toThrow(LockedPeriodViolation);
  });
});

describe("optimisation", () => {
  it("enumerates grids and samples deterministically when large", () => {
    expect(specValues({ type: "float", min: 1.6, max: 2.8, step: 0.2 })).toEqual([1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8]);
    const t = getTemplate("rsi-macd-momentum");
    expect(parameterGrid(t, { maxConfigs: 10, seed: 1 })).toEqual(parameterGrid(t, { maxConfigs: 10, seed: 1 }));
    expect(parameterGrid(t, { maxConfigs: 10, seed: 1 })).toHaveLength(10);
  });
  it("composite objective penalises small samples, drawdown and divergence", () => {
    const ds = edgeDataset();
    const m = runBacktest({ candles: ds.candles.slice(0, 20000), symbol: EDGE_SYMBOL, timeframe: "15m", datasetVersion: ds.version, template: "atr-expansion", params: {}, instrument: inst, stake: "10", initialCapital: "1000", seed: 1 }).metrics;
    const good = compositeObjective({ train: m, minTrades: 100, maxDrawdown: 0.15 });
    const small = compositeObjective({ train: m, minTrades: m.tradeCount * 10, maxDrawdown: 0.15 });
    const diverged = compositeObjective({ train: m, oos: { ...m, expectancyR: -0.1 }, minTrades: 100, maxDrawdown: 0.15 });
    expect(small.score).toBeLessThan(good.score);
    expect(small.penalties.join()).toMatch(/small sample/);
    expect(diverged.penalties).toContain("train/test divergence");
  });
});

describe("parameter stability", () => {
  it("scores a robust neighbourhood highly on a strong-edge market", () => {
    const ds = edgeDataset();
    const r = parameterStability({ candles: ds.candles.slice(0, 20000), symbol: EDGE_SYMBOL, timeframe: "15m", datasetVersion: ds.version, instrument: inst, stake: "10", initialCapital: "1000", seed: 1 }, getTemplate("atr-expansion"), { atrPeriod: 20, mult: 2, holdBars: 1 }, { heatmap: false });
    expect(r.score).toBeGreaterThan(60);
    expect(r.neighbours.length).toBeGreaterThan(4);
  });
});

describe("regimes", () => {
  it("classifies every bar", () => {
    const ds = edgeDataset();
    const r = classifyRegimes(ds.candles.slice(0, 5000));
    expect(r).toHaveLength(5000);
    expect(new Set(r).size).toBeGreaterThan(2);
  });
});

describe("diversified selection", () => {
  it("rejects highly correlated return streams", () => {
    const day = 86_400_000;
    const mk = (id: string, f: (i: number) => number) => dailyReturnStream(id, Array.from({ length: 60 }, (_, i) => ({ exitTime: i * day, returnOnStake: f(i) })));
    const a = mk("A", (i) => Math.sin(i));
    const b = mk("B", (i) => Math.sin(i) * 1.1);
    const c = mk("C", (i) => Math.cos(i * 3.7));
    const sel = selectDiversified(
      [
        { id: "A", score: 90, stream: a },
        { id: "B", score: 89, stream: b },
        { id: "C", score: 85, stream: c },
      ],
      { maxStrategies: 5, maxCorrelation: 0.5 },
    );
    expect(sel.selected.map((s) => s.id)).toEqual(["A", "C"]);
    expect(sel.rejected[0]?.reason).toMatch(/correlated with A/);
    expect(D(1).toString()).toBe("1");
  });
});
