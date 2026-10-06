import { LifecycleViolation, STRATEGY_STAGES, type StrategyStage, type TradingMode } from "@ct/shared";

/**
 * Strategy lifecycle. Forward progression is strictly one stage at a time;
 * no stage may be skipped. Demotions and retirement are always permitted
 * along the explicitly listed edges.
 *
 *   IDEA → RESEARCH → BACKTESTED → VALIDATING → INCUBATING → PAPER → APPROVED → LIVE
 *   LIVE → DEGRADED → PAPER (automatic demotion) | RETIRED
 *   any non-retired stage → RETIRED
 */
const FORWARD: Record<StrategyStage, StrategyStage | null> = {
  IDEA: "RESEARCH",
  RESEARCH: "BACKTESTED",
  BACKTESTED: "VALIDATING",
  VALIDATING: "INCUBATING",
  INCUBATING: "PAPER",
  PAPER: "APPROVED",
  APPROVED: "LIVE",
  LIVE: null,
  DEGRADED: null,
  RETIRED: null,
};

const DEMOTIONS: Partial<Record<StrategyStage, readonly StrategyStage[]>> = {
  PAPER: ["DEGRADED"],
  APPROVED: ["PAPER", "DEGRADED"],
  LIVE: ["DEGRADED"],
  DEGRADED: ["PAPER"],
};

export function nextStage(stage: StrategyStage): StrategyStage | null {
  return FORWARD[stage];
}

export function allowedTransitions(from: StrategyStage): StrategyStage[] {
  const out: StrategyStage[] = [];
  const fwd = FORWARD[from];
  if (fwd) out.push(fwd);
  out.push(...(DEMOTIONS[from] ?? []));
  if (from !== "RETIRED") out.push("RETIRED");
  return out;
}

export function canTransition(from: StrategyStage, to: StrategyStage): boolean {
  return allowedTransitions(from).includes(to);
}

export function assertTransition(from: StrategyStage, to: StrategyStage): void {
  if (!canTransition(from, to)) {
    throw new LifecycleViolation(`Illegal lifecycle transition ${from} → ${to}`, {
      from,
      to,
      allowed: allowedTransitions(from),
    });
  }
}

export function isForward(from: StrategyStage, to: StrategyStage): boolean {
  return FORWARD[from] === to;
}

export function stageIndex(stage: StrategyStage): number {
  return STRATEGY_STAGES.indexOf(stage);
}

/** The minimum lifecycle stage a strategy must be in to trade in a given mode. */
export function stageAllowedToTrade(stage: StrategyStage, mode: TradingMode): boolean {
  switch (mode) {
    case "PAPER":
      return stage === "PAPER" || stage === "APPROVED" || stage === "LIVE";
    case "TESTNET":
      return stage === "APPROVED" || stage === "LIVE";
    case "LIVE":
      return stage === "LIVE";
    default:
      return false;
  }
}
