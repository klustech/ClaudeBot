import { D, minMoney, type Money, type MoneyInput, ZERO } from "@ct/shared";

/** Fixed stake, capped at maxPositionPercent of equity. */
export function fixedStake(stake: MoneyInput, equity: MoneyInput, maxPositionPercent: number): Money {
  return minMoney(D(stake), D(equity).times(maxPositionPercent).div(100));
}

/**
 * Percentage-risk sizing: risk `riskPercent` of equity given a stop distance
 * expressed as a fraction of price. Returns notional.
 */
export function percentRiskNotional(equity: MoneyInput, riskPercent: number, stopDistanceFraction: number): Money {
  if (stopDistanceFraction <= 0) throw new RangeError("stop distance must be positive");
  return D(equity).times(riskPercent).div(100).div(stopDistanceFraction);
}

/** Volatility-adjusted notional targeting an annualised volatility contribution. */
export function volatilityAdjustedNotional(equity: MoneyInput, targetVol: number, instrumentVol: number): Money {
  if (instrumentVol <= 0) return ZERO;
  return D(equity).times(targetVol).div(instrumentVol);
}

/**
 * Kelly fraction for a fixed-payout bet: f* = (b·p − q) / b, where b is the
 * profit returned per unit risked and q = 1 − p. Negative → 0 (no bet).
 */
export function kellyFraction(p: number, b: number): Money {
  if (p < 0 || p > 1) throw new RangeError("p must be in [0,1]");
  if (b <= 0) throw new RangeError("b must be positive");
  const pp = D(p);
  const f = pp.times(b).minus(D(1).minus(pp)).div(b);
  return f.isNegative() ? ZERO : f;
}

export interface KellySizingInput {
  winProbability: number;
  payoutPerUnit: number;
  /** Fraction of Kelly to use (default 0.1; NEVER 1.0 by default). */
  kellyMultiplier?: number;
  /** 0..1 discount for uncertainty in the estimated win probability. */
  confidenceDiscount?: number;
  /** 0..1 discount when the current regime is unfavourable/uncertain. */
  regimeDiscount?: number;
  /** Hard cap as percent of equity. */
  maxPositionPercent: number;
}

/** effective = kelly × kellyMultiplier × confidenceDiscount × regimeDiscount, capped. */
export function effectiveKellyFraction(i: KellySizingInput): { raw: Money; effective: Money } {
  const raw = kellyFraction(i.winProbability, i.payoutPerUnit);
  const mult = i.kellyMultiplier ?? 0.1;
  if (mult > 0.5) throw new RangeError("kellyMultiplier above 0.5 is not permitted");
  const eff = raw
    .times(mult)
    .times(i.confidenceDiscount ?? 1)
    .times(i.regimeDiscount ?? 1);
  return { raw, effective: minMoney(eff, D(i.maxPositionPercent).div(100)) };
}

export function kellyStake(equity: MoneyInput, i: KellySizingInput): Money {
  return D(equity).times(effectiveKellyFraction(i).effective);
}
