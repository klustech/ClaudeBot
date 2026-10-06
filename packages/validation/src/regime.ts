import type { BacktestTrade } from "@ct/backtesting";
import { atr, ema, percentileRank } from "@ct/strategies";
import { mean, REGIMES, type Candle, type Regime } from "@ct/shared";

export interface RegimeOptions {
  emaPeriod?: number;
  slopeBars?: number;
  volLookback?: number;
  trendThreshold?: number;
}

/**
 * Per-bar regime classification (no look-ahead):
 *  - TREND_UP / TREND_DOWN when the EMA slope (normalised by ATR) is strong
 *  - HIGH_VOLATILITY / LOW_VOLATILITY when ATR% is in its top / bottom quintile
 *  - RANGE when slope is flat, TRANSITION otherwise
 */
export function classifyRegimes(candles: readonly Candle[], opts: RegimeOptions = {}): Regime[] {
  const emaP = opts.emaPeriod ?? 50;
  const slopeBars = opts.slopeBars ?? 20;
  const k = opts.trendThreshold ?? 1.5;
  const closesArr = candles.map((c) => c.close);
  const e = ema(closesArr, emaP);
  const a = atr(candles, 14);
  const atrPct = a.map((v, i) => v / (candles[i] as Candle).close);
  const volRank = percentileRank(atrPct, opts.volLookback ?? 200);
  return candles.map((_, i): Regime => {
    const ei = e[i];
    const ep = e[i - slopeBars];
    const ai = a[i];
    const vr = volRank[i];
    if (ei === undefined || ep === undefined || ai === undefined || Number.isNaN(ei) || Number.isNaN(ep) || Number.isNaN(ai) || ai === 0) {
      return "TRANSITION";
    }
    const slopeN = (ei - ep) / ai;
    if (slopeN > k) return "TREND_UP";
    if (slopeN < -k) return "TREND_DOWN";
    if (vr !== undefined && !Number.isNaN(vr)) {
      if (vr >= 0.8) return "HIGH_VOLATILITY";
      if (vr <= 0.2) return "LOW_VOLATILITY";
    }
    if (Math.abs(slopeN) < k / 2) return "RANGE";
    return "TRANSITION";
  });
}

export interface RegimeStats {
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  barShare: number;
}

export function regimeBreakdown(
  trades: readonly BacktestTrade[],
  candles: readonly Candle[],
  regimes: readonly Regime[],
): Record<Regime, RegimeStats> {
  const byTime = new Map<number, Regime>();
  candles.forEach((c, i) => byTime.set(c.time, regimes[i] as Regime));
  const out = {} as Record<Regime, RegimeStats>;
  for (const r of REGIMES) {
    const ts = trades.filter((t) => byTime.get(t.signalTime) === r);
    const wins = ts.filter((t) => t.returnOnStake > 0).reduce((a, t) => a + t.returnOnStake, 0);
    const losses = -ts.filter((t) => t.returnOnStake <= 0).reduce((a, t) => a + t.returnOnStake, 0);
    out[r] = {
      trades: ts.length,
      winRate: ts.length ? ts.filter((t) => t.win).length / ts.length : 0,
      expectancyR: mean(ts.map((t) => t.returnOnStake)),
      profitFactor: losses > 0 ? wins / losses : wins > 0 ? 999 : 0,
      barShare: regimes.length ? regimes.filter((x) => x === r).length / regimes.length : 0,
    };
  }
  return out;
}

/** True when the edge is concentrated in a single regime (fragile). */
export function regimeConcentrated(stats: Record<Regime, RegimeStats>, minTrades = 30): boolean {
  const positive = Object.values(stats).filter((s) => s.trades >= minTrades && s.expectancyR > 0).length;
  const total = Object.values(stats).filter((s) => s.trades >= minTrades).length;
  return total >= 2 && positive <= 1;
}
