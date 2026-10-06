import { D, type Money } from "@ct/shared";

export interface CapitalStageEvidence {
  tradesAtStage: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdown: number;
  /** Live expectancy relative to paper expectancy (1 = identical). */
  liveToPaperRatio: number;
  infrastructureIncidents: number;
}

/**
 * Progressive live capital: Stage 0 = paper; stages 1..n map to the ceilings
 * in config/risk-limits.json LIVE_CAPITAL_STAGES (e.g. 25, 50, 100, 250, normal).
 * Promotion is performance-based, never time-based, and one stage at a time.
 */
export function stageCeiling(stages: readonly string[], stage: number): Money | null {
  if (stage <= 0) return null;
  const v = stages[Math.min(stage, stages.length) - 1];
  return v === undefined || v === "normal" ? null : D(v);
}

export function evaluateCapitalPromotion(
  current: number,
  maxStage: number,
  ev: CapitalStageEvidence,
  req = { minTrades: 100, minProfitFactor: 1.1, maxDrawdown: 0.1, minLiveToPaper: 0.5 },
): { promote: boolean; demote: boolean; next: number; reasons: string[] } {
  const reasons: string[] = [];
  if (ev.infrastructureIncidents > 0) reasons.push(`${ev.infrastructureIncidents} infrastructure incidents`);
  if (ev.expectancyR <= 0) reasons.push("non-positive live expectancy");
  if (ev.maxDrawdown > req.maxDrawdown) reasons.push("drawdown above stage limit");
  const demote = ev.tradesAtStage >= 30 && (ev.expectancyR < 0 || ev.maxDrawdown > req.maxDrawdown);
  if (ev.tradesAtStage < req.minTrades) reasons.push(`only ${ev.tradesAtStage}/${req.minTrades} trades at stage`);
  if (ev.profitFactor < req.minProfitFactor) reasons.push(`PF ${ev.profitFactor.toFixed(2)} < ${req.minProfitFactor}`);
  if (ev.liveToPaperRatio < req.minLiveToPaper) reasons.push("live/paper gap too large");
  const promote = !demote && reasons.length === 0 && current < maxStage;
  return { promote, demote, next: demote ? Math.max(0, current - 1) : promote ? current + 1 : current, reasons };
}
