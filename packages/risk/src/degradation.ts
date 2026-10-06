import { mean, normCdf, stddev } from "@ct/shared";

export interface ExpectedDistribution {
  /** Expected per-trade return on stake from OOS validation. */
  expectancyR: number;
  /** Stdev of per-trade returns from OOS validation. */
  returnSd: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
}

export interface DegradationResult {
  degraded: boolean;
  reasons: string[];
  rollingWinRate: number;
  rollingExpectancyR: number;
  rollingProfitFactor: number;
  pValueExpectancy: number;
  pValueWinRate: number;
  trades: number;
}

/**
 * Compares a rolling window of paper/live trades against the expected
 * distribution. Uses one-sided z-tests on expectancy and win-rate plus a
 * drawdown bound. Requires a minimum sample before acting.
 */
export function detectDegradation(
  returns: readonly number[],
  expected: ExpectedDistribution,
  opts: { window?: number; minTrades?: number; alpha?: number; currentDrawdown?: number; drawdownMultiple?: number } = {},
): DegradationResult {
  const window = opts.window ?? 100;
  const minTrades = opts.minTrades ?? 30;
  const alpha = opts.alpha ?? 0.01;
  const recent = returns.slice(-window);
  const n = recent.length;
  const wins = recent.filter((r) => r > 0);
  const losses = recent.filter((r) => r <= 0);
  const rollingWinRate = n ? wins.length / n : 0;
  const rollingExpectancyR = mean(recent);
  const gl = -losses.reduce((a, b) => a + b, 0);
  const rollingProfitFactor = gl > 0 ? wins.reduce((a, b) => a + b, 0) / gl : wins.length ? 999 : 0;
  const reasons: string[] = [];
  let pE = 1;
  let pW = 1;
  if (n >= minTrades) {
    const sd = expected.returnSd > 0 ? expected.returnSd : stddev(recent) || 1;
    const zE = (rollingExpectancyR - expected.expectancyR) / (sd / Math.sqrt(n));
    pE = normCdf(zE);
    const p0 = Math.min(0.999, Math.max(0.001, expected.winRate));
    const zW = (rollingWinRate - p0) / Math.sqrt((p0 * (1 - p0)) / n);
    pW = normCdf(zW);
    if (pE < alpha) reasons.push(`expectancy ${rollingExpectancyR.toFixed(4)} significantly below expected ${expected.expectancyR.toFixed(4)} (p=${pE.toFixed(4)})`);
    if (pW < alpha) reasons.push(`win rate ${(rollingWinRate * 100).toFixed(1)}% significantly below expected ${(p0 * 100).toFixed(1)}% (p=${pW.toFixed(4)})`);
    if (rollingExpectancyR < 0 && rollingProfitFactor < 1) reasons.push("rolling expectancy negative");
  }
  if (opts.currentDrawdown !== undefined && opts.currentDrawdown > expected.maxDrawdown * (opts.drawdownMultiple ?? 1.5)) {
    reasons.push(`drawdown ${(opts.currentDrawdown * 100).toFixed(1)}% exceeds ${(opts.drawdownMultiple ?? 1.5)}× expected`);
  }
  return {
    degraded: reasons.length > 0,
    reasons,
    rollingWinRate,
    rollingExpectancyR,
    rollingProfitFactor,
    pValueExpectancy: pE,
    pValueWinRate: pW,
    trades: n,
  };
}
