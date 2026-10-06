import { D, newId, SeededRandom, type Clock, type Money, systemClock, ZERO, type InstrumentKind } from "@ct/shared";
import {
  AdapterConnectionError,
  type Balance,
  type ExecutionAdapter,
  type Market,
  type OrderRequest,
  type OrderResult,
  type OrderStatus,
  type Position,
  type Quote,
  type QuoteRequest,
} from "./types";

export interface PaperSimulationConfig {
  startingBalance: string;
  currency: string;
  seed: number;
  /** Latest price for a market, or null when unknown. */
  priceSource: (market: string) => number | null;
  clock?: Clock;
  latencyMeanMs?: number;
  latencySdMs?: number;
  missedEntryProbability?: number;
  rejectProbability?: number;
  disconnectProbability?: number;
  spreadBps?: number;
  slippageBpsSd?: number;
  feeRate?: string;
  feePerTrade?: string;
  payout?: number;
  /** Markets offered; defaults to the given kind for every requested market. */
  kind?: InstrumentKind;
  minStake?: string;
}

interface PaperOrder extends OrderStatus {
  strategyVersionId: string;
  kind: InstrumentKind;
  expiresAt: number | null;
}

/**
 * Realistic paper venue: simulates latency, missed entries, spread,
 * slippage, fees, fixed payouts, order rejection and connection loss.
 * Paper trades are stored exactly like live trades by the executor.
 */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly name = "paper";
  readonly mode = "PAPER" as const;
  private readonly rng: SeededRandom;
  private readonly clock: Clock;
  private balance: Money;
  private readonly orders = new Map<string, PaperOrder>();
  private readonly byKey = new Map<string, string>();
  private connected = true;

  constructor(private readonly cfg: PaperSimulationConfig) {
    this.rng = new SeededRandom(cfg.seed);
    this.clock = cfg.clock ?? systemClock;
    this.balance = D(cfg.startingBalance);
  }

  /** Failure injection hooks for tests. */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  private ensureConnected(): void {
    if (!this.connected) throw new AdapterConnectionError("paper venue disconnected");
    if (this.cfg.disconnectProbability && this.rng.bool(this.cfg.disconnectProbability)) {
      throw new AdapterConnectionError("simulated connection loss");
    }
  }

  private latency(): number {
    return Math.max(0, Math.round(this.rng.normal(this.cfg.latencyMeanMs ?? 120, this.cfg.latencySdMs ?? 40)));
  }

  private lockedStake(): Money {
    let s = ZERO;
    for (const o of this.orders.values()) if (o.state === "open" || o.state === "filled") s = s.plus(o.filledStake);
    return s;
  }

  async getBalance(): Promise<Balance> {
    this.ensureConnected();
    const locked = this.lockedStake();
    return { currency: this.cfg.currency, total: this.balance, available: this.balance.minus(locked) };
  }

  async getMarkets(): Promise<Market[]> {
    return [];
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    this.ensureConnected();
    const price = this.cfg.priceSource(req.market);
    if (price === null) throw new Error(`No price for ${req.market}`);
    const half = ((this.cfg.spreadBps ?? 2) / 2 / 10_000) * price;
    return {
      market: req.market,
      price,
      bid: price - half,
      ask: price + half,
      spreadBps: this.cfg.spreadBps ?? 2,
      ...(this.cfg.payout !== undefined ? { payout: this.cfg.payout } : {}),
      timestamp: this.clock.now(),
      latencyMs: this.latency(),
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    this.ensureConnected();
    const existing = this.byKey.get(order.idempotencyKey);
    if (existing) return { ...(this.orders.get(existing) as PaperOrder) };
    const now = this.clock.now();
    const id = `paper-${newId()}`;
    const base: PaperOrder = {
      orderId: id,
      idempotencyKey: order.idempotencyKey,
      strategyVersionId: order.strategyVersionId,
      kind: order.kind,
      state: "rejected",
      market: order.market,
      direction: order.direction,
      requestedStake: order.stake,
      filledStake: ZERO,
      fillPrice: null,
      fees: ZERO,
      payout: null,
      acceptedAt: now,
      pnl: null,
      settledAt: null,
      exitPrice: null,
      expiresAt: null,
    };
    this.byKey.set(order.idempotencyKey, id);
    const reject = (reason: string): OrderResult => {
      const o = { ...base, reason };
      this.orders.set(id, o);
      return { ...o };
    };
    const price = this.cfg.priceSource(order.market);
    if (price === null) return reject("no_price");
    if (this.cfg.minStake && order.stake.lt(this.cfg.minStake)) return reject("below_min_stake");
    const available = this.balance.minus(this.lockedStake());
    if (order.stake.gt(available)) return reject("insufficient_balance");
    if (this.cfg.rejectProbability && this.rng.bool(this.cfg.rejectProbability)) return reject("venue_rejected");
    if (this.cfg.missedEntryProbability && this.rng.bool(this.cfg.missedEntryProbability)) return reject("missed_entry");

    const dir = order.direction === "UP" ? 1 : -1;
    const half = (this.cfg.spreadBps ?? 2) / 2 / 10_000;
    const slip = Math.abs(this.rng.normal(0, (this.cfg.slippageBpsSd ?? 1) / 10_000));
    if (order.maxSlippageBps !== undefined && slip * 10_000 > order.maxSlippageBps) return reject("slippage_exceeded");
    const fill = order.kind === "linear" ? price * (1 + dir * (half + slip)) : price;
    const fees = order.kind === "linear" ? order.stake.times(this.cfg.feeRate ?? "0.00055") : D(this.cfg.feePerTrade ?? "0");
    this.balance = this.balance.minus(fees);
    const latency = this.latency();
    const o: PaperOrder = {
      ...base,
      state: "open",
      filledStake: order.stake,
      fillPrice: fill,
      fees,
      payout: order.kind === "fixed-payout" ? (this.cfg.payout ?? 0.8) : null,
      acceptedAt: now + latency,
      // Contract/holding period runs from the signal (request) time.
      expiresAt: order.expiryMs ? now + order.expiryMs : order.maxHoldMs ? now + order.maxHoldMs : null,
    };
    this.orders.set(id, o);
    return { ...o };
  }

  async getOrder(id: string): Promise<OrderStatus> {
    const o = this.orders.get(id);
    if (!o) throw new Error(`Unknown order ${id}`);
    return { ...o };
  }

  async cancelOrder(id: string): Promise<void> {
    const o = this.orders.get(id);
    if (o && o.state === "pending") this.orders.set(id, { ...o, state: "cancelled" });
  }

  async getPositions(): Promise<Position[]> {
    this.ensureConnected();
    return [...this.orders.values()]
      .filter((o) => o.state === "open")
      .map((o) => ({
        id: o.orderId,
        orderId: o.orderId,
        strategyVersionId: o.strategyVersionId,
        market: o.market,
        direction: o.direction,
        stake: o.filledStake,
        entryPrice: o.fillPrice as number,
        openedAt: o.acceptedAt,
        expiresAt: o.expiresAt,
      }));
  }

  /** Closes a linear position at the current price (with spread/slippage and exit fee). */
  closePosition(id: string): OrderStatus {
    const o = this.orders.get(id);
    if (!o || o.state !== "open") throw new Error(`Order ${id} is not open`);
    const price = this.cfg.priceSource(o.market);
    if (price === null) throw new Error(`No price for ${o.market}`);
    return this.settle(o, price);
  }

  /** Settles expired positions. Returns the newly settled orders. */
  settleExpired(): OrderStatus[] {
    const now = this.clock.now();
    const out: OrderStatus[] = [];
    for (const o of this.orders.values()) {
      if (o.state !== "open" || o.expiresAt === null || o.expiresAt > now) continue;
      const price = this.cfg.priceSource(o.market);
      if (price === null) continue;
      out.push(this.settle(o, price));
    }
    return out;
  }

  private settle(o: PaperOrder, price: number): OrderStatus {
    const dir = o.direction === "UP" ? 1 : -1;
    const entry = o.fillPrice as number;
    let pnl: Money;
    let exitPrice = price;
    if (o.kind === "fixed-payout") {
      const win = dir * (price - entry) > 0;
      pnl = (win ? o.filledStake.times(o.payout ?? 0) : o.filledStake.neg()).minus(o.fees);
      this.balance = this.balance.plus(win ? o.filledStake.times(o.payout ?? 0) : o.filledStake.neg());
    } else {
      const half = (this.cfg.spreadBps ?? 2) / 2 / 10_000;
      exitPrice = price * (1 - dir * half);
      const exitFee = o.filledStake.times(this.cfg.feeRate ?? "0.00055");
      const gross = o.filledStake.times(D(exitPrice).minus(entry).div(entry).times(dir));
      this.balance = this.balance.plus(gross).minus(exitFee);
      pnl = gross.minus(o.fees).minus(exitFee);
      o.fees = o.fees.plus(exitFee);
    }
    const settled: PaperOrder = { ...o, state: "settled", pnl, settledAt: this.clock.now(), exitPrice };
    this.orders.set(o.orderId, settled);
    return { ...settled };
  }
}
