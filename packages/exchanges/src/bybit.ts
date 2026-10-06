import { createHmac } from "node:crypto";
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
} from "@ct/execution";
import { D, SafetyViolation, ZERO, type Direction } from "@ct/shared";

export type BybitMode = "READ_ONLY" | "TESTNET" | "LIVE";

export interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  mode: BybitMode;
  /** Must be explicitly true for LIVE (mirrors LIVE_TRADING_ENABLED). */
  liveTradingEnabled: boolean;
  category?: "linear" | "spot";
  recvWindow?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
}

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time?: number;
}

const URLS: Record<BybitMode, string> = {
  READ_ONLY: "https://api.bybit.com",
  TESTNET: "https://api-testnet.bybit.com",
  LIVE: "https://api.bybit.com",
};

/**
 * Bybit v5 REST adapter. Starts READ_ONLY (no order endpoints reachable),
 * then TESTNET, then LIVE. orderLinkId carries the idempotency key, so the
 * venue itself rejects duplicates. Credentials stay in the backend and are
 * never surfaced to Claude.
 */
export class BybitExecutionAdapter implements ExecutionAdapter {
  readonly name = "bybit";
  readonly mode: BybitMode;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly category: "linear" | "spot";
  private readonly now: () => number;

  constructor(private readonly cfg: BybitConfig) {
    if (!cfg.apiKey || !cfg.apiSecret) throw new Error("Bybit credentials missing");
    if (cfg.mode === "LIVE" && !cfg.liveTradingEnabled) {
      throw new SafetyViolation("Bybit LIVE mode requires LIVE_TRADING_ENABLED=true");
    }
    this.mode = cfg.mode;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.base = cfg.baseUrl ?? URLS[cfg.mode];
    this.category = cfg.category ?? "linear";
    this.now = cfg.now ?? Date.now;
  }

  sign(timestamp: number, payload: string): string {
    const recv = this.cfg.recvWindow ?? 5000;
    return createHmac("sha256", this.cfg.apiSecret).update(`${timestamp}${this.cfg.apiKey}${recv}${payload}`).digest("hex");
  }

  private async request<T>(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const ts = this.now();
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
    let url = `${this.base}${path}`;
    let body: string | undefined;
    let payload: string;
    if (method === "GET") {
      payload = new URLSearchParams(Object.entries(clean).map(([k, v]) => [k, String(v)])).toString();
      if (payload) url += `?${payload}`;
    } else {
      body = JSON.stringify(clean);
      payload = body;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          "X-BAPI-API-KEY": this.cfg.apiKey,
          "X-BAPI-TIMESTAMP": String(ts),
          "X-BAPI-RECV-WINDOW": String(this.cfg.recvWindow ?? 5000),
          "X-BAPI-SIGN": this.sign(ts, payload),
          "content-type": "application/json",
        },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err) {
      throw new AdapterConnectionError(`Bybit unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new AdapterConnectionError(`Bybit HTTP ${res.status}`);
    const json = (await res.json()) as BybitResponse<T>;
    if (json.retCode !== 0) throw new Error(`Bybit error ${json.retCode}: ${json.retMsg}`);
    return json.result;
  }

  private assertCanTrade(): void {
    if (this.mode === "READ_ONLY") throw new SafetyViolation("Bybit adapter is READ_ONLY; order endpoints are disabled");
    if (this.mode === "LIVE" && !this.cfg.liveTradingEnabled) throw new SafetyViolation("LIVE trading disabled");
  }

  async serverTime(): Promise<number> {
    const r = await this.request<{ timeNano: string }>("GET", "/v5/market/time");
    return Math.floor(Number(r.timeNano) / 1e6);
  }

  async getBalance(): Promise<Balance> {
    const r = await this.request<{ list: { totalEquity: string; totalAvailableBalance: string }[] }>("GET", "/v5/account/wallet-balance", {
      accountType: "UNIFIED",
    });
    const a = r.list[0];
    if (!a) throw new Error("No Bybit wallet returned");
    return { currency: "USD", total: D(a.totalEquity || "0"), available: D(a.totalAvailableBalance || "0") };
  }

  async getMarkets(): Promise<Market[]> {
    const r = await this.request<{ list: { symbol: string; lotSizeFilter: { minOrderQty: string; qtyStep?: string; basePrecision?: string } }[] }>(
      "GET",
      "/v5/market/instruments-info",
      { category: this.category },
    );
    return r.list.map((m) => ({
      symbol: m.symbol,
      kind: "linear" as const,
      minStake: D(m.lotSizeFilter.minOrderQty),
      stakeIncrement: D(m.lotSizeFilter.qtyStep ?? m.lotSizeFilter.basePrecision ?? m.lotSizeFilter.minOrderQty),
    }));
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const t0 = this.now();
    const r = await this.request<{ list: { symbol: string; lastPrice: string; bid1Price: string; ask1Price: string }[] }>("GET", "/v5/market/tickers", {
      category: this.category,
      symbol: req.market,
    });
    const t = r.list[0];
    if (!t) throw new Error(`No ticker for ${req.market}`);
    const bid = Number(t.bid1Price);
    const ask = Number(t.ask1Price);
    const mid = (bid + ask) / 2;
    return {
      market: req.market,
      price: Number(t.lastPrice),
      bid,
      ask,
      spreadBps: mid > 0 ? ((ask - bid) / mid) * 10_000 : Infinity,
      timestamp: this.now(),
      latencyMs: this.now() - t0,
    };
  }

  /** Converts a notional stake into base-asset quantity using the current ask/bid. */
  private async quantityFor(order: OrderRequest): Promise<string> {
    const q = await this.getQuote({ market: order.market, direction: order.direction, stake: order.stake });
    const px = order.direction === "UP" ? q.ask : q.bid;
    if (!(px > 0)) throw new Error("invalid quote price");
    const markets = await this.getMarkets();
    const m = markets.find((x) => x.symbol === order.market);
    const step = m?.stakeIncrement ?? D("0.001");
    const qty = order.stake.div(px).div(step).floor().times(step);
    if (m && qty.lt(m.minStake)) throw new Error(`Quantity ${qty.toString()} below venue minimum ${m.minStake.toString()}`);
    return qty.toString();
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    this.assertCanTrade();
    if (order.kind !== "linear") throw new Error("Bybit adapter supports linear instruments only");
    const qty = await this.quantityFor(order);
    const r = await this.request<{ orderId: string; orderLinkId: string }>("POST", "/v5/order/create", {
      category: this.category,
      symbol: order.market,
      side: order.direction === "UP" ? "Buy" : "Sell",
      orderType: "Market",
      qty,
      orderLinkId: order.idempotencyKey.slice(0, 36),
      timeInForce: "IOC",
    });
    return {
      orderId: r.orderId,
      idempotencyKey: order.idempotencyKey,
      state: "pending",
      market: order.market,
      direction: order.direction,
      requestedStake: order.stake,
      // Filled notional is confirmed via getOrder; reconciliation verifies it.
      filledStake: order.stake,
      fillPrice: null,
      fees: ZERO,
      payout: null,
      acceptedAt: this.now(),
    };
  }

  async getOrder(id: string): Promise<OrderStatus> {
    const r = await this.request<{
      list: { orderId: string; orderLinkId: string; symbol: string; side: string; orderStatus: string; avgPrice: string; cumExecValue: string; cumExecFee: string; createdTime: string }[];
    }>("GET", "/v5/order/realtime", { category: this.category, orderId: id });
    const o = r.list[0];
    if (!o) throw new Error(`Order ${id} not found`);
    const stateMap: Record<string, OrderStatus["state"]> = {
      New: "open",
      PartiallyFilled: "open",
      Filled: "filled",
      Cancelled: "cancelled",
      Rejected: "rejected",
      PartiallyFilledCanceled: "filled",
    };
    const filled = D(o.cumExecValue || "0");
    return {
      orderId: o.orderId,
      idempotencyKey: o.orderLinkId,
      state: stateMap[o.orderStatus] ?? "unknown",
      market: o.symbol,
      direction: (o.side === "Buy" ? "UP" : "DOWN") as Direction,
      requestedStake: filled,
      filledStake: filled,
      fillPrice: Number(o.avgPrice) || null,
      fees: D(o.cumExecFee || "0"),
      payout: null,
      acceptedAt: Number(o.createdTime),
      pnl: null,
      settledAt: null,
      exitPrice: null,
    };
  }

  async cancelOrder(id: string): Promise<void> {
    this.assertCanTrade();
    await this.request("POST", "/v5/order/cancel", { category: this.category, orderId: id });
  }

  async getPositions(): Promise<Position[]> {
    const r = await this.request<{
      list: { symbol: string; side: string; size: string; avgPrice: string; positionValue: string; createdTime: string; updatedTime: string }[];
    }>("GET", "/v5/position/list", { category: this.category, settleCoin: "USDT" });
    return r.list
      .filter((p) => Number(p.size) > 0)
      .map((p) => ({
        id: `${p.symbol}-${p.side}`,
        orderId: `${p.symbol}-${p.side}`,
        strategyVersionId: "",
        market: p.symbol,
        direction: (p.side === "Buy" ? "UP" : "DOWN") as Direction,
        stake: D(p.positionValue || "0"),
        entryPrice: Number(p.avgPrice),
        openedAt: Number(p.createdTime),
        expiresAt: null,
      }));
  }
}
