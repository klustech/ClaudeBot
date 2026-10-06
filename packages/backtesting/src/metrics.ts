import {
  barsPerYear,
  D,
  mean,
  quantile,
  safeDiv,
  stddev,
  sumMoney,
  type Money,
  type Timeframe,
  YEAR_MS,
  ZERO,
} from "@ct/shared";
import type { BacktestMetrics, BacktestTrade, EquityPoint } from "./types";

export function longestStreak(trades: readonly BacktestTrade[], win: boolean): number {
  let best = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.win === win) {
      cur++;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}

export function maxDrawdownOf(equity: readonly number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) mdd = Math.max(mdd, (peak - e) / peak);
  }
  return mdd;
}

export function computeMetrics(input: {
  trades: readonly BacktestTrade[];
  equity: readonly EquityPoint[];
  barReturns: readonly number[];
  initialCapital: Money;
  timeframe: Timeframe;
  barsInPosition: number;
  totalBars: number;
  breakEvenWinRate: number | null;
}): BacktestMetrics {
  const { trades, equity, barReturns, initialCapital, timeframe } = input;
  const n = trades.length;
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const grossWin = sumMoney(wins.map((t) => t.pnl));
  const grossLoss = sumMoney(losses.map((t) => t.pnl)).abs();
  const net = sumMoney(trades.map((t) => t.pnl));
  const fees = sumMoney(trades.map((t) => t.fees));
  const netReturn = initialCapital.gt(0) ? net.div(initialCapital).toNumber() : 0;

  const first = equity[0];
  const last = equity[equity.length - 1];
  const spanMs = first && last ? Math.max(1, last.time - first.time) : 1;
  const years = spanMs / YEAR_MS;
  const finalRatio = 1 + netReturn;
  const annualisedReturn = finalRatio > 0 && years > 0 ? finalRatio ** (1 / years) - 1 : -1;

  const bpy = barsPerYear(timeframe);
  const mu = mean(barReturns);
  const sd = stddev(barReturns);
  const downside = Math.sqrt(mean(barReturns.map((r) => (r < 0 ? r * r : 0))));
  const sharpe = sd > 0 ? (mu / sd) * Math.sqrt(bpy) : 0;
  const sortino = downside > 0 ? (mu / downside) * Math.sqrt(bpy) : 0;
  const mdd = maxDrawdownOf(equity.map((e) => e.equity));
  const calmar = mdd > 0 ? annualisedReturn / mdd : 0;
  const recoveryFactor = mdd > 0 ? safeDiv(net.toNumber(), mdd * initialCapital.toNumber()) : 0;

  const tradeReturns = trades.map((t) => t.returnOnStake);
  const q05 = quantile(tradeReturns, 0.05);
  const var95 = n > 0 ? -q05 : 0;
  const tail = tradeReturns.filter((r) => r <= q05);
  const cvar95 = tail.length > 0 ? -mean(tail) : 0;
  const tailLoss = n > 0 ? -tradeReturns.reduce((m, r) => Math.min(m, r), Infinity) : 0;

  const avg = (xs: Money[]): Money => (xs.length ? sumMoney(xs).div(xs.length) : ZERO);

  return {
    netProfit: net.toFixed(8),
    netReturn,
    annualisedReturn,
    tradeCount: n,
    winRate: n ? wins.length / n : 0,
    lossRate: n ? losses.length / n : 0,
    averageWin: avg(wins.map((t) => t.pnl)).toFixed(8),
    averageLoss: avg(losses.map((t) => t.pnl)).toFixed(8),
    expectancy: n ? net.div(n).toFixed(8) : "0.00000000",
    expectancyR: n ? mean(tradeReturns) : 0,
    profitFactor: grossLoss.gt(0) ? grossWin.div(grossLoss).toNumber() : grossWin.gt(0) ? 999 : 0,
    sharpe,
    sortino,
    calmar,
    maxDrawdown: mdd,
    recoveryFactor,
    longestLosingStreak: longestStreak(trades, false),
    longestWinningStreak: longestStreak(trades, true),
    exposure: input.totalBars ? input.barsInPosition / input.totalBars : 0,
    averageHoldingBars: n ? mean(trades.map((t) => t.barsHeld)) : 0,
    volatility: sd * Math.sqrt(bpy),
    tailLoss,
    valueAtRisk95: var95,
    conditionalValueAtRisk95: cvar95,
    totalFees: fees.toFixed(8),
    breakEvenWinRate: input.breakEvenWinRate,
  };
}

export function emptyMetrics(): BacktestMetrics {
  return computeMetrics({
    trades: [],
    equity: [],
    barReturns: [],
    initialCapital: D(1),
    timeframe: "15m",
    barsInPosition: 0,
    totalBars: 0,
    breakEvenWinRate: null,
  });
}
