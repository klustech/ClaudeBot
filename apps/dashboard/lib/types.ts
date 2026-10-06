export interface StrategyVersion {
  id: string;
  strategyId: string;
  version: number;
  name: string;
  template: string;
  family: string;
  market: string;
  timeframe: string;
  hypothesis: string;
  rationale: string;
  invalidation: string;
  expectedRegimes: string[];
  parameters: Record<string, unknown>;
  genomeParent: string | null;
  mutations: string[];
  generation: number;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  frozenAt: string | null;
  stage: string;
  liveEligible: boolean;
  evidence: Record<string, unknown>;
  confidence: number | null;
}

export interface BacktestRun {
  id: string;
  experimentId: string | null;
  strategyVersionId: string | null;
  template: string;
  market: string;
  timeframe: string;
  partition: string;
  runHash: string;
  datasetVersion: string;
  metrics: Record<string, number | string | null>;
  netProfit: string;
  expectancy: string;
  tradeCount: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  source: string;
  createdAt: string;
}

export interface Trade {
  id: number;
  sessionKind: string;
  strategyVersionId: string | null;
  market: string;
  direction: string;
  entryTime: string;
  exitTime: string;
  entryPrice: string;
  exitPrice: string;
  stake: string;
  fees: string;
  pnl: string;
  returnOnStake: number;
  exitReason: string | null;
  win: boolean;
}

export interface Experiment {
  id: string;
  number: number;
  campaignId: string | null;
  strategyVersionId: string | null;
  template: string | null;
  market: string | null;
  kind: string;
  status: string;
  hypothesis: string | null;
  configurationsTested: number;
  datasetVersion: string | null;
  codeHash: string | null;
  engineVersion: string | null;
  seed: number | null;
  verdict: string | null;
  resultSummary: Record<string, unknown> | null;
  source: string;
  createdAt: string;
}

export interface Decision {
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
  actor: string;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationRun {
  id: string;
  strategyVersionId: string;
  kind: string;
  passed: boolean;
  checks: Check[];
  report: Record<string, unknown>;
  scoreCard: Record<string, unknown> | null;
  confidence: number | null;
  trials: number;
  createdAt: string;
}

export interface ExecutorStatus {
  mode: string;
  sessionId: string | null;
  venue: string;
  equity: string;
  startingBalance: string;
  currency: string;
  drawdown: number;
  exposure: string;
  killSwitch: { engaged: boolean; reason?: string };
  breakers: { name: string; reason: string; at: number; scope: string }[];
  openPositions: { orderId: string; strategyVersionId: string; market: string; stake: string }[];
  strategies: { id: string; market: string; stage: string; confidence: number | null }[];
  markets: { market: string; timeframe: string; dataAgeMs: number | null; lastPrice: number | null }[];
  stateKnown: boolean;
  consecutiveLosses: number;
}
