import type { StrategyStage } from "@ct/shared";
import { assertTransition, isForward } from "./lifecycle";

/** Evidence accumulated for a strategy version; each gate checks a subset. */
export interface PromotionEvidence {
  hypothesisRecorded?: boolean;
  backtestPassed?: boolean;
  backtestTrades?: number;
  oosPassed?: boolean;
  walkForwardPassed?: boolean;
  monteCarloPassed?: boolean;
  stabilityPassed?: boolean;
  deflatedSharpePassed?: boolean;
  benchmarkPassed?: boolean;
  confidenceScore?: number;
  frozen?: boolean;
  incubationPassed?: boolean;
  paperPassed?: boolean;
  paperTrades?: number;
  riskPassed?: boolean;
  humanApproval?: boolean;
}

export interface GateResult {
  readonly allowed: boolean;
  readonly failures: string[];
}

export interface GateOptions {
  minConfidence: number;
  minPaperTrades: number;
  liveTradingEnabled: boolean;
}

function need(cond: boolean | undefined, label: string, failures: string[]): void {
  if (!cond) failures.push(label);
}

/**
 * Promotion gates for forward transitions. Demotions and retirement are not
 * gated (safety actions must never be blocked).
 */
export function evaluateGate(
  from: StrategyStage,
  to: StrategyStage,
  ev: PromotionEvidence,
  opts: GateOptions,
): GateResult {
  assertTransition(from, to);
  const failures: string[] = [];
  if (!isForward(from, to)) return { allowed: true, failures };

  switch (to) {
    case "RESEARCH":
      need(ev.hypothesisRecorded, "hypothesis must be recorded", failures);
      break;
    case "BACKTESTED":
      need(ev.backtestTrades !== undefined && ev.backtestTrades > 0, "at least one completed backtest", failures);
      break;
    case "VALIDATING":
      need(ev.backtestPassed, "backtest minimum requirements PASS", failures);
      break;
    case "INCUBATING":
      need(ev.frozen, "strategy version must be frozen before holdout testing", failures);
      need(ev.oosPassed, "out-of-sample PASS", failures);
      need(ev.walkForwardPassed, "walk-forward PASS", failures);
      need(ev.monteCarloPassed, "Monte Carlo PASS", failures);
      need(ev.stabilityPassed, "parameter stability PASS", failures);
      need(ev.deflatedSharpePassed, "multiple-testing (deflated Sharpe) PASS", failures);
      need(ev.benchmarkPassed, "beats benchmarks", failures);
      if ((ev.confidenceScore ?? 0) < opts.minConfidence) {
        failures.push(`confidence ${ev.confidenceScore ?? 0} < ${opts.minConfidence}`);
      }
      break;
    case "PAPER":
      need(ev.incubationPassed ?? ev.frozen, "incubation review complete", failures);
      break;
    case "APPROVED":
      need(ev.paperPassed, "paper promotion gate PASS", failures);
      if ((ev.paperTrades ?? 0) < opts.minPaperTrades) {
        failures.push(`paper trades ${ev.paperTrades ?? 0} < ${opts.minPaperTrades}`);
      }
      need(ev.riskPassed, "risk review PASS", failures);
      break;
    case "LIVE":
      need(ev.backtestPassed, "backtest PASS", failures);
      need(ev.oosPassed, "OOS PASS", failures);
      need(ev.walkForwardPassed, "walk-forward PASS", failures);
      need(ev.monteCarloPassed, "Monte Carlo PASS", failures);
      need(ev.stabilityPassed, "parameter stability PASS", failures);
      need(ev.paperPassed, "paper PASS", failures);
      need(ev.riskPassed, "risk PASS", failures);
      need(ev.humanApproval, "explicit human approval", failures);
      need(opts.liveTradingEnabled, "LIVE_TRADING_ENABLED=true", failures);
      break;
    default:
      break;
  }
  return { allowed: failures.length === 0, failures };
}

/** All seven PASS conditions → LIVE_ELIGIBLE (activation still needs LIVE_TRADING_ENABLED). */
export function isLiveEligible(ev: PromotionEvidence): boolean {
  return Boolean(
    ev.backtestPassed &&
      ev.oosPassed &&
      ev.walkForwardPassed &&
      ev.monteCarloPassed &&
      ev.stabilityPassed &&
      ev.paperPassed &&
      ev.riskPassed,
  );
}
