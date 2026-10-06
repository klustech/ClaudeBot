import {
  compareToBenchmarks,
  runBacktest,
  type BacktestConfig,
  type BacktestMetrics,
  type BacktestResult,
  type BenchmarkComparison,
} from "@ct/backtesting";
import type { Dataset } from "@ct/market-data";
import { compositeObjective, optimise } from "@ct/optimisation";
import { getTemplate, type StrategyTemplate } from "@ct/strategies";
import { D, kurtosis, mean, skewness, stddev, type Candle, type ParamSet, type Regime } from "@ct/shared";
import { deflatedSharpe, type DeflatedSharpeResult } from "./deflated-sharpe";
import { DataPartitioner, type FrozenStrategyRef, type LockedPeriods } from "./locked-periods";
import { monteCarlo, type MonteCarloResult } from "./monte-carlo";
import { classifyRegimes, regimeBreakdown, regimeConcentrated, type RegimeStats } from "./regime";
import { parameterStability, type StabilityResult } from "./stability";
import type { ValidationThresholds } from "./thresholds";
import { walkForward, type WalkForwardResult } from "./walk-forward";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  template: string;
  symbol: string;
  datasetVersion: string;
  selectedParams: ParamSet;
  configurationsTested: number;
  train: BacktestMetrics;
  validation: BacktestMetrics;
  stability: StabilityResult;
  walkForward: WalkForwardResult;
  monteCarlo: MonteCarloResult;
  deflatedSharpe: DeflatedSharpeResult;
  benchmarks: BenchmarkComparison;
  regimes: Record<Regime, RegimeStats>;
  checks: CheckResult[];
  passed: boolean;
  /** Run hashes of the train and validation backtests (reproducibility). */
  runHashes: { train: string; validation: string };
  validationTrades: BacktestResult["trades"];
  validationEquity: BacktestResult["equity"];
}

export interface ValidationInput {
  dataset: Dataset;
  periods: LockedPeriods;
  template: StrategyTemplate | string;
  thresholds: ValidationThresholds;
  base: Pick<BacktestConfig, "instrument" | "stake" | "initialCapital" | "seed">;
  /** Hypotheses/configurations already tested across the whole research programme. */
  priorTrials: number;
  /** If provided, skip optimisation and validate these exact parameters. */
  fixedParams?: ParamSet;
  maxConfigs?: number;
  /** Top-K train candidates compared on VALIDATION. */
  topK?: number;
  warmupBars?: number;
  /**
   * Walk-forward mode. "reoptimise" (default) re-fits parameters inside each
   * train window, testing the research procedure itself without in-sample
   * leakage; "fixed" evaluates the given params in every window.
   */
  walkForwardMode?: "reoptimise" | "fixed";
}

function check(name: string, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail };
}

export function minimumRequirementChecks(m: BacktestMetrics, t: ValidationThresholds, label: string): CheckResult[] {
  return [
    check(`${label}: minimum trades`, m.tradeCount >= t.minTrades, `${m.tradeCount} trades (min ${t.minTrades})`),
    check(`${label}: profit factor`, m.profitFactor >= t.minProfitFactor, `PF ${m.profitFactor.toFixed(2)} (min ${t.minProfitFactor})`),
    check(`${label}: max drawdown`, m.maxDrawdown <= t.maxDrawdown, `DD ${(m.maxDrawdown * 100).toFixed(1)}% (max ${(t.maxDrawdown * 100).toFixed(0)}%)`),
    check(`${label}: positive expectancy`, m.expectancyR > 0, `E[R] ${m.expectancyR.toFixed(4)}`),
  ];
}

/**
 * Full validation laboratory for one strategy template on one market:
 * optimise on TRAIN → compare top-K on VALIDATION → stability → walk-forward
 * (train+validation only) → Monte Carlo → deflated Sharpe → benchmarks →
 * regime analysis. The TEST period is never touched here.
 */
export function validateStrategy(input: ValidationInput): ValidationReport {
  const template = typeof input.template === "string" ? getTemplate(input.template) : input.template;
  const t = input.thresholds;
  const part = new DataPartitioner(input.dataset, input.periods);
  const trainCandles = part.train();
  const valCandles = part.validation();
  if (trainCandles.length === 0 || valCandles.length === 0) {
    throw new Error(`Dataset ${input.dataset.symbol} does not cover the locked train/validation periods`);
  }
  const warmup = input.warmupBars ?? 400;
  const valStart = (valCandles[0] as Candle).time;
  const valWithWarmup = [...part.warmupBefore(valStart, warmup), ...valCandles];
  const common = {
    symbol: input.dataset.symbol,
    timeframe: input.dataset.timeframe,
    datasetVersion: input.dataset.version,
    ...input.base,
  };

  // 1. Optimise on TRAIN (or use fixed params).
  let configurationsTested = 0;
  let shortlist: ParamSet[];
  if (input.fixedParams) {
    shortlist = [input.fixedParams];
    configurationsTested = 1;
  } else {
    const opt = optimise({ ...common, candles: trainCandles }, template, {
      maxConfigs: input.maxConfigs ?? 200,
      seed: input.base.seed,
      minTrades: t.minTrades,
      maxDrawdown: t.maxDrawdown,
    });
    configurationsTested = opt.configurationsTested;
    shortlist = opt.candidates.slice(0, input.topK ?? 5).map((c) => c.params);
  }

  // 2. Compare shortlist on VALIDATION (selection only, no fitting).
  let best: { params: ParamSet; train: BacktestResult; val: BacktestResult; score: number } | null = null;
  for (const params of shortlist) {
    const train = runBacktest({ ...common, candles: trainCandles, template, params });
    const val = runBacktest({ ...common, candles: valWithWarmup, template, params, tradeFromTime: valStart });
    const score = compositeObjective({ train: train.metrics, oos: val.metrics, minTrades: t.minTrades, maxDrawdown: t.maxDrawdown }).score;
    if (!best || score > best.score) best = { params, train, val, score };
  }
  if (!best) throw new Error("No candidate parameters produced");

  // 3. Parameter stability on TRAIN.
  const stability = parameterStability({ ...common, candles: trainCandles }, template, best.params);

  // 4. Walk-forward across TRAIN+VALIDATION.
  const researchCandles = part.research();
  const wf = walkForward(researchCandles, common, template, {
    trainBars: t.walkForward.trainBars,
    testBars: t.walkForward.testBars,
    stepBars: t.walkForward.stepBars,
    maxConfigsPerWindow: t.walkForward.maxConfigsPerWindow,
    minTrades: t.minTrades,
    maxDrawdown: t.maxDrawdown,
    ...(input.walkForwardMode === "fixed" && input.fixedParams ? { fixedParams: input.fixedParams } : {}),
  });
  configurationsTested += wf.configurationsTested;

  // 5. Monte Carlo on VALIDATION trades.
  const stakeFraction = D(input.base.stake).div(input.base.initialCapital).toNumber();
  const valTrades = best.val.trades;
  const feeFraction = valTrades.length ? mean(valTrades.map((x) => x.fees.div(x.stake).toNumber())) : 0;
  const mc = monteCarlo(
    valTrades.map((x) => ({ returnOnStake: x.returnOnStake, stakeFraction, win: x.win })),
    {
      simulations: t.monteCarlo.simulations,
      seed: input.base.seed,
      ruinDrawdown: t.monteCarlo.ruinDrawdown,
      slippageSd: t.monteCarlo.slippageSd,
      missedTradeProbability: t.monteCarlo.missedTradeProbability,
      feeMultiplierMax: t.monteCarlo.feeMultiplierMax,
      baseFeeFraction: feeFraction,
      payoutVariation: t.monteCarlo.payoutVariation,
      latencyProbability: 0.05,
    },
  );

  // 6. Deflated Sharpe with the programme-wide trial count.
  const rets = valTrades.map((x) => x.returnOnStake);
  const perTradeSharpe = stddev(rets) > 0 ? mean(rets) / stddev(rets) : 0;
  const trials = input.priorTrials + configurationsTested;
  const dsr = deflatedSharpe({
    sharpe: perTradeSharpe,
    observations: rets.length,
    skewness: skewness(rets),
    kurtosis: kurtosis(rets),
    trials,
  });

  // 7. Benchmarks on VALIDATION.
  const bench = compareToBenchmarks(best.val.metrics, { ...common, candles: valWithWarmup, tradeFromTime: valStart });

  // 8. Regime analysis on VALIDATION.
  const regimes = classifyRegimes(valWithWarmup);
  const regimeStats = regimeBreakdown(valTrades, valWithWarmup, regimes);

  const checks: CheckResult[] = [
    ...minimumRequirementChecks(best.train.metrics, t, "train"),
    check("OOS positive expectancy", best.val.metrics.expectancyR > t.minOosExpectancyR, `validation E[R] ${best.val.metrics.expectancyR.toFixed(4)}`),
    check("OOS profit factor", best.val.metrics.profitFactor >= t.minProfitFactor, `validation PF ${best.val.metrics.profitFactor.toFixed(2)}`),
    check("OOS drawdown", best.val.metrics.maxDrawdown <= t.maxDrawdown, `validation DD ${(best.val.metrics.maxDrawdown * 100).toFixed(1)}%`),
    check("Parameter stability", stability.score >= t.minStabilityScore, `score ${stability.score.toFixed(0)} (min ${t.minStabilityScore})`),
    check(
      "Walk-forward majority profitable",
      wf.windows.length > 0 && wf.profitableFraction > t.walkForward.minProfitableFraction,
      `${wf.profitableWindows}/${wf.windows.length} windows profitable`,
    ),
    check(
      "Monte Carlo ruin probability",
      mc.probabilityOfRuin <= t.monteCarlo.maxRuinProbability,
      `P(ruin) ${(mc.probabilityOfRuin * 100).toFixed(2)}% over ${mc.simulations} sims`,
    ),
    check(
      "Deflated Sharpe (multiple testing)",
      dsr.deflatedSharpeProbability >= t.minDeflatedSharpeProbability,
      `DSR ${dsr.deflatedSharpeProbability.toFixed(3)} after ${trials} trials`,
    ),
    check("Beats benchmarks", bench.passed, bench.notes.join("; ") || "beats all benchmarks"),
    check("Edge not confined to one regime", !regimeConcentrated(regimeStats), "regime breakdown"),
  ];

  return {
    template: template.key,
    symbol: input.dataset.symbol,
    datasetVersion: input.dataset.version,
    selectedParams: best.params,
    configurationsTested,
    train: best.train.metrics,
    validation: best.val.metrics,
    stability,
    walkForward: wf,
    monteCarlo: mc,
    deflatedSharpe: dsr,
    benchmarks: bench,
    regimes: regimeStats,
    checks,
    passed: checks.every((c) => c.passed),
    runHashes: { train: best.train.manifest.runHash, validation: best.val.manifest.runHash },
    validationTrades: best.val.trades,
    validationEquity: best.val.equity,
  };
}

export interface HoldoutResult {
  metrics: BacktestMetrics;
  passed: boolean;
  checks: CheckResult[];
  runHash: string;
}

/**
 * Evaluates a FROZEN strategy version on the locked TEST period exactly once.
 * Throws LockedPeriodViolation if the version is not frozen.
 */
export function evaluateHoldout(input: {
  dataset: Dataset;
  periods: LockedPeriods;
  strategy: FrozenStrategyRef & { template: string; parameters: ParamSet };
  thresholds: ValidationThresholds;
  base: Pick<BacktestConfig, "instrument" | "stake" | "initialCapital" | "seed">;
  warmupBars?: number;
}): HoldoutResult {
  const part = new DataPartitioner(input.dataset, input.periods);
  const test = part.test(input.strategy);
  if (test.length === 0) throw new Error("Dataset does not cover the locked TEST period");
  const start = (test[0] as Candle).time;
  const candles = [...part.warmupBefore(start, input.warmupBars ?? 400), ...test];
  const r = runBacktest({
    candles,
    symbol: input.dataset.symbol,
    timeframe: input.dataset.timeframe,
    datasetVersion: input.dataset.version,
    template: input.strategy.template,
    params: input.strategy.parameters,
    tradeFromTime: start,
    ...input.base,
  });
  const checks = [
    check("TEST positive expectancy", r.metrics.expectancyR > 0, `E[R] ${r.metrics.expectancyR.toFixed(4)}`),
    check("TEST profit factor", r.metrics.profitFactor >= input.thresholds.minProfitFactor, `PF ${r.metrics.profitFactor.toFixed(2)}`),
    check("TEST drawdown", r.metrics.maxDrawdown <= input.thresholds.maxDrawdown, `DD ${(r.metrics.maxDrawdown * 100).toFixed(1)}%`),
  ];
  return { metrics: r.metrics, passed: checks.every((c) => c.passed), checks, runHash: r.manifest.runHash };
}
