import { mean, quantile, SeededRandom } from "@ct/shared";

export interface MonteCarloTrade {
  /** P&L as a fraction of stake. */
  returnOnStake: number;
  /** Stake as a fraction of starting capital. */
  stakeFraction: number;
  win: boolean;
}

export interface MonteCarloOptions {
  simulations: number;
  seed: number;
  /** Equity drawdown (fraction) that counts as ruin. */
  ruinDrawdown: number;
  /** Stdev of extra slippage per trade, as fraction of stake. */
  slippageSd: number;
  missedTradeProbability: number;
  /** Fees are multiplied by U(1, feeMultiplierMax). */
  feeMultiplierMax: number;
  /** Fee per trade as fraction of stake (base). */
  baseFeeFraction: number;
  /** Relative variation in winning payouts, e.g. 0.05 = ±5%. */
  payoutVariation: number;
  /** Probability a fill is delayed (latency) and suffers 2× slippage. */
  latencyProbability?: number;
}

export interface MonteCarloResult {
  simulations: number;
  medianReturn: number;
  p05Return: number;
  p95Return: number;
  meanReturn: number;
  probabilityOfRuin: number;
  probabilityOfLoss: number;
  expectedMaxDrawdown: number;
  p95MaxDrawdown: number;
  expectedLongestLosingStreak: number;
  p95LongestLosingStreak: number;
}

/**
 * Bootstrap Monte Carlo over a trade list: resamples trade order, perturbs
 * slippage, fees, latency, payout and drops random trades. Uses compounding
 * on fractional stakes.
 */
export function monteCarlo(trades: readonly MonteCarloTrade[], opts: MonteCarloOptions): MonteCarloResult {
  const rng = new SeededRandom(opts.seed);
  const n = trades.length;
  const finals: number[] = [];
  const mdds: number[] = [];
  const streaks: number[] = [];
  let ruined = 0;
  if (n === 0) {
    return {
      simulations: 0,
      medianReturn: 0,
      p05Return: 0,
      p95Return: 0,
      meanReturn: 0,
      probabilityOfRuin: 1,
      probabilityOfLoss: 1,
      expectedMaxDrawdown: 0,
      p95MaxDrawdown: 0,
      expectedLongestLosingStreak: 0,
      p95LongestLosingStreak: 0,
    };
  }
  for (let s = 0; s < opts.simulations; s++) {
    let equity = 1;
    let peak = 1;
    let mdd = 0;
    let streak = 0;
    let worstStreak = 0;
    let isRuined = false;
    const feeMult = 1 + rng.next() * (opts.feeMultiplierMax - 1);
    for (let k = 0; k < n; k++) {
      const t = trades[rng.int(0, n)] as MonteCarloTrade; // bootstrap with replacement
      if (rng.bool(opts.missedTradeProbability)) continue;
      let r = t.returnOnStake;
      if (t.win && opts.payoutVariation > 0) r *= 1 + (rng.next() * 2 - 1) * opts.payoutVariation;
      const latencyMult = opts.latencyProbability && rng.bool(opts.latencyProbability) ? 2 : 1;
      r -= Math.abs(rng.normal(0, opts.slippageSd)) * latencyMult;
      r -= opts.baseFeeFraction * (feeMult - 1);
      equity += equity * t.stakeFraction * r;
      if (equity <= 0) {
        equity = 0;
        isRuined = true;
      }
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 1;
      if (dd > mdd) mdd = dd;
      if (dd >= opts.ruinDrawdown) isRuined = true;
      if (r < 0) {
        streak++;
        if (streak > worstStreak) worstStreak = streak;
      } else streak = 0;
      if (equity === 0) break;
    }
    if (isRuined) ruined++;
    finals.push(equity - 1);
    mdds.push(mdd);
    streaks.push(worstStreak);
  }
  return {
    simulations: opts.simulations,
    medianReturn: quantile(finals, 0.5),
    p05Return: quantile(finals, 0.05),
    p95Return: quantile(finals, 0.95),
    meanReturn: mean(finals),
    probabilityOfRuin: ruined / opts.simulations,
    probabilityOfLoss: finals.filter((f) => f < 0).length / opts.simulations,
    expectedMaxDrawdown: mean(mdds),
    p95MaxDrawdown: quantile(mdds, 0.95),
    expectedLongestLosingStreak: mean(streaks),
    p95LongestLosingStreak: quantile(streaks, 0.95),
  };
}
