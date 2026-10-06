import { downsampleEquity, ENGINE_VERSION, runBacktest, templateCodeHash, type BacktestResult, type InstrumentModel } from "@ct/backtesting";
import type { Repository, StrategyVersionRow } from "@ct/database";
import type { Dataset } from "@ct/market-data";
import { optimise } from "@ct/optimisation";
import { dailyReturnStream, selectDiversified, type SelectionCandidate } from "@ct/portfolio";
import { scoreStrategy, type ScoreCard } from "@ct/scoring";
import { getTemplate } from "@ct/strategies";
import { mean, stddev, type Candle, type ParamSet, type StrategyStage, type Timeframe } from "@ct/shared";
import {
  DataPartitioner,
  evaluateHoldout,
  validateStrategy,
  type LockedPeriods,
  type ValidationReport,
  type ValidationThresholds,
} from "@ct/validation";
import { loadInstrument, loadMarketDataset } from "./data";
import { writeJournal } from "./journal";
import { StrategyService, SYSTEM_ACTOR, type Actor } from "./strategy-service";

export interface ResearchConfig {
  thresholds: ValidationThresholds;
  periods: LockedPeriods;
  stake: string;
  initialCapital: string;
  seed: number;
  instrumentKey?: string;
  datasetLoader?: (symbol: string, timeframe: Timeframe) => Dataset;
  maxConfigs?: number;
  writeJournalFiles?: boolean;
}

export interface BacktestSummary {
  experimentId: string;
  experimentNumber: number;
  backtestRunId: string;
  partition: "train" | "validation";
  metrics: BacktestResult["metrics"];
  runHash: string;
}

export interface ValidationOutcome {
  versionId: string;
  passed: boolean;
  report: Omit<ValidationReport, "validationTrades" | "validationEquity">;
  score: ScoreCard;
  holdout: { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] } | null;
  finalStage: StrategyStage;
  reasons: string[];
}

function slimReport(r: ValidationReport): Omit<ValidationReport, "validationTrades" | "validationEquity"> {
  const { validationTrades: _t, validationEquity: _e, ...rest } = r;
  return {
    ...rest,
    walkForward: { ...rest.walkForward, windows: rest.walkForward.windows.map((w) => ({ ...w })) },
  };
}

function toTradeRows(r: BacktestResult, market: string) {
  return r.trades.map((t) => ({
    market,
    direction: t.direction,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    stake: t.stake.toFixed(8),
    fees: t.fees.toFixed(8),
    pnl: t.pnl.toFixed(8),
    returnOnStake: t.returnOnStake,
    exitReason: t.exitReason,
    win: t.win,
  }));
}

/**
 * Research orchestrator implementing the Claude research loop:
 * hypothesis → backtest (TRAIN) → optimise (TRAIN) → new immutable version →
 * validation laboratory (VALIDATION, walk-forward, Monte Carlo, DSR,
 * stability, benchmarks, regimes) → freeze → single holdout TEST →
 * score → promote to INCUBATING or reject. Every step is persisted.
 */
export class ResearchService {
  readonly strategies: StrategyService;
  private readonly instrument: InstrumentModel;

  constructor(
    private readonly repo: Repository,
    private readonly cfg: ResearchConfig,
  ) {
    this.strategies = new StrategyService(repo, cfg.thresholds);
    this.instrument = loadInstrument(cfg.instrumentKey).model;
  }

  private dataset(v: { market: string; timeframe: string }): Dataset {
    return (this.cfg.datasetLoader ?? loadMarketDataset)(v.market, v.timeframe as Timeframe);
  }

  private base() {
    return { instrument: this.instrument, stake: this.cfg.stake, initialCapital: this.cfg.initialCapital, seed: this.cfg.seed };
  }

  private async version(id: string): Promise<StrategyVersionRow> {
    const v = await this.repo.getVersion(id);
    if (!v) throw new Error(`Unknown strategy version ${id}`);
    return v;
  }

  /** Backtests a version on TRAIN or VALIDATION. TEST is never reachable from here. */
  async backtest(versionId: string, partition: "train" | "validation" = "train", campaignId: string | null = null): Promise<BacktestSummary> {
    const v = await this.version(versionId);
    const ds = this.dataset(v);
    const part = new DataPartitioner(ds, this.cfg.periods);
    let candles: Candle[];
    let tradeFromTime: number | undefined;
    if (partition === "train") candles = part.train();
    else {
      const val = part.validation();
      tradeFromTime = (val[0] as Candle).time;
      candles = [...part.warmupBefore(tradeFromTime, 400), ...val];
    }
    const template = getTemplate(v.template);
    const exp = await this.repo.createExperiment({
      kind: "backtest",
      campaignId,
      strategyVersionId: v.id,
      template: v.template,
      market: v.market,
      timeframe: v.timeframe,
      hypothesis: v.hypothesis,
      datasetVersion: ds.version,
      codeHash: templateCodeHash(template),
      engineVersion: ENGINE_VERSION,
      seed: this.cfg.seed,
      dateFrom: candles[0]?.time ?? null,
      dateTo: candles[candles.length - 1]?.time ?? null,
      params: v.parameters,
      feeModel: { ...this.instrument },
    });
    const r = runBacktest({
      candles,
      symbol: v.market,
      timeframe: v.timeframe as Timeframe,
      datasetVersion: ds.version,
      template,
      params: v.parameters,
      ...this.base(),
      ...(tradeFromTime !== undefined ? { tradeFromTime } : {}),
    });
    const runId = await this.repo.insertBacktestRun({
      experimentId: exp.id,
      strategyVersionId: v.id,
      template: v.template,
      market: v.market,
      timeframe: v.timeframe,
      partition,
      manifest: { ...r.manifest, parameters: { ...r.manifest.parameters } },
      metrics: { ...r.metrics },
      trades: toTradeRows(r, v.market),
      equity: downsampleEquity(r.equity).map((p) => ({ ...p })),
    });
    await this.repo.completeExperiment(exp.id, {
      status: "completed",
      configurationsTested: 1,
      verdict: r.metrics.expectancyR > 0 ? "positive expectancy" : "non-positive expectancy",
      resultSummary: { ...r.metrics, runHash: r.manifest.runHash },
    });
    return { experimentId: exp.id, experimentNumber: exp.number, backtestRunId: runId, partition, metrics: r.metrics, runHash: r.manifest.runHash };
  }

  /**
   * IDEA → RESEARCH → BACKTESTED with a TRAIN backtest as evidence.
   */
  async researchAndBacktest(versionId: string, actor: Actor, campaignId: string | null = null): Promise<BacktestSummary> {
    const v = await this.version(versionId);
    if (v.stage === "IDEA") {
      await this.strategies.transition(versionId, "RESEARCH", { reason: v.hypothesis, evidence: { hypothesisRecorded: true }, actor });
    }
    const bt = await this.backtest(versionId, "train", campaignId);
    const v2 = await this.version(versionId);
    if (v2.stage === "RESEARCH") {
      await this.strategies.transition(versionId, "BACKTESTED", {
        reason: `TRAIN backtest: ${bt.metrics.tradeCount} trades, E[R] ${bt.metrics.expectancyR.toFixed(4)}, PF ${bt.metrics.profitFactor.toFixed(2)}`,
        evidence: { backtestTrades: bt.metrics.tradeCount },
        metrics: { ...bt.metrics },
        actor,
      });
    }
    return bt;
  }

  /**
   * Optimises parameters on TRAIN only and records the result as a NEW
   * immutable child version (the parent is retired as superseded).
   */
  async optimiseVersion(versionId: string, actor: Actor, campaignId: string | null = null): Promise<{ childId: string | null; configurationsTested: number; best: ParamSet | null }> {
    const v = await this.version(versionId);
    const ds = this.dataset(v);
    const part = new DataPartitioner(ds, this.cfg.periods);
    const train = part.train();
    const template = getTemplate(v.template);
    const exp = await this.repo.createExperiment({
      kind: "optimisation",
      campaignId,
      strategyVersionId: v.id,
      template: v.template,
      market: v.market,
      timeframe: v.timeframe,
      hypothesis: v.hypothesis,
      datasetVersion: ds.version,
      codeHash: templateCodeHash(template),
      engineVersion: ENGINE_VERSION,
      seed: this.cfg.seed,
      dateFrom: train[0]?.time ?? null,
      dateTo: train[train.length - 1]?.time ?? null,
      feeModel: { ...this.instrument },
    });
    const res = optimise(
      { candles: train, symbol: v.market, timeframe: v.timeframe as Timeframe, datasetVersion: ds.version, ...this.base() },
      template,
      { maxConfigs: this.cfg.maxConfigs ?? 200, seed: this.cfg.seed, minTrades: this.cfg.thresholds.minTrades, maxDrawdown: this.cfg.thresholds.maxDrawdown },
    );
    const top = res.candidates[0];
    await this.repo.completeExperiment(exp.id, {
      status: "completed",
      configurationsTested: res.configurationsTested,
      verdict: top ? `best objective ${top.objective.score.toFixed(1)}` : "no candidates",
      resultSummary: {
        top: res.candidates.slice(0, 10).map((c) => ({ params: c.params, score: c.objective.score, penalties: c.objective.penalties, expectancyR: c.metrics.expectancyR, trades: c.metrics.tradeCount, pf: c.metrics.profitFactor })),
      },
    });
    if (!top) return { childId: null, configurationsTested: res.configurationsTested, best: null };
    const same = JSON.stringify(top.params) === JSON.stringify(v.parameters);
    if (same) return { childId: v.id, configurationsTested: res.configurationsTested, best: top.params };
    const changed = Object.keys(top.params).filter((k) => top.params[k] !== v.parameters[k]);
    const child = await this.strategies.derive(
      v.id,
      { parameters: top.params, mutations: [`TRAIN optimisation (${res.configurationsTested} configs): ${changed.map((k) => `${k}=${String(top.params[k])}`).join(", ")}`] },
      actor,
    );
    await this.researchAndBacktest(child.id, actor, campaignId);
    if (v.stage !== "RETIRED") {
      await this.strategies.transition(v.id, "RETIRED", { reason: `Superseded by optimised version ${child.id}`, actor });
    }
    return { childId: child.id, configurationsTested: res.configurationsTested, best: top.params };
  }

  /**
   * Full validation laboratory for a BACKTESTED version, then freeze and the
   * one-time holdout TEST. Promotes to INCUBATING or retires (rejects).
   */
  async validate(versionId: string, actor: Actor, campaignId: string | null = null): Promise<ValidationOutcome> {
    const v = await this.version(versionId);
    if (v.stage !== "BACKTESTED" && v.stage !== "VALIDATING") {
      throw new Error(`Version ${versionId} is ${v.stage}; validation requires BACKTESTED`);
    }
    const ds = this.dataset(v);
    const t = this.cfg.thresholds;
    const priorTrials = await this.repo.totalTrials();
    const reasons: string[] = [];

    // Backtest minimum requirements gate BACKTESTED → VALIDATING.
    const trainRuns = await this.repo.listBacktestRuns({ strategyVersionId: versionId });
    const trainRun = trainRuns.find((r) => r.partition === "train");
    const trainPassed = Boolean(
      trainRun && trainRun.tradeCount >= t.minTrades && trainRun.profitFactor >= t.minProfitFactor && trainRun.maxDrawdown <= t.maxDrawdown && Number(trainRun.expectancy) > 0,
    );
    if (v.stage === "BACKTESTED") {
      if (!trainPassed) {
        const why = trainRun
          ? `TRAIN minimum requirements failed (trades ${trainRun.tradeCount}, PF ${trainRun.profitFactor.toFixed(2)}, DD ${(trainRun.maxDrawdown * 100).toFixed(1)}%, E ${trainRun.expectancy})`
          : "no TRAIN backtest";
        await this.strategies.transition(versionId, "RETIRED", { reason: `Rejected: ${why}`, actor });
        await writeJournal(this.cfg.writeJournalFiles === false ? null : this.repo, {
          title: `${v.id} rejected at backtest gate`,
          hypothesis: v.hypothesis,
          result: "Rejected.",
          reason: why,
          next: "Generate a new hypothesis or a variant addressing the failure.",
          campaignId,
        });
        return {
          versionId,
          passed: false,
          report: null as never,
          score: null as never,
          holdout: null,
          finalStage: "RETIRED",
          reasons: [why],
        };
      }
      await this.strategies.transition(versionId, "VALIDATING", { reason: "TRAIN minimum requirements met", evidence: { backtestPassed: true }, actor });
    }

    const exp = await this.repo.createExperiment({
      kind: "validation",
      campaignId,
      strategyVersionId: v.id,
      template: v.template,
      market: v.market,
      timeframe: v.timeframe,
      hypothesis: v.hypothesis,
      datasetVersion: ds.version,
      codeHash: templateCodeHash(getTemplate(v.template)),
      engineVersion: ENGINE_VERSION,
      seed: this.cfg.seed,
      params: v.parameters,
      feeModel: { ...this.instrument },
    });
    const report = validateStrategy({
      dataset: ds,
      periods: this.cfg.periods,
      template: v.template,
      thresholds: t,
      base: this.base(),
      priorTrials,
      fixedParams: v.parameters,
      walkForwardMode: "reoptimise",
    });
    const research = { hypothesis: v.hypothesis, rationale: v.rationale, invalidation: v.invalidation, expectedRegimes: v.expectedRegimes };
    let score = scoreStrategy({ research, report, thresholds: t });

    // Persist the validation-period run with trades/equity for the inspector & correlation analysis.
    await this.repo.insertBacktestRun({
      experimentId: exp.id,
      strategyVersionId: v.id,
      template: v.template,
      market: v.market,
      timeframe: v.timeframe,
      partition: "validation",
      manifest: { runHash: report.runHashes.validation, datasetVersion: ds.version, parameters: { ...report.selectedParams } },
      metrics: { ...report.validation },
      trades: report.validationTrades.map((x) => ({
        market: v.market,
        direction: x.direction,
        entryTime: x.entryTime,
        exitTime: x.exitTime,
        entryPrice: x.entryPrice,
        exitPrice: x.exitPrice,
        stake: x.stake.toFixed(8),
        fees: x.fees.toFixed(8),
        pnl: x.pnl.toFixed(8),
        returnOnStake: x.returnOnStake,
        exitReason: x.exitReason,
        win: x.win,
      })),
      equity: downsampleEquity(report.validationEquity).map((p) => ({ ...p })),
    });

    const evidence = {
      backtestPassed: true,
      oosPassed: report.checks.filter((c) => c.name.startsWith("OOS")).every((c) => c.passed),
      walkForwardPassed: report.checks.find((c) => c.name.startsWith("Walk-forward"))?.passed ?? false,
      monteCarloPassed: report.checks.find((c) => c.name.startsWith("Monte Carlo"))?.passed ?? false,
      stabilityPassed: report.checks.find((c) => c.name.startsWith("Parameter stability"))?.passed ?? false,
      deflatedSharpePassed: report.checks.find((c) => c.name.startsWith("Deflated"))?.passed ?? false,
      benchmarkPassed: report.benchmarks.passed,
      expected: {
        expectancyR: report.validation.expectancyR,
        returnSd: stddev(report.validationTrades.map((x) => x.returnOnStake)),
        winRate: report.validation.winRate,
        profitFactor: report.validation.profitFactor,
        maxDrawdown: report.validation.maxDrawdown,
      },
    };

    let holdout: ValidationOutcome["holdout"] = null;
    let finalStage: StrategyStage = "VALIDATING";
    if (!report.passed) {
      reasons.push(...report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`));
    } else {
      // Freeze BEFORE touching TEST. Test data is evaluated exactly once per version.
      const frozenAt = await this.repo.freezeVersion(v.id);
      const prior = (v.evidence as { holdoutEvaluated?: boolean }).holdoutEvaluated;
      if (prior) throw new Error(`Holdout already evaluated for ${v.id}; create a new version instead`);
      const h = evaluateHoldout({
        dataset: ds,
        periods: this.cfg.periods,
        strategy: { id: v.id, frozenAt: frozenAt.toISOString(), template: v.template, parameters: v.parameters },
        thresholds: t,
        base: this.base(),
      });
      holdout = { passed: h.passed, checks: h.checks };
      await this.repo.insertValidationRun({
        experimentId: exp.id,
        strategyVersionId: v.id,
        kind: "holdout",
        passed: h.passed,
        checks: h.checks,
        report: { metrics: h.metrics, runHash: h.runHash },
        trials: priorTrials,
      });
      const oosE = report.validation.expectancyR;
      score = scoreStrategy({
        research,
        report,
        thresholds: t,
        forward: {
          trades: h.metrics.tradeCount,
          expectancyR: h.metrics.expectancyR,
          profitFactor: h.metrics.profitFactor,
          maxDrawdown: h.metrics.maxDrawdown,
          deviationFromOos: oosE !== 0 ? Math.abs(h.metrics.expectancyR - oosE) / Math.abs(oosE) : 1,
        },
      });
      if (!h.passed) reasons.push(...h.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`));
      if (score.confidence < t.minConfidence) reasons.push(`confidence ${score.confidence} < ${t.minConfidence}`);
    }

    const passed = report.passed && holdout?.passed === true && score.confidence >= t.minConfidence;
    await this.repo.insertValidationRun({
      experimentId: exp.id,
      strategyVersionId: v.id,
      kind: "validation",
      passed,
      checks: report.checks,
      report: slimReport(report) as unknown as Record<string, unknown>,
      scoreCard: { ...score },
      confidence: score.confidence,
      trials: priorTrials + report.configurationsTested,
    });
    await this.repo.completeExperiment(exp.id, {
      status: passed ? "passed" : "rejected",
      configurationsTested: report.configurationsTested,
      verdict: passed ? "PASS" : "REJECT",
      resultSummary: { confidence: score.confidence, checks: report.checks, holdout },
    });
    await this.repo.updateLifecycle(v.id, { evidence: { ...evidence, holdoutEvaluated: holdout !== null, holdoutPassed: holdout?.passed ?? false }, confidence: score.confidence });

    if (passed) {
      await this.strategies.transition(v.id, "INCUBATING", {
        reason: `Validation PASS. OOS PF ${report.validation.profitFactor.toFixed(2)}, WF ${report.walkForward.profitableWindows}/${report.walkForward.windows.length}, MC ruin ${(report.monteCarlo.probabilityOfRuin * 100).toFixed(2)}%, DSR ${report.deflatedSharpe.deflatedSharpeProbability.toFixed(3)}, stability ${report.stability.score.toFixed(0)}, confidence ${score.confidence}`,
        evidence: { ...evidence, confidenceScore: score.confidence },
        metrics: { train: report.train, validation: report.validation },
        actor,
      });
      finalStage = "INCUBATING";
    } else {
      await this.strategies.transition(v.id, "RETIRED", { reason: `Rejected: ${reasons.join("; ")}`, metrics: { validation: report.validation }, actor });
      finalStage = "RETIRED";
    }

    const failedNames = report.checks.filter((c) => !c.passed).map((c) => c.name);
    await writeJournal(this.cfg.writeJournalFiles === false ? null : this.repo, {
      experimentNumber: exp.number,
      title: `${v.id} (${v.template})`,
      hypothesis: v.hypothesis,
      result: passed ? "Promoted to INCUBATING." : "Rejected.",
      reason: passed ? `All validation checks passed; confidence ${score.confidence}.` : reasons.join("; "),
      observed: diagnose(report),
      next: passed ? "Begin PAPER incubation (100-trade first tier)." : suggestNext(failedNames, v.template),
      campaignId,
      experimentId: exp.id,
    });

    return { versionId, passed, report: slimReport(report), score, holdout, finalStage, reasons };
  }

  /** Ranks candidates and selects a diversified set (≤ maxPortfolioStrategies, correlation-capped). */
  async rankAndSelect(stages: StrategyStage[] = ["INCUBATING", "PAPER", "APPROVED", "LIVE"]) {
    const versions = await this.repo.listVersions({ stage: stages });
    const candidates: SelectionCandidate[] = [];
    for (const v of versions) {
      const runs = await this.repo.listBacktestRuns({ strategyVersionId: v.id });
      const val = runs.find((r) => r.partition === "validation");
      const trades = val ? await this.repo.tradesForRun(val.id) : [];
      candidates.push({
        id: v.id,
        score: v.confidence ?? 0,
        market: v.market,
        family: v.family,
        stream: dailyReturnStream(v.id, trades.map((t) => ({ exitTime: t.exitTime.getTime(), returnOnStake: t.returnOnStake }))),
      });
    }
    const sel = selectDiversified(candidates, {
      maxStrategies: this.cfg.thresholds.maxPortfolioStrategies,
      maxCorrelation: this.cfg.thresholds.maxStrategyCorrelation,
      maxPerFamilyMarket: 1,
    });
    return {
      ranked: candidates.map((c) => ({ id: c.id, score: c.score, market: c.market, family: c.family })),
      selected: sel.selected.map((c) => c.id),
      rejected: sel.rejected,
    };
  }
}

function diagnose(r: ValidationReport): string {
  const parts: string[] = [];
  const trainE = r.train.expectancyR;
  const valE = r.validation.expectancyR;
  if (trainE > 0 && valE <= 0) parts.push("strong TRAIN performance but OOS collapsed — likely overfit or regime-specific");
  const best = Object.entries(r.regimes).sort((a, b) => b[1].expectancyR - a[1].expectancyR)[0];
  const worst = Object.entries(r.regimes).filter(([, s]) => s.trades > 0).sort((a, b) => a[1].expectancyR - b[1].expectancyR)[0];
  if (best && best[1].trades > 0) parts.push(`best regime ${best[0]} (E[R] ${best[1].expectancyR.toFixed(4)}, n=${best[1].trades})`);
  if (worst) parts.push(`worst regime ${worst[0]} (E[R] ${worst[1].expectancyR.toFixed(4)}, n=${worst[1].trades})`);
  if (r.stability.score < 60) parts.push(`parameter neighbourhood unstable (score ${r.stability.score.toFixed(0)})`);
  parts.push(`WF ${r.walkForward.profitableWindows}/${r.walkForward.windows.length} profitable, MC median ${(r.monteCarlo.medianReturn * 100).toFixed(1)}%`);
  parts.push(`DSR ${r.deflatedSharpe.deflatedSharpeProbability.toFixed(3)} with ${r.deflatedSharpe.trials} trials`);
  const meanWf = mean(r.walkForward.windows.map((w) => w.test.expectancyR));
  parts.push(`mean WF test E[R] ${meanWf.toFixed(4)}`);
  return parts.join("; ") + ".";
}

function suggestNext(failed: string[], template: string): string {
  if (failed.some((f) => f.includes("regime"))) return `Add a regime filter to ${template} restricting it to its best-performing regime.`;
  if (failed.some((f) => f.includes("stability"))) return "Widen parameter steps / simplify rules to find a robust neighbourhood.";
  if (failed.some((f) => f.startsWith("OOS"))) return "Try a volatility-normalised (ATR-based) threshold to reduce regime dependence.";
  if (failed.some((f) => f.includes("Deflated"))) return "Edge not distinguishable from multiple-testing noise; require a stronger prior before more variants.";
  if (failed.some((f) => f.includes("trades"))) return "Loosen entry conditions or use more history to obtain ≥300 trades.";
  if (failed.some((f) => f.includes("benchmark"))) return "Does not beat trivial baselines; abandon this hypothesis family on this market.";
  return "Generate a new hypothesis from the failure analysis.";
}

export { SYSTEM_ACTOR };
