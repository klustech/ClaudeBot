import { TIMEFRAME_MS, type Candle, type Clock, type Timeframe, systemClock } from "@ct/shared";

export interface MarketStream {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Called once per CLOSED candle. */
  onCandle(handler: (c: Candle) => void | Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Wall-clock ms of the last message received from the feed. */
  lastMessageAt(): number | null;
  /** Latest traded/mark price, if known. */
  lastPrice(): number | null;
}

/** Tracks feed freshness; the risk engine refuses to trade on stale data. */
export function dataStalenessMs(stream: MarketStream, clock: Clock = systemClock): number {
  const t = stream.lastMessageAt();
  return t === null ? Number.POSITIVE_INFINITY : clock.now() - t;
}

/** Replays a dataset as a stream (paper-trading dry runs and tests). */
export class ReplayStream implements MarketStream {
  private handlers: Array<(c: Candle) => void | Promise<void>> = [];
  private last: number | null = null;
  private price: number | null = null;
  private stopped = false;

  constructor(
    readonly symbol: string,
    readonly timeframe: Timeframe,
    private readonly candles: readonly Candle[],
    private readonly clock: Clock & { set?: (t: number) => void } = systemClock,
  ) {}

  onCandle(handler: (c: Candle) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    const step = TIMEFRAME_MS[this.timeframe];
    for (const c of this.candles) {
      if (this.stopped) break;
      this.clock.set?.(c.time + step);
      this.last = this.clock.now();
      this.price = c.close;
      for (const h of this.handlers) await h(c);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  lastMessageAt(): number | null {
    return this.last;
  }

  lastPrice(): number | null {
    return this.price;
  }
}

interface BinanceKlineMsg {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
}

/** Live Binance kline websocket (public; no credentials). Uses Node's global WebSocket. */
export class BinanceKlineStream implements MarketStream {
  private handlers: Array<(c: Candle) => void | Promise<void>> = [];
  private ws: WebSocket | null = null;
  private last: number | null = null;
  private price: number | null = null;
  private closing = false;

  constructor(
    readonly symbol: string,
    readonly timeframe: Timeframe,
    private readonly url = "wss://stream.binance.com:9443/ws",
    private readonly clock: Clock = systemClock,
  ) {}

  onCandle(handler: (c: Candle) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    this.closing = false;
    const ws = new WebSocket(`${this.url}/${this.symbol.toLowerCase()}@kline_${this.timeframe}`);
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      this.last = this.clock.now();
      const msg = JSON.parse(String(ev.data)) as BinanceKlineMsg;
      if (!msg.k) return;
      this.price = Number(msg.k.c);
      if (!msg.k.x) return;
      const c: Candle = {
        time: msg.k.t,
        open: Number(msg.k.o),
        high: Number(msg.k.h),
        low: Number(msg.k.l),
        close: Number(msg.k.c),
        volume: Number(msg.k.v),
      };
      for (const h of this.handlers) void h(c);
    });
    ws.addEventListener("close", () => {
      if (!this.closing) setTimeout(() => void this.start(), 5_000);
    });
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.ws?.close();
  }

  lastMessageAt(): number | null {
    return this.last;
  }

  lastPrice(): number | null {
    return this.price;
  }
}
