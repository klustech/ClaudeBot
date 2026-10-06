import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256, TIMEFRAME_MS, type Candle, type Timeframe } from "@ct/shared";

export interface Dataset {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly source: string;
  readonly candles: readonly Candle[];
  /** Content hash of the candles; recorded with every experiment for reproducibility. */
  readonly version: string;
}

export function datasetVersion(candles: readonly Candle[]): string {
  const h = sha256(candles.map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join("\n"));
  return `ds_${h.slice(0, 16)}`;
}

export function makeDataset(symbol: string, timeframe: Timeframe, candles: readonly Candle[], source: string): Dataset {
  validateCandles(candles, timeframe);
  return Object.freeze({ symbol, timeframe, source, candles: Object.freeze(candles.slice()), version: datasetVersion(candles) });
}

export function validateCandles(candles: readonly Candle[], timeframe: Timeframe): void {
  const step = TIMEFRAME_MS[timeframe];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] as Candle;
    if (![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) throw new Error(`Non-finite candle at ${i}`);
    if (c.high < Math.max(c.open, c.close) - 1e-9 || c.low > Math.min(c.open, c.close) + 1e-9) {
      throw new Error(`Inconsistent OHLC at index ${i} (${new Date(c.time).toISOString()})`);
    }
    if (i > 0) {
      const prev = candles[i - 1] as Candle;
      if (c.time <= prev.time) throw new Error(`Candles not strictly increasing at ${i}`);
      if ((c.time - prev.time) % step !== 0) throw new Error(`Candle misaligned with timeframe at ${i}`);
    }
  }
}

export function sliceByTime(ds: Dataset, from: number, toExclusive: number): Candle[] {
  return ds.candles.filter((c) => c.time >= from && c.time < toExclusive);
}

export function saveDataset(path: string, ds: Dataset): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      symbol: ds.symbol,
      timeframe: ds.timeframe,
      source: ds.source,
      version: ds.version,
      candles: ds.candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
    }),
  );
}

export function loadDataset(path: string): Dataset {
  if (!existsSync(path)) throw new Error(`Dataset not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    symbol: string;
    timeframe: Timeframe;
    source: string;
    version: string;
    candles: [number, number, number, number, number, number][];
  };
  const candles = raw.candles.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
  const ds = makeDataset(raw.symbol, raw.timeframe, candles, raw.source);
  if (ds.version !== raw.version) {
    throw new Error(`Dataset ${path} content does not match its recorded version (${raw.version} vs ${ds.version})`);
  }
  return ds;
}

/** Aggregates candles into a higher timeframe (used for multi-timeframe confirmation). */
export function resample(candles: readonly Candle[], target: Timeframe): Candle[] {
  const step = TIMEFRAME_MS[target];
  const out: Candle[] = [];
  let cur: { time: number; open: number; high: number; low: number; close: number; volume: number } | null = null;
  for (const c of candles) {
    const bucket = Math.floor(c.time / step) * step;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}
