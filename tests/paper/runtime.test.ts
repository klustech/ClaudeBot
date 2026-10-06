import { createVersionRecord } from "@ct/core";
import type { Repository } from "@ct/database";
import { ReplayStream } from "@ct/market-data";
import { TradingRuntime } from "@ct/runtime";
import { ManualClock } from "@ct/shared";
import { Alerter, createLogger, MemoryAlertChannel } from "@ct/telemetry";
import { DataPartitioner } from "@ct/validation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDGE_SYMBOL, LIMITS, memoryRepo, TEST_PERIODS, TEST_THRESHOLDS, tempKillSwitch, testDatasetLoader } from "../helpers";

let repo: Repository;
let close: () => Promise<void>;

beforeAll(async () => {
  const m = await memoryRepo();
  repo = m.repo;
  close = () => m.h.close();
  const rec = createVersionRecord({
    strategyId: "TESTEDGE-15M-ATR-EXPANSION-001",
    version: 1,
    name: "edge",
    market: EDGE_SYMBOL,
    timeframe: "15m",
    template: "atr-expansion",
    family: "atr-expansion",
    hypothesis: "Range expansion bars continue in their direction over the next bar",
    rationale: "test",
    invalidation: "test",
    expectedRegimes: [],
    parameters: { atrPeriod: 20, mult: 2, holdBars: 1 },
    risk: {},
    createdBy: "system",
    genome: { parent: null, mutations: [], generation: 0 },
  });
  await repo.insertStrategyVersion(rec, "PAPER");
  await repo.updateLifecycle(rec.id, { confidence: 85, evidence: { expected: { expectancyR: 0.3, returnSd: 0.85, winRate: 0.72, profitFactor: 2, maxDrawdown: 0.05 } } });
});
afterAll(async () => close());

describe("paper trading runtime (replay of the FORWARD period)", () => {
  it("turns signals into risk-checked paper trades and persists them like live trades", async () => {
    const ds = testDatasetLoader(EDGE_SYMBOL);
    const part = new DataPartitioner(ds, TEST_PERIODS);
    const fwd = part.forward();
    const clock = new ManualClock(fwd[0]!.time);
    const alerts = new MemoryAlertChannel();
    const rt = new TradingRuntime({
      repo,
      limits: LIMITS,
      thresholds: TEST_THRESHOLDS,
      alerter: new Alerter([alerts], () => clock.now()),
      logger: createLogger("test", "silent"),
      instrument: { kind: "fixed-payout", payout: "0.8", lossFraction: "1", feePerTrade: "0" },
      mode: "PAPER",
      clock,
      killSwitch: tempKillSwitch(),
      startingBalance: "1000",
      currency: "GBP",
      flags: () => ({ tradingEnabled: true, liveTradingEnabled: false }),
    });
    await rt.loadStrategies();
    expect(rt.activeStrategies()).toHaveLength(1);
    rt.sessionId = await repo.createPaperSession({ name: "test", startingBalance: "1000", currency: "GBP", strategyVersionIds: ["TESTEDGE-15M-ATR-EXPANSION-001-v1"], config: {} });
    rt.seedHistory(EDGE_SYMBOL, part.warmupBefore(fwd[0]!.time, 1500));
    const stream = new ReplayStream(EDGE_SYMBOL, "15m", fwd, clock);
    rt.attachStream(EDGE_SYMBOL, stream);
    await stream.start();
    await rt.settle();

    const trades = await repo.listTrades({ sessionId: rt.sessionId, limit: 10_000 });
    const orders = await repo.listOrders({ sessionId: rt.sessionId, limit: 10_000 });
    expect(trades.length).toBeGreaterThan(20);
    expect(orders.length).toBeGreaterThanOrEqual(trades.length);
    expect(orders.every((o) => o.idempotencyKey.startsWith(`${EDGE_SYMBOL}-15M-`))).toBe(true);
    expect(trades.filter((t) => t.win).length / trades.length).toBeGreaterThan(0.6);
    expect((await repo.equityForSession(rt.sessionId)).length).toBeGreaterThan(0);
    const st = rt.status();
    expect(Number(st.equity)).toBeGreaterThan(1000);
    expect(st.stateKnown).toBe(true);
    const rec = await rt.reconcileNow();
    expect(rec.ok).toBe(true);
    const ev = await rt.paperEvaluation("TESTEDGE-15M-ATR-EXPANSION-001-v1");
    expect(ev.trades).toBe(trades.length);
    expect(ev.expectancyR).toBeGreaterThan(0);
  }, 120_000);
});
