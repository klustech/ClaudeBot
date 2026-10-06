import type { BacktestMetrics } from "@ct/backtesting";
import { clamp } from "@ct/shared";
import type { ValidationReport, ValidationThresholds } from "@ct/validation";

export interface ResearchQuality {
  hypothesis: string;
  rationale: string;
  invalidation: string;
  expectedRegimes: readonly string[];
}

export interface ForwardEvidence {
  trades: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdown: number;
  /** |forward E[R] − OOS E[R]| / |OOS E[R]| */
  deviationFromOos: number;
}

export interface ScoreCard {
  research: number;
  backtest: number;
  validation: number;
  stability: number;
  risk: number;
  forward: number | null;
  confidence: number;
  approved: boolean;
  notes: string[];
}

const WEIGHTS = { research: 0.05, backtest: 0.15, validation: 0.3, stability: 0.15, risk: 0.15, forward: 0.2 };

/** Rewards falsifiable, well-specified hypotheses. */
export function researchScore(r: ResearchQuality): number {
  let s = 0;
  if (r.hypothesis.trim().length >= 40) s += 40;
  else if (r.hypothesis.trim()) s += 20;
  if (r.rationale.trim().length >= 30) s += 25;
  if (r.invalidation.trim().length >= 20) s += 25;
  if (r.expectedRegimes.length > 0) s += 10;
  return s;
}

export function backtestScore(m: BacktestMetrics, t: ValidationThresholds): number {
  const trades = clamp(m.tradeCount / t.preferredTrades, 0, 1);
  const pf = clamp((m.profitFactor - 1) / (t.preferredProfitFactor - 1), 0, 1);
  const exp = m.expectancyR > 0 ? clamp(m.expectancyR * 10, 0, 1) : 0;
  const dd = clamp(1 - m.maxDrawdown / t.maxDrawdown, 0, 1);
  const sharpe = clamp(m.sharpe / 2, 0, 1);
  return 100 * (0.25 * trades + 0.25 * pf + 0.2 * exp + 0.15 * dd + 0.15 * sharpe);
}

export function validationScore(r: ValidationReport, t: ValidationThresholds): number {
  const oos = r.validation.expectancyR > 0 ? clamp(r.validation.expectancyR * 10, 0, 1) : 0;
  const oosPf = clamp((r.validation.profitFactor - 1) / (t.preferredProfitFactor - 1), 0, 1);
  const wf = clamp(r.walkForward.profitableFraction, 0, 1);
  const dsr = clamp(r.deflatedSharpe.deflatedSharpeProbability, 0, 1);
  const bench = r.benchmarks.passed ? 1 : 0;
  return 100 * (0.25 * oos + 0.15 * oosPf + 0.25 * wf + 0.25 * dsr + 0.1 * bench);
}

export function riskScore(r: ValidationReport, t: ValidationThresholds): number {
  const dd = clamp(1 - r.validation.maxDrawdown / t.maxDrawdown, 0, 1);
  const ruin = clamp(1 - r.monteCarlo.probabilityOfRuin / Math.max(1e-6, t.monteCarlo.maxRuinProbability * 5), 0, 1);
  const mcdd = clamp(1 - r.monteCarlo.p95MaxDrawdown / (2 * t.maxDrawdown), 0, 1);
  const streak = clamp(1 - r.monteCarlo.p95LongestLosingStreak / 30, 0, 1);
  return 100 * (0.3 * dd + 0.3 * ruin + 0.25 * mcdd + 0.15 * streak);
}

export function forwardScore(f: ForwardEvidence, t: ValidationThresholds): number {
  const sample = clamp(f.trades / (t.paperGraduationTrades[t.paperGraduationTrades.length - 1] ?? 1000), 0, 1);
  const exp = f.expectancyR > 0 ? clamp(f.expectancyR * 10, 0, 1) : 0;
  const pf = clamp((f.profitFactor - 1) / (t.preferredProfitFactor - 1), 0, 1);
  const dev = clamp(1 - f.deviationFromOos / t.paperMaxDeviationFromOos, 0, 1);
  const dd = clamp(1 - f.maxDrawdown / t.paperMaxDrawdown, 0, 1);
  return 100 * (0.2 * sample + 0.25 * exp + 0.2 * pf + 0.2 * dev + 0.15 * dd);
}

/**
 * Combines component scores into a 0-100 confidence score. Without forward
 * (paper/holdout) evidence, the score is capped below the approval threshold
 * so nothing reaches APPROVED on backtests alone.
 */
export function scoreStrategy(input: {
  research: ResearchQuality;
  report: ValidationReport;
  thresholds: ValidationThresholds;
  forward?: ForwardEvidence;
}): ScoreCard {
  const t = input.thresholds;
  const parts = {
    research: researchScore(input.research),
    backtest: backtestScore(input.report.train, t),
    validation: validationScore(input.report, t),
    stability: input.report.stability.score,
    risk: riskScore(input.report, t),
    forward: input.forward ? forwardScore(input.forward, t) : null,
  };
  const notes: string[] = [];
  let wsum = 0;
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const v = parts[k];
    if (v === null) continue;
    wsum += w;
    total += w * v;
  }
  let confidence = wsum > 0 ? total / wsum : 0;
  if (parts.forward === null) {
    confidence = Math.min(confidence, t.minConfidence - 1);
    notes.push("no forward evidence: confidence capped below approval threshold");
  }
  const failed = input.report.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    confidence = Math.min(confidence, 50);
    notes.push(`failed checks: ${failed.map((c) => c.name).join(", ")}`);
  }
  confidence = Math.round(clamp(confidence, 0, 100) * 10) / 10;
  return { ...parts, confidence, approved: confidence >= t.minConfidence && failed.length === 0, notes };
}

/** Ranks candidates by confidence then validation score. */
export function rankScoreCards<T extends { score: ScoreCard }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => b.score.confidence - a.score.confidence || b.score.validation - a.score.validation);
}
