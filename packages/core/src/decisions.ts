/** A Claude (or human/system) decision; every promotion/demotion is recorded as one. */
export interface DecisionRecord {
  id: string;
  timestamp: string;
  strategyId: string | null;
  action: string;
  reason: string;
  evidence: Record<string, unknown>;
  inputMetrics: Record<string, unknown>;
  outputDecision: string;
  model: string;
  sessionId: string;
  actor: "claude" | "human" | "system";
}
