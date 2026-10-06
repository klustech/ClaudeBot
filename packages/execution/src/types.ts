import type { Direction, InstrumentKind, Money } from "@ct/shared";

export interface Balance {
  currency: string;
  total: Money;
  available: Money;
}

export interface Market {
  symbol: string;
  kind: InstrumentKind;
  minStake: Money;
  stakeIncrement: Money;
  /** Fixed-payout markets: profit per unit stake on a win. */
  payout?: number;
  expiries?: string[];
}

export interface QuoteRequest {
  market: string;
  direction: Direction;
  stake: Money;
  expiry?: string;
}

export interface Quote {
  market: string;
  price: number;
  bid: number;
  ask: number;
  spreadBps: number;
  payout?: number;
  timestamp: number;
  latencyMs: number;
}

export interface OrderRequest {
  idempotencyKey: string;
  strategyVersionId: string;
  market: string;
  direction: Direction;
  stake: Money;
  kind: InstrumentKind;
  /** Fixed-payout expiry duration in ms. */
  expiryMs?: number;
  /** Linear: maximum holding time before the executor closes the position. */
  maxHoldMs?: number;
  maxSlippageBps?: number;
}

export type OrderState = "pending" | "open" | "filled" | "settled" | "cancelled" | "rejected" | "unknown";

export interface OrderResult {
  orderId: string;
  idempotencyKey: string;
  state: OrderState;
  market: string;
  direction: Direction;
  requestedStake: Money;
  filledStake: Money;
  fillPrice: number | null;
  fees: Money;
  payout: number | null;
  reason?: string;
  acceptedAt: number;
}

export interface OrderStatus extends OrderResult {
  pnl: Money | null;
  settledAt: number | null;
  exitPrice: number | null;
}

export interface Position {
  id: string;
  orderId: string;
  strategyVersionId: string;
  market: string;
  direction: Direction;
  stake: Money;
  entryPrice: number;
  openedAt: number;
  expiresAt: number | null;
}

/** Every venue (paper, exchange API, browser bridge) implements this. */
export interface ExecutionAdapter {
  readonly name: string;
  readonly mode: "PAPER" | "TESTNET" | "LIVE" | "READ_ONLY";
  getBalance(): Promise<Balance>;
  getMarkets(): Promise<Market[]>;
  getQuote(request: QuoteRequest): Promise<Quote>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  getOrder(id: string): Promise<OrderStatus>;
  cancelOrder(id: string): Promise<void>;
  getPositions(): Promise<Position[]>;
}

export class AdapterConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterConnectionError";
  }
}

export class AdapterTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterTimeoutError";
  }
}
