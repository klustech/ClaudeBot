import type { OpenExposure, RiskState } from "@ct/risk";
import { D, type Money, ZERO } from "@ct/shared";

const DAY = 86_400_000;

function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/**
 * Internal book of record for the executor: equity, peaks, period starts,
 * open exposure, loss streaks, trade rate and idempotency keys. Feeds the
 * risk engine and is reconciled against the broker every minute.
 */
export class PortfolioLedger {
  private equity: Money;
  private peak: Money;
  private dayStart: Money;
  private weekStartEquity: Money;
  private dayKey: number;
  private weekKey: number;
  private readonly open = new Map<string, OpenExposure & { orderId: string }>();
  private losses = 0;
  private readonly tradeTimes: number[] = [];
  private readonly keys = new Set<string>();
  private known = true;
  private readonly results: { strategyVersionId: string; returnOnStake: number; at: number }[] = [];

  constructor(startingEquity: string, now: number) {
    this.equity = D(startingEquity);
    this.peak = this.equity;
    this.dayStart = this.equity;
    this.weekStartEquity = this.equity;
    this.dayKey = Math.floor(now / DAY);
    this.weekKey = weekStart(now);
  }

  private roll(now: number): void {
    const dk = Math.floor(now / DAY);
    if (dk !== this.dayKey) {
      this.dayKey = dk;
      this.dayStart = this.equity;
    }
    const wk = weekStart(now);
    if (wk !== this.weekKey) {
      this.weekKey = wk;
      this.weekStartEquity = this.equity;
    }
  }

  reserveKey(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  hasKey(key: string): boolean {
    return this.keys.has(key);
  }

  recordOpen(e: OpenExposure & { orderId: string }, fees: Money, now: number): void {
    this.roll(now);
    this.open.set(e.orderId, e);
    this.tradeTimes.push(now);
    this.equity = this.equity.minus(fees);
  }

  /** pnl is net of all fees; entryFees already deducted at open are added back to avoid double counting. */
  recordSettlement(orderId: string, pnl: Money, entryFees: Money, now: number): void {
    this.roll(now);
    const pos = this.open.get(orderId);
    this.open.delete(orderId);
    this.equity = this.equity.plus(pnl).plus(entryFees);
    if (this.equity.gt(this.peak)) this.peak = this.equity;
    if (pnl.lte(0)) this.losses++;
    else this.losses = 0;
    if (pos) this.results.push({ strategyVersionId: pos.strategyVersionId, returnOnStake: pnl.div(pos.stake).toNumber(), at: now });
  }

  markUnknown(): void {
    this.known = false;
  }

  markKnown(): void {
    this.known = true;
  }

  openPositions(): (OpenExposure & { orderId: string })[] {
    return [...this.open.values()];
  }

  returnsFor(strategyVersionId: string): number[] {
    return this.results.filter((r) => r.strategyVersionId === strategyVersionId).map((r) => r.returnOnStake);
  }

  currentEquity(): Money {
    return this.equity;
  }

  drawdown(): number {
    return this.peak.gt(0) ? this.peak.minus(this.equity).div(this.peak).toNumber() : 0;
  }

  snapshot(now: number): RiskState {
    this.roll(now);
    return {
      equity: this.equity,
      peakEquity: this.peak,
      startOfDayEquity: this.dayStart,
      startOfWeekEquity: this.weekStartEquity,
      openPositions: this.openPositions(),
      consecutiveLosses: this.losses,
      recentTradeTimes: this.tradeTimes.filter((t) => now - t < 3_600_000),
      seenIdempotencyKeys: this.keys,
      stateKnown: this.known,
    };
  }

  exposure(): Money {
    return this.openPositions().reduce((a, p) => a.plus(p.stake), ZERO);
  }
}
