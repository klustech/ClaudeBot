import { createVersionRecord } from "@ct/core";
import { openDatabase, Repository, type DatabaseHandle } from "@ct/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

let h: DatabaseHandle;
let repo: Repository;

beforeAll(async () => {
  h = await openDatabase({ memory: true });
  repo = new Repository(h.db);
});
afterAll(async () => h.close());

const rec = () =>
  createVersionRecord({
    strategyId: "ETH-15M-MOMENTUM-001",
    version: 1,
    name: "ETH Momentum",
    market: "ETHUSDT",
    timeframe: "15m",
    template: "rsi-macd-momentum",
    family: "momentum",
    hypothesis: "Momentum persists over the next bar after RSI > 60 with rising MACD histogram",
    rationale: "Order-flow persistence",
    invalidation: "OOS expectancy <= 0",
    expectedRegimes: ["TREND_UP"],
    parameters: { rsiPeriod: 14, rsiThreshold: 60, holdBars: 1, volumeFilter: false },
    risk: {},
    createdBy: "claude",
    genome: { parent: null, mutations: [], generation: 0 },
  });

describe("database", () => {
  it("stores strategy versions and enforces immutability at the DB level", async () => {
    await repo.insertStrategyVersion(rec());
    const v = await repo.getVersion("ETH-15M-MOMENTUM-001-v1");
    expect(v?.stage).toBe("IDEA");
    await repo.updateLifecycle("ETH-15M-MOMENTUM-001-v1", { stage: "RESEARCH" });
    expect((await repo.getVersion("ETH-15M-MOMENTUM-001-v1"))?.stage).toBe("RESEARCH");
    await expect(
      h.db.execute(sql`UPDATE strategy_versions SET parameters = '{"rsiThreshold": 63}' WHERE id = 'ETH-15M-MOMENTUM-001-v1'`),
    ).rejects.toThrow();
    await expect(h.db.execute(sql`DELETE FROM strategy_versions`)).rejects.toThrow();
  });

  it("freezes a version only once", async () => {
    const at = await repo.freezeVersion("ETH-15M-MOMENTUM-001-v1");
    expect(at).toBeInstanceOf(Date);
    await expect(h.db.execute(sql`UPDATE strategy_versions SET frozen_at = now() + interval '1 day'`)).rejects.toThrow();
  });

  it("keeps claude_decisions append-only", async () => {
    await repo.recordDecision({
      strategyId: "ETH-15M-MOMENTUM-001-v1",
      action: "PROMOTE",
      reason: "test",
      evidence: {},
      inputMetrics: {},
      outputDecision: "RESEARCH",
      model: "test",
      sessionId: "s",
      actor: "claude",
    });
    expect((await repo.listDecisions()).length).toBe(1);
    await expect(h.db.execute(sql`UPDATE claude_decisions SET reason = 'x'`)).rejects.toThrow();
    await expect(h.db.execute(sql`DELETE FROM claude_decisions`)).rejects.toThrow();
  });

  it("counts trials across experiments", async () => {
    const e = await repo.createExperiment({ kind: "optimisation" });
    await repo.completeExperiment(e.id, { status: "completed", configurationsTested: 42 });
    expect(await repo.totalTrials()).toBe(42);
    expect(await repo.nextStrategySequence("ETH-15M-MOMENTUM")).toBe(2);
  });
});
