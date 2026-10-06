import { D, type Direction, ZERO } from "@ct/shared";
import { signCommand, verifyResult, type BridgeCommand, type BridgeCommandType, type BridgeResult } from "./signed-command";
import {
  AdapterTimeoutError,
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

interface Waiter {
  resolve: (r: BridgeResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Queue between the backend and the Chrome extension. The extension polls
 * for signed commands and posts signed results. The extension holds NO
 * strategy logic; it verifies, checks broker state, executes and reports.
 */
export class BridgeQueue {
  private readonly queue: BridgeCommand[] = [];
  private readonly waiters = new Map<string, Waiter>();
  private lastPoll: number | null = null;

  constructor(private readonly secret: string) {}

  enqueue(type: BridgeCommandType, payload: Record<string, unknown>, ttlMs: number, timeoutMs: number): Promise<BridgeResult> {
    const cmd = signCommand(this.secret, type, payload, ttlMs);
    this.queue.push(cmd);
    return new Promise<BridgeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(cmd.commandId);
        reject(new AdapterTimeoutError(`extension did not answer ${type} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(cmd.commandId, { resolve, reject, timer });
    });
  }

  /** Called by the extension (via API) to fetch pending commands. */
  take(now = Date.now()): BridgeCommand[] {
    this.lastPoll = now;
    const live = this.queue.filter((c) => c.expiresAt > now);
    this.queue.length = 0;
    return live;
  }

  /** Called by the extension (via API) with a signed result. */
  complete(result: BridgeResult): boolean {
    if (!verifyResult(this.secret, result)) return false;
    const w = this.waiters.get(result.commandId);
    if (!w) return false;
    clearTimeout(w.timer);
    this.waiters.delete(result.commandId);
    w.resolve(result);
    return true;
  }

  lastPollAt(): number | null {
    return this.lastPoll;
  }
}

/** Execution adapter for fixed-payout venues without an API, via the Chrome extension bridge. */
export class BrowserExecutionAdapter implements ExecutionAdapter {
  readonly name = "browser-bridge";

  constructor(
    private readonly bridge: BridgeQueue,
    readonly mode: "PAPER" | "TESTNET" | "LIVE" | "READ_ONLY",
    private readonly opts: { ttlMs?: number; timeoutMs?: number; currency?: string } = {},
  ) {}

  private async call(type: BridgeCommandType, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const r = await this.bridge.enqueue(type, payload, this.opts.ttlMs ?? 5_000, this.opts.timeoutMs ?? 15_000);
    if (!r.ok) throw new Error(`extension ${type} failed: ${r.error ?? "unknown"}`);
    return r.data;
  }

  async getBalance(): Promise<Balance> {
    const d = await this.call("get_balance");
    return { currency: String(d.currency ?? this.opts.currency ?? "USD"), total: D(String(d.balance)), available: D(String(d.available ?? d.balance)) };
  }

  async getMarkets(): Promise<Market[]> {
    const d = await this.call("get_market");
    return [
      {
        symbol: String(d.market),
        kind: "fixed-payout",
        minStake: D(String(d.minStake ?? "1")),
        stakeIncrement: D(String(d.stakeIncrement ?? "1")),
        payout: Number(d.payout),
      },
    ];
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const t0 = Date.now();
    const d = await this.call("get_market", { market: req.market });
    const price = Number(d.price);
    return { market: req.market, price, bid: price, ask: price, spreadBps: 0, payout: Number(d.payout), timestamp: Date.now(), latencyMs: Date.now() - t0 };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    if (this.mode === "READ_ONLY") throw new Error("Browser bridge is READ_ONLY");
    const d = await this.call("place_trade", {
      idempotencyKey: order.idempotencyKey,
      market: order.market,
      direction: order.direction,
      stake: order.stake.toFixed(2),
      expiryMs: order.expiryMs,
    });
    return {
      orderId: String(d.tradeId),
      idempotencyKey: order.idempotencyKey,
      state: d.tradeId ? "open" : "rejected",
      market: String(d.market ?? order.market),
      direction: (d.direction as Direction) ?? order.direction,
      requestedStake: order.stake,
      filledStake: D(String(d.actualStake ?? "0")),
      fillPrice: d.price !== undefined ? Number(d.price) : null,
      fees: ZERO,
      payout: d.actualPayout !== undefined ? Number(d.actualPayout) : null,
      acceptedAt: Number(d.timestamp ?? Date.now()),
      ...(d.reason ? { reason: String(d.reason) } : {}),
    };
  }

  async getOrder(id: string): Promise<OrderStatus> {
    const d = await this.call("get_trade_result", { tradeId: id });
    return {
      orderId: id,
      idempotencyKey: String(d.idempotencyKey ?? ""),
      state: (d.state as OrderStatus["state"]) ?? "unknown",
      market: String(d.market),
      direction: d.direction as Direction,
      requestedStake: D(String(d.stake ?? "0")),
      filledStake: D(String(d.stake ?? "0")),
      fillPrice: d.entryPrice !== undefined ? Number(d.entryPrice) : null,
      fees: ZERO,
      payout: d.payout !== undefined ? Number(d.payout) : null,
      acceptedAt: Number(d.openedAt ?? 0),
      pnl: d.pnl !== undefined ? D(String(d.pnl)) : null,
      settledAt: d.settledAt !== undefined ? Number(d.settledAt) : null,
      exitPrice: d.exitPrice !== undefined ? Number(d.exitPrice) : null,
    };
  }

  async cancelOrder(id: string): Promise<void> {
    await this.call("cancel_trade", { tradeId: id });
  }

  async getPositions(): Promise<Position[]> {
    const d = await this.call("get_open_contracts");
    const rows = (d.contracts as Record<string, unknown>[] | undefined) ?? [];
    return rows.map((r) => ({
      id: String(r.tradeId),
      orderId: String(r.tradeId),
      strategyVersionId: String(r.strategyVersionId ?? ""),
      market: String(r.market),
      direction: r.direction as Direction,
      stake: D(String(r.stake)),
      entryPrice: Number(r.entryPrice ?? 0),
      openedAt: Number(r.openedAt ?? 0),
      expiresAt: r.expiresAt !== undefined ? Number(r.expiresAt) : null,
    }));
  }
}
