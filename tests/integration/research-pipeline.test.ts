import { ResearchService, importTraderDevBacktest, type Actor } from "@ct/research";
import type { Repository } from "@ct/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDGE_SYMBOL, memoryRepo, NOISE_SYMBOL, TEST_PERIODS, TEST_THRESHOLDS, testDatasetLoader } from "../helpers";

const claude: Actor = { actor: "claude", model: "test-model", sessionId: "test-session" };
let repo: Repository;
let close: () => Promise<void>;
let research: ResearchService;

beforeAll(async () => {
  const m = await memoryRepo();
  repo = m.repo;
  close = () => m.h.close();
  research = new ResearchService(repo, {
    thresholds: TEST_THRESHOLDS,
    periods: TEST_PERIODS,
    stake: "10",
    initialCapital: "1000",
    seed: 7,
    instrumentKey: "fixed-payout-80",
    datasetLoader: (s) => testDatasetLoader(s),
    maxConfigs: 24,
    writeJournalFiles: false,
  });
});
afterAll(async () => close());

describe("research pipeline (hypothesis → backtest → optimise → validate → holdout → INCUBATING)", () => {
  it("promotes a genuine edge through every stage with full audit trail", async () => {
    const rec = await research.strategies.create({ market: EDGE_SYMBOL, timeframe: "15m", template: "atr-expansion", actor: claude });
    expect(rec.id).toBe("TESTEDGE-15M-ATR-EXPANSION-001-v1");
    const bt = await research.researchAndBacktest(rec.id, claude);
    expect(bt.partition).toBe("train");
    expect(bt.metrics.tradeCount).toBeGreaterThan(100);
    expect((await repo.getVersion(rec.id))?.stage).toBe("BACKTESTED");

    const opt = await research.optimiseVersion(rec.id, claude);
    expect(opt.configurationsTested).toBeGreaterThan(1);
    const target = opt.childId ?? rec.id;
    if (opt.childId && opt.childId !== rec.id) {
      expect((await repo.getVersion(rec.id))?.stage).toBe("RETIRED");
      expect((await repo.getVersion(opt.childId))?.genomeParent).toBe(rec.id);
    }

    const out = await research.validate(target, claude);
    expect(out.report.checks.length).toBeGreaterThan(10);
    expect(out.reasons).toEqual([]);
    expect(out.passed).toBe(true);
    expect(out.finalStage).toBe("INCUBATING");
    const v = await repo.getVersion(target);
    expect(v?.frozenAt).not.toBeNull();
    expect(v?.stage).toBe("INCUBATING");
    expect((v?.evidence as { holdoutEvaluated?: boolean }).holdoutEvaluated).toBe(true);

    const decisions = await repo.listDecisions({ strategyId: target });
    expect(decisions.map((d) => d.outputDecision)).toEqual(expect.arrayContaining(["RESEARCH", "BACKTESTED", "VALIDATING", "INCUBATING"]));
    expect(decisions.every((d) => d.model === "test-model" && d.sessionId === "test-session")).toBe(true);

    const vruns = await repo.listValidationRuns(target);
    expect(vruns.map((r) => r.kind).sort()).toEqual(["holdout", "validation"]);
    expect(await repo.totalTrials()).toBeGreaterThan(opt.configurationsTested);
  }, 240_000);

  it("a frozen version cannot be holdout-tested twice (re-validation refused)", async () => {
    const [v] = await repo.listVersions({ stage: "INCUBATING" });
    await expect(research.validate(v!.id, claude)).rejects.toThrow(/BACKTESTED/);
  });

  it("INCUBATING → PAPER only after holdout; Claude cannot approve", async () => {
    const [v] = await repo.listVersions({ stage: "INCUBATING" });
    await research.strategies.transition(v!.id, "PAPER", { reason: "begin paper incubation", evidence: { incubationPassed: true }, actor: claude });
    expect((await repo.getVersion(v!.id))?.stage).toBe("PAPER");
    await expect(research.strategies.transition(v!.id, "APPROVED", { reason: "looks good", actor: claude })).rejects.toThrow(/Claude may recommend/);
    await expect(research.strategies.transition(v!.id, "LIVE", { reason: "yolo", actor: claude })).rejects.toThrow();
  });

  it("rejects noise: no edge survives costs and multiple-testing correction", async () => {
    const rec = await research.strategies.create({ market: NOISE_SYMBOL, timeframe: "15m", template: "rsi-macd-momentum", actor: claude });
    await research.researchAndBacktest(rec.id, claude);
    const opt = await research.optimiseVersion(rec.id, claude);
    const out = await research.validate(opt.childId ?? rec.id, claude);
    expect(out.passed).toBe(false);
    expect(out.finalStage).toBe("RETIRED");
    expect(out.reasons.length).toBeGreaterThan(0);
  }, 240_000);

  it("ranks survivors and selects a diversified set", async () => {
    const r = await research.rankAndSelect(["INCUBATING", "PAPER"]);
    expect(r.selected.length).toBeGreaterThanOrEqual(1);
    expect(r.selected.length).toBeLessThanOrEqual(5);
  });

  it("imports Trader.dev backtests into the experiment database", async () => {
    const res = await importTraderDevBacktest(repo, {
      externalStrategyId: "td-123",
      externalBacktestId: "bt-456",
      market: "ETHUSDT",
      timeframe: "15m",
      period: { from: "2023-01-01", to: "2023-06-01" },
      metrics: { netProfit: "12.5", tradeCount: 2, winRate: 0.5, profitFactor: 1.5, maxDrawdown: 0.05 },
      trades: [
        { entryTime: "2023-01-01T00:00:00Z", exitTime: "2023-01-01T00:15:00Z", direction: "LONG", entryPrice: 100, exitPrice: 101, stake: "10", pnl: "8" },
        { entryTime: "2023-01-02T00:00:00Z", exitTime: "2023-01-02T00:15:00Z", direction: "SHORT", entryPrice: 100, exitPrice: 101, stake: "10", pnl: "-10" },
      ],
      equity: [{ time: "2023-01-01T00:15:00Z", equity: 1008 }],
    });
    const run = await repo.getBacktestRun(res.backtestRunId);
    expect(run?.source).toBe("trader-dev");
    expect((await repo.tradesForRun(res.backtestRunId)).map((t) => t.direction)).toEqual(["UP", "DOWN"]);
  });
});
