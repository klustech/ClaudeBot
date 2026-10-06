import { stageAllowedToTrade } from "@ct/core";
import { D, type Direction, type Money, type StrategyStage, type TradingMode, ZERO } from "@ct/shared";
import type { CircuitBreakerBoard } from "./circuit-breakers";
import type { RiskLimits } from "./limits";

export interface TradeRequest {
  idempotencyKey: string;
  strategyVersionId: string;
  strategyStage: StrategyStage;
  liveEligible: boolean;
  market: string;
  direction: Direction;
  /** Requested stake/notional in account currency (decimal string). */
  stake: string;
  mode: TradingMode;
  /** Strategy confidence score 0-100. */
  confidence: number;
  /** Estimated edge per trade as a fraction of stake (EV/stake). */
  edge: number;
  signalTime: number;
  expectedSlippageBps?: number;
  quoteLatencyMs?: number;
  dataAgeMs?: number;
  /** Offered payout per unit stake for fixed-payout instruments. */
  payout?: number;
  /** Payout assumed by the strategy's validation; deviations trip a breaker. */
  expectedPayout?: number;
  requestedBy: "claude" | "executor" | "human";
}

export interface OpenExposure {
  strategyVersionId: string;
  market: string;
  stake: Money;
}

export interface RiskState {
  equity: Money;
  peakEquity: Money;
  startOfDayEquity: Money;
  startOfWeekEquity: Money;
  openPositions: readonly OpenExposure[];
  consecutiveLosses: number;
  /** Timestamps (ms) of trades opened in the trailing hour. */
  recentTradeTimes: readonly number[];
  /** Idempotency keys already accepted (any status). */
  seenIdempotencyKeys: ReadonlySet<string>;
  /** Venue/broker state is known and reconciled. */
  stateKnown: boolean;
}

export interface RiskContext {
  tradingEnabled: boolean;
  liveTradingEnabled: boolean;
  killSwitchEngaged: boolean;
  breakers: CircuitBreakerBoard;
  now: number;
  /** Absolute stake ceiling for the current progressive-capital stage (LIVE only). */
  liveStakeCeiling?: Money;
  /** Live-permitted strategy versions from config/live-permissions.json. */
  livePermittedStrategies?: readonly string[];
}

export interface RiskViolation {
  code: string;
  message: string;
}

export interface RiskDecision {
  approved: boolean;
  stake: Money;
  violations: RiskViolation[];
  evaluatedAt: number;
}

/**
 * The deterministic risk authority. Every trade request — from Claude, the
 * executor or a human — passes through evaluate(). It can only reject; it
 * never increases a stake. Any uncertainty results in rejection (fail closed).
 */
export class RiskEngine {
  constructor(private readonly limits: RiskLimits) {}

  get config(): RiskLimits {
    return this.limits;
  }

  evaluate(req: TradeRequest, state: RiskState, ctx: RiskContext): RiskDecision {
    const L = this.limits;
    const v: RiskViolation[] = [];
    const add = (code: string, message: string): void => {
      v.push({ code, message });
    };

    // --- Global permissions -------------------------------------------------
    if (ctx.killSwitchEngaged) add("KILL_SWITCH", "Global kill switch engaged");
    if (!ctx.tradingEnabled) add("TRADING_DISABLED", "TRADING_ENABLED=false");
    if (ctx.breakers.isHalted(req.strategyVersionId)) {
      add("CIRCUIT_BREAKER", `Open breakers: ${ctx.breakers.openBreakers().map((b) => b.name).join(", ")}`);
    }
    if (!state.stateKnown) add("UNKNOWN_STATE", "Broker/portfolio state unknown or unreconciled");
    if (!["PAPER", "TESTNET", "LIVE"].includes(req.mode)) add("MODE", `Mode ${req.mode} cannot place trades`);
    if (req.mode === "LIVE") {
      if (!ctx.liveTradingEnabled) add("LIVE_DISABLED", "LIVE_TRADING_ENABLED=false");
      if (!req.liveEligible) add("NOT_LIVE_ELIGIBLE", "Strategy has not passed every live gate");
      if (!ctx.livePermittedStrategies?.includes(req.strategyVersionId)) {
        add("NOT_LIVE_PERMITTED", "Strategy not listed in config/live-permissions.json");
      }
    }
    if (!stageAllowedToTrade(req.strategyStage, req.mode)) {
      add("STAGE", `Strategy stage ${req.strategyStage} may not trade in ${req.mode}`);
    }

    // --- Request integrity --------------------------------------------------
    let stake: Money = ZERO;
    try {
      stake = D(req.stake);
      if (stake.lte(0)) add("STAKE", "Stake must be positive");
    } catch {
      add("STAKE", "Stake is not a valid decimal");
    }
    if (!req.idempotencyKey) add("IDEMPOTENCY", "Missing idempotency key");
    else if (state.seenIdempotencyKeys.has(req.idempotencyKey)) add("DUPLICATE", `Duplicate instruction ${req.idempotencyKey}`);
    const signalAge = ctx.now - req.signalTime;
    if (!(signalAge >= 0) || signalAge > L.MAX_SIGNAL_AGE_MS) add("STALE_SIGNAL", `Signal age ${signalAge}ms > ${L.MAX_SIGNAL_AGE_MS}ms`);
    if (req.dataAgeMs === undefined || req.dataAgeMs > L.MAX_DATA_STALENESS_MS) {
      add("STALE_DATA", `Market data age ${req.dataAgeMs ?? "unknown"}ms > ${L.MAX_DATA_STALENESS_MS}ms`);
    }
    if (req.quoteLatencyMs !== undefined && req.quoteLatencyMs > L.MAX_LATENCY_MS) {
      add("LATENCY", `Latency ${req.quoteLatencyMs}ms > ${L.MAX_LATENCY_MS}ms`);
    }
    if ((req.expectedSlippageBps ?? 0) > L.MAX_SLIPPAGE_BPS) {
      add("SLIPPAGE", `Expected slippage ${req.expectedSlippageBps}bps > ${L.MAX_SLIPPAGE_BPS}bps`);
    }
    if (req.payout !== undefined) {
      if (req.payout < L.MIN_PAYOUT) add("PAYOUT", `Payout ${req.payout} < minimum ${L.MIN_PAYOUT}`);
      if (req.expectedPayout !== undefined && Math.abs(req.payout - req.expectedPayout) > 0.02) {
        add("UNEXPECTED_PAYOUT", `Payout ${req.payout} differs from validated ${req.expectedPayout}`);
      }
    }
    if (req.confidence < L.MIN_CONFIDENCE) add("CONFIDENCE", `Confidence ${req.confidence} < ${L.MIN_CONFIDENCE}`);
    if (!(req.edge >= L.MIN_EDGE)) add("EDGE", `Edge ${req.edge} < ${L.MIN_EDGE}`);

    // --- Exposure -------------------------------------------------------------
    const equity = state.equity;
    if (equity.lte(0)) add("EQUITY", "Equity is zero or negative");
    else {
      const pct = (x: Money): number => x.div(equity).times(100).toNumber();
      if (pct(stake) > L.MAX_POSITION_PERCENT) add("MAX_POSITION", `Stake ${pct(stake).toFixed(2)}% > ${L.MAX_POSITION_PERCENT}%`);
      const stratExposure = state.openPositions
        .filter((p) => p.strategyVersionId === req.strategyVersionId)
        .reduce((a, p) => a.plus(p.stake), ZERO)
        .plus(stake);
      if (pct(stratExposure) > L.MAX_STRATEGY_EXPOSURE_PERCENT) {
        add("MAX_STRATEGY_EXPOSURE", `Strategy exposure ${pct(stratExposure).toFixed(2)}% > ${L.MAX_STRATEGY_EXPOSURE_PERCENT}%`);
      }
      const total = state.openPositions.reduce((a, p) => a.plus(p.stake), ZERO).plus(stake);
      if (pct(total) > L.MAX_PORTFOLIO_EXPOSURE_PERCENT) {
        add("MAX_PORTFOLIO_EXPOSURE", `Portfolio exposure ${pct(total).toFixed(2)}% > ${L.MAX_PORTFOLIO_EXPOSURE_PERCENT}%`);
      }
      const loss = (from: Money): number => (from.gt(0) ? from.minus(equity).div(from).times(100).toNumber() : 0);
      if (loss(state.startOfDayEquity) >= L.MAX_DAILY_LOSS_PERCENT) add("MAX_DAILY_LOSS", `Daily loss limit reached`);
      if (loss(state.startOfWeekEquity) >= L.MAX_WEEKLY_LOSS_PERCENT) add("MAX_WEEKLY_LOSS", `Weekly loss limit reached`);
      if (loss(state.peakEquity) >= L.MAX_DRAWDOWN_PERCENT) add("MAX_DRAWDOWN", `Drawdown limit reached`);
    }
    if (state.openPositions.length >= L.MAX_OPEN_POSITIONS) add("MAX_OPEN_POSITIONS", `${state.openPositions.length} open positions`);
    if (state.consecutiveLosses >= L.MAX_CONSECUTIVE_LOSSES) add("MAX_CONSECUTIVE_LOSSES", `${state.consecutiveLosses} consecutive losses`);
    const lastHour = state.recentTradeTimes.filter((t) => ctx.now - t < 3_600_000).length;
    if (lastHour >= L.MAX_TRADES_PER_HOUR) add("MAX_TRADES_PER_HOUR", `${lastHour} trades in the last hour`);
    if (req.mode === "LIVE") {
      if (!ctx.liveStakeCeiling) add("LIVE_STAGE", "No progressive-capital ceiling configured");
      else if (stake.gt(ctx.liveStakeCeiling)) add("LIVE_STAGE", `Stake exceeds current capital stage ceiling ${ctx.liveStakeCeiling.toFixed(2)}`);
    }

    return { approved: v.length === 0, stake, violations: v, evaluatedAt: ctx.now };
  }
}
