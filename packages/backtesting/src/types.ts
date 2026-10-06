import type { Direction, Money, ParamSet, Timeframe } from "@ct/shared";
import type { InstrumentModel } from "./instruments";

export type ExitReason = "expiry" | "stop" | "take" | "end_of_data";

export interface BacktestTrade {
  readonly index: number;
  readonly signalTime: number;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly direction: Direction;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly stake: Money;
  readonly fees: Money;
  readonly pnl: Money;
  /** pnl / stake (dimensionless). */
  readonly returnOnStake: number;
  readonly barsHeld: number;
  readonly exitReason: ExitReason;
  readonly win: boolean;
}

export interface EquityPoint {
  readonly time: number;
  readonly equity: number;
  readonly drawdown: number;
}

export interface BacktestMetrics {
  netProfit: string;
  netReturn: number;
  annualisedReturn: number;
  tradeCount: number;
  winRate: number;
  lossRate: number;
  averageWin: string;
  averageLoss: string;
  /** Expected value per trade in account currency. */
  expectancy: string;
  /** Expected value per trade as a fraction of stake. */
  expectancyR: number;
  profitFactor: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  recoveryFactor: number;
  longestLosingStreak: number;
  longestWinningStreak: number;
  exposure: number;
  averageHoldingBars: number;
  volatility: number;
  tailLoss: number;
  valueAtRisk95: number;
  conditionalValueAtRisk95: number;
  totalFees: string;
  breakEvenWinRate: number | null;
}

export interface ReproducibilityManifest {
  engineVersion: string;
  codeHash: string;
  datasetVersion: string;
  symbol: string;
  timeframe: Timeframe;
  template: string;
  parameters: ParamSet;
  instrument: InstrumentModel;
  stake: string;
  initialCapital: string;
  seed: number;
  from: number;
  to: number;
  runHash: string;
}

export interface BacktestResult {
  readonly trades: readonly BacktestTrade[];
  readonly equity: readonly EquityPoint[];
  readonly metrics: BacktestMetrics;
  readonly manifest: ReproducibilityManifest;
  /** Per-bar equity returns, used for correlation and Sharpe analysis. */
  readonly barReturns: readonly number[];
}
