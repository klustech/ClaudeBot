export const TRADING_MODES = ["RESEARCH", "BACKTEST", "VALIDATION", "PAPER", "TESTNET", "LIVE"] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

export const STRATEGY_STAGES = [
  "IDEA",
  "RESEARCH",
  "BACKTESTED",
  "VALIDATING",
  "INCUBATING",
  "PAPER",
  "APPROVED",
  "LIVE",
  "DEGRADED",
  "RETIRED",
] as const;
export type StrategyStage = (typeof STRATEGY_STAGES)[number];

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type Direction = "UP" | "DOWN";
/** +1 long / UP, -1 short / DOWN, 0 flat. */
export type Signal = -1 | 0 | 1;

export interface Candle {
  /** Open time, epoch milliseconds UTC. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export const REGIMES = ["TREND_UP", "TREND_DOWN", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "TRANSITION"] as const;
export type Regime = (typeof REGIMES)[number];

export type ParamValue = number | string | boolean;
export type ParamSet = Readonly<Record<string, ParamValue>>;

export type InstrumentKind = "linear" | "fixed-payout";
