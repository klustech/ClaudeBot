import { normCdf, normInv } from "@ct/shared";

const EULER_GAMMA = 0.5772156649015329;

/**
 * Expected maximum Sharpe ratio among N independent trials with variance V
 * of Sharpe estimates under the null of zero skill (Bailey & López de Prado, 2014).
 */
export function expectedMaxSharpe(nTrials: number, trialSharpeVariance: number): number {
  if (nTrials <= 1) return 0;
  const sd = Math.sqrt(Math.max(trialSharpeVariance, 0));
  return sd * ((1 - EULER_GAMMA) * normInv(1 - 1 / nTrials) + EULER_GAMMA * normInv(1 - 1 / (nTrials * Math.E)));
}

/**
 * Probabilistic Sharpe Ratio: P(true SR > benchmark SR) given T observations,
 * skewness and (non-excess) kurtosis of returns. Sharpe values are per-period
 * (NOT annualised).
 */
export function probabilisticSharpe(sr: number, benchmarkSr: number, T: number, skew: number, kurt: number): number {
  if (T < 2) return 0;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return normCdf(((sr - benchmarkSr) * Math.sqrt(T - 1)) / denom);
}

export interface DeflatedSharpeInput {
  /** Observed per-trade (or per-period) Sharpe ratio of the selected strategy. */
  sharpe: number;
  /** Number of observations (trades). */
  observations: number;
  skewness: number;
  kurtosis: number;
  /** Total number of hypotheses/configurations tested in the research programme. */
  trials: number;
  /** Variance of Sharpe estimates across trials; if omitted, the null estimator 1/T is used. */
  trialSharpeVariance?: number;
}

export interface DeflatedSharpeResult {
  expectedMaxSharpe: number;
  deflatedSharpeProbability: number;
  trials: number;
}

/**
 * Deflated Sharpe Ratio: PSR evaluated against the Sharpe one would expect
 * from the best of N skill-less trials. Penalises extensive experimentation.
 */
export function deflatedSharpe(input: DeflatedSharpeInput): DeflatedSharpeResult {
  const v = input.trialSharpeVariance ?? 1 / Math.max(1, input.observations);
  const sr0 = expectedMaxSharpe(Math.max(1, input.trials), v);
  return {
    expectedMaxSharpe: sr0,
    deflatedSharpeProbability: probabilisticSharpe(input.sharpe, sr0, input.observations, input.skewness, input.kurtosis),
    trials: input.trials,
  };
}
