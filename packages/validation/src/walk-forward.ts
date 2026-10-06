import { runBacktest, type BacktestConfig, type BacktestMetrics } from "@ct/backtesting";
import { optimise } from "@ct/optimisation";
import type { StrategyTemplate } from "@ct/strategies";
import { mean, variance, type Candle, type ParamSet } from "@ct/shared";

export interface WalkForwardWindow {
  index: number;
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  params: ParamSet;
  train: BacktestMetrics;
  test: BacktestMetrics;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  profitableWindows: number;
  profitableFraction: number;
  averageTestExpectancyR: number;
  worstWindowExpectancyR: number;
  bestWindowExpectancyR: number;
  testExpectancyVariance: number;
  configurationsTested: number;
}

export interface WalkForwardOptions {
  trainBars: number;
  testBars: number;
  stepBars: number;
  maxConfigsPerWindow: number;
  minTrades: number;
  maxDrawdown: number;
  /** If set, re-optimisation is skipped and these params are used in every window. */
  fixedParams?: ParamSet;
}

/**
 * Rolling walk-forward: optimise on each train window, evaluate the chosen
 * parameters on the following unseen test window, step forward, repeat.
 */
export function walkForward(
  candles: readonly Candle[],
  base: Omit<BacktestConfig, "template" | "params" | "candles">,
  template: StrategyTemplate,
  opts: WalkForwardOptions,
): WalkForwardResult {
  const windows: WalkForwardWindow[] = [];
  let tested = 0;
  for (let start = 0; start + opts.trainBars + opts.testBars <= candles.length; start += opts.stepBars) {
    const train = candles.slice(start, start + opts.trainBars);
    const testStartIdx = start + opts.trainBars;
    // Test slice includes the train window as indicator warm-up; trades only from test start.
    const testWithWarmup = candles.slice(start, testStartIdx + opts.testBars);
    const testFrom = (candles[testStartIdx] as Candle).time;
    let params: ParamSet;
    let trainMetrics: BacktestMetrics;
    if (opts.fixedParams) {
      params = opts.fixedParams;
      trainMetrics = runBacktest({ ...base, candles: train, template, params }).metrics;
      tested++;
    } else {
      const res = optimise({ ...base, candles: train }, template, {
        maxConfigs: opts.maxConfigsPerWindow,
        seed: base.seed + start,
        minTrades: Math.max(10, Math.floor(opts.minTrades * (opts.trainBars / candles.length))),
        maxDrawdown: opts.maxDrawdown,
      });
      tested += res.configurationsTested;
      const top = res.candidates[0];
      if (!top) continue;
      params = top.params;
      trainMetrics = top.metrics;
    }
    const test = runBacktest({ ...base, candles: testWithWarmup, template, params, tradeFromTime: testFrom }).metrics;
    windows.push({
      index: windows.length,
      trainFrom: (train[0] as Candle).time,
      trainTo: (train[train.length - 1] as Candle).time,
      testFrom,
      testTo: (candles[testStartIdx + opts.testBars - 1] as Candle).time,
      params,
      train: trainMetrics,
      test,
    });
  }
  const exps = windows.map((w) => w.test.expectancyR);
  const profitable = windows.filter((w) => Number(w.test.netProfit) > 0).length;
  return {
    windows,
    profitableWindows: profitable,
    profitableFraction: windows.length ? profitable / windows.length : 0,
    averageTestExpectancyR: mean(exps),
    worstWindowExpectancyR: exps.length ? Math.min(...exps) : 0,
    bestWindowExpectancyR: exps.length ? Math.max(...exps) : 0,
    testExpectancyVariance: variance(exps),
    configurationsTested: tested,
  };
}
