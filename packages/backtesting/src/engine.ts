import { atr, getTemplate, validateParams, type StrategyTemplate } from "@ct/strategies";
import {
  D,
  hashObject,
  sha256,
  type Candle,
  type Direction,
  type Money,
  type ParamSet,
  type Timeframe,
  ZERO,
} from "@ct/shared";
import { breakEvenWinRate, fixedPayoutEconomics, type InstrumentModel } from "./instruments";
import { computeMetrics } from "./metrics";
import type { BacktestResult, BacktestTrade, EquityPoint, ExitReason, ReproducibilityManifest } from "./types";

export const ENGINE_VERSION = "1.0.0";

export interface BacktestConfig {
  readonly candles: readonly Candle[];
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly datasetVersion: string;
  readonly template: StrategyTemplate | string;
  readonly params: ParamSet;
  readonly instrument: InstrumentModel;
  /** Stake (fixed-payout) or notional (linear) per trade. */
  readonly stake: string;
  readonly initialCapital: string;
  readonly seed: number;
  /**
   * Optional: only open trades whose signal bar is at/after this time. Earlier
   * candles are used purely as indicator warm-up and are excluded from equity.
   */
  readonly tradeFromTime?: number;
}

export function templateCodeHash(t: StrategyTemplate): string {
  return sha256(`${ENGINE_VERSION}\n${t.key}\n${t.generate.toString()}`).slice(0, 16);
}

/**
 * Deterministic event-driven backtest.
 *  - Signals are evaluated on bar CLOSE and filled at the NEXT bar's open (no look-ahead).
 *  - One position at a time.
 *  - Linear: fees both sides + slippage; ATR stop/take checked intrabar, stop assumed first.
 *  - Fixed-payout: strike = entry open, settlement at expiry close; a tie counts as a loss.
 */
export function runBacktest(cfg: BacktestConfig): BacktestResult {
  const template = typeof cfg.template === "string" ? getTemplate(cfg.template) : cfg.template;
  const params = validateParams(template, cfg.params);
  const c = cfg.candles;
  const n = c.length;
  const stake = D(cfg.stake);
  const initialCapital = D(cfg.initialCapital);
  if (stake.lte(0)) throw new Error("stake must be positive");

  const { signals, exit } = template.generate(c, params, { seed: cfg.seed });
  if (signals.length !== n) throw new Error(`Template ${template.key} returned ${signals.length} signals for ${n} candles`);
  const holdBars = Math.max(1, Math.floor(exit.holdBars));
  const atrArr = exit.stopAtr || exit.takeAtr ? atr(c, 14) : [];

  const trades: BacktestTrade[] = [];
  let realised: Money = initialCapital;
  let realisedNum = realised.toNumber();
  const stakeNum = stake.toNumber();
  const equity: EquityPoint[] = [];
  const barReturns: number[] = [];
  let peak = initialCapital.toNumber();
  let barsInPosition = 0;

  const inst = cfg.instrument;
  const slip = inst.kind === "linear" ? inst.slippageBps / 10_000 : 0;
  const feeRate = inst.kind === "linear" ? D(inst.feeRate) : ZERO;

  // Open position state (for mark-to-market).
  let open: {
    dir: 1 | -1;
    entryIdx: number;
    entryPrice: number;
    signalIdx: number;
    stop: number | null;
    take: number | null;
    lastIdx: number;
  } | null = null;

  const pushEquity = (i: number, value: number): void => {
    const prev = equity.length ? (equity[equity.length - 1] as EquityPoint).equity : initialCapital.toNumber();
    if (value > peak) peak = value;
    equity.push({ time: (c[i] as Candle).time, equity: value, drawdown: peak > 0 ? (peak - value) / peak : 0 });
    barReturns.push(prev !== 0 ? value / prev - 1 : 0);
  };

  // Per-trade constants (decimal) computed once.
  const linearFees = inst.kind === "linear" ? stake.times(feeRate).times(2) : ZERO;
  const fpEcon = inst.kind === "fixed-payout" ? fixedPayoutEconomics(stake, inst) : null;
  const fpWinPnl = fpEcon ? fpEcon.win.minus(fpEcon.fee) : ZERO;
  const fpLossPnl = fpEcon ? fpEcon.loss.neg().minus(fpEcon.fee) : ZERO;
  const fpWinR = fpWinPnl.div(stake).toNumber();
  const fpLossR = fpLossPnl.div(stake).toNumber();

  const closePosition = (i: number, exitPrice: number, reason: ExitReason): void => {
    if (!open) return;
    const direction: Direction = open.dir === 1 ? "UP" : "DOWN";
    let pnl: Money;
    let fees: Money;
    let win: boolean;
    let ret: number;
    if (inst.kind === "linear") {
      const fill = exitPrice * (1 - open.dir * slip);
      // Price ratios come from floating-point market data; money is decimal from here on.
      const move = ((fill - open.entryPrice) / open.entryPrice) * open.dir;
      fees = linearFees;
      pnl = stake.times(D(move.toPrecision(15))).minus(fees);
      win = pnl.gt(0);
      ret = pnl.div(stake).toNumber();
      exitPrice = fill;
    } else {
      fees = (fpEcon as NonNullable<typeof fpEcon>).fee;
      win = open.dir * (exitPrice - open.entryPrice) > 0;
      pnl = win ? fpWinPnl : fpLossPnl;
      ret = win ? fpWinR : fpLossR;
    }
    realised = realised.plus(pnl);
    realisedNum = realised.toNumber();
    trades.push({
      index: trades.length,
      signalTime: (c[open.signalIdx] as Candle).time,
      entryTime: (c[open.entryIdx] as Candle).time,
      exitTime: (c[i] as Candle).time,
      direction,
      entryPrice: open.entryPrice,
      exitPrice,
      stake,
      fees,
      pnl,
      returnOnStake: ret,
      barsHeld: i - open.entryIdx + 1,
      exitReason: reason,
      win,
    });
    open = null;
  };

  for (let i = 0; i < n; i++) {
    const bar = c[i] as Candle;

    // 1) Manage an open position on this bar.
    if (open && i >= open.entryIdx) {
      barsInPosition++;
      if (inst.kind === "linear" && (open.stop !== null || open.take !== null)) {
        const hitStop = open.stop !== null && (open.dir === 1 ? bar.low <= open.stop : bar.high >= open.stop);
        const hitTake = open.take !== null && (open.dir === 1 ? bar.high >= open.take : bar.low <= open.take);
        if (hitStop) closePosition(i, open.stop as number, "stop");
        else if (hitTake) closePosition(i, open.take as number, "take");
      }
      if (open && i >= open.lastIdx) closePosition(i, bar.close, "expiry");
      else if (open && i === n - 1) closePosition(i, bar.close, "end_of_data");
    }

    const active = cfg.tradeFromTime === undefined || bar.time >= cfg.tradeFromTime;
    if (!active) continue;

    // 2) Mark-to-market equity at this bar's close.
    // Equity curve is statistical (number); realised P&L stays decimal.
    let mtm = realisedNum;
    if (open && i >= open.entryIdx && inst.kind === "linear") {
      mtm = realisedNum + stakeNum * ((bar.close - open.entryPrice) / open.entryPrice) * open.dir;
    }
    pushEquity(i, mtm);

    // 3) New entry from this bar's signal, filled at next bar open.
    const sig = signals[i] ?? 0;
    if (!open && sig !== 0 && i + 1 < n) {
      const next = c[i + 1] as Candle;
      const dir = sig as 1 | -1;
      const entryPrice = inst.kind === "linear" ? next.open * (1 + dir * slip) : next.open;
      const a = atrArr[i];
      const stop = exit.stopAtr && a !== undefined && !Number.isNaN(a) ? entryPrice - dir * exit.stopAtr * a : null;
      const take = exit.takeAtr && a !== undefined && !Number.isNaN(a) ? entryPrice + dir * exit.takeAtr * a : null;
      open = {
        dir,
        entryIdx: i + 1,
        entryPrice,
        signalIdx: i,
        stop,
        take,
        lastIdx: Math.min(n - 1, i + holdBars),
      };
    }
  }

  let beWin: number | null = null;
  if (inst.kind === "fixed-payout") {
    const econ = fixedPayoutEconomics(stake, inst);
    beWin = breakEvenWinRate(econ.win, econ.loss, econ.fee).toNumber();
  }

  const metrics = computeMetrics({
    trades,
    equity,
    barReturns,
    initialCapital,
    timeframe: cfg.timeframe,
    barsInPosition,
    totalBars: equity.length,
    breakEvenWinRate: beWin,
  });

  const manifestBase = {
    engineVersion: ENGINE_VERSION,
    codeHash: templateCodeHash(template),
    datasetVersion: cfg.datasetVersion,
    symbol: cfg.symbol,
    timeframe: cfg.timeframe,
    template: template.key,
    parameters: params,
    instrument: cfg.instrument,
    stake: cfg.stake,
    initialCapital: cfg.initialCapital,
    seed: cfg.seed,
    from: cfg.tradeFromTime ?? c[0]?.time ?? 0,
    to: c[n - 1]?.time ?? 0,
  };
  const manifest: ReproducibilityManifest = { ...manifestBase, runHash: hashObject(manifestBase) };

  return { trades, equity, metrics, manifest, barReturns };
}

/** Down-samples an equity curve for storage/plotting while keeping the extremes. */
export function downsampleEquity(points: readonly EquityPoint[], maxPoints = 1500): EquityPoint[] {
  if (points.length <= maxPoints) return points.slice();
  const bucket = Math.ceil(points.length / maxPoints);
  const out: EquityPoint[] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const slice = points.slice(i, i + bucket);
    let worst = slice[0] as EquityPoint;
    for (const p of slice) if (p.drawdown > worst.drawdown) worst = p;
    out.push(worst);
  }
  const last = points[points.length - 1] as EquityPoint;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
