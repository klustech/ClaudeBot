import { D, type Money, type MoneyInput, type Regime } from "@ct/shared";

export interface PortfolioStrategy {
  id: string;
  /** Annualised volatility of the strategy's return stream. */
  volatility: number;
  confidence: number;
  expectedRegimes: readonly string[];
}

export interface Allocation {
  id: string;
  weight: number;
  riskBudget: Money;
}

/**
 * Allocates a total risk budget across strategies with inverse-volatility
 * weights scaled by confidence, capped per strategy, so risk is managed at
 * the portfolio level rather than independently.
 */
export function allocateRisk(strategies: readonly PortfolioStrategy[], totalRiskBudget: MoneyInput, maxWeight = 0.35): Allocation[] {
  if (strategies.length === 0) return [];
  const raw = strategies.map((s) => (s.volatility > 0 ? 1 / s.volatility : 1) * Math.max(0, s.confidence / 100));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  let weights = raw.map((r) => r / sum);
  // Iteratively cap and redistribute.
  for (let iter = 0; iter < 10; iter++) {
    const excess = weights.reduce((a, w) => a + Math.max(0, w - maxWeight), 0);
    if (excess <= 1e-12) break;
    const uncapped = weights.filter((w) => w < maxWeight).reduce((a, w) => a + w, 0);
    weights = weights.map((w) => (w >= maxWeight ? maxWeight : uncapped > 0 ? w + (excess * w) / uncapped : w));
  }
  const budget = D(totalRiskBudget);
  return strategies.map((s, i) => ({ id: s.id, weight: weights[i] as number, riskBudget: budget.times(weights[i] as number) }));
}

/** Regime-aware strategy selector: only strategies whose expected regimes include the current one are eligible. */
export function eligibleForRegime<T extends { expectedRegimes: readonly string[] }>(strategies: readonly T[], regime: Regime): T[] {
  return strategies.filter((s) => s.expectedRegimes.length === 0 || s.expectedRegimes.includes(regime));
}
