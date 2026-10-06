import type { Candle } from "@ct/shared";

/** All indicators return arrays aligned with the input; warm-up values are NaN. */

export function closes(c: readonly Candle[]): number[] {
  return c.map((x) => x.close);
}

export function sma(xs: readonly number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i] as number;
    if (i >= period) sum -= xs[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(xs: readonly number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    if (Number.isNaN(x)) continue;
    if (i < period - 1) {
      seed += x;
      continue;
    }
    if (Number.isNaN(prev)) {
      seed += x;
      prev = seed / period;
    } else {
      prev = x * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rollingStd(xs: readonly number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  for (let i = period - 1; i < xs.length; i++) {
    let s = 0;
    let s2 = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = xs[j] as number;
      s += v;
      s2 += v * v;
    }
    const m = s / period;
    out[i] = Math.sqrt(Math.max(0, s2 / period - m * m));
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(xs: readonly number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  if (xs.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < xs.length; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(xs: readonly number[], fast = 12, slow = 26, signal = 9): { macd: number[]; signal: number[]; hist: number[] } {
  const f = ema(xs, fast);
  const s = ema(xs, slow);
  const line = xs.map((_, i) => (f[i] as number) - (s[i] as number));
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const sig = new Array<number>(xs.length).fill(NaN);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signal);
    for (let i = 0; i < tail.length; i++) sig[firstValid + i] = tail[i] as number;
  }
  return { macd: line, signal: sig, hist: line.map((v, i) => v - (sig[i] as number)) };
}

export function trueRange(c: readonly Candle[]): number[] {
  return c.map((x, i) => {
    if (i === 0) return x.high - x.low;
    const pc = (c[i - 1] as Candle).close;
    return Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc));
  });
}

/** Wilder's ATR. */
export function atr(c: readonly Candle[], period: number): number[] {
  const tr = trueRange(c);
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < period) return out;
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i] as number;
  a /= period;
  out[period - 1] = a;
  for (let i = period; i < c.length; i++) {
    a = (a * (period - 1) + (tr[i] as number)) / period;
    out[i] = a;
  }
  return out;
}

export function bollinger(xs: readonly number[], period: number, mult: number): { mid: number[]; upper: number[]; lower: number[]; width: number[] } {
  const mid = sma(xs, period);
  const sd = rollingStd(xs, period);
  const upper = mid.map((m, i) => m + mult * (sd[i] as number));
  const lower = mid.map((m, i) => m - mult * (sd[i] as number));
  const width = mid.map((m, i) => ((upper[i] as number) - (lower[i] as number)) / m);
  return { mid, upper, lower, width };
}

export function donchian(c: readonly Candle[], period: number): { upper: number[]; lower: number[] } {
  const upper = new Array<number>(c.length).fill(NaN);
  const lower = new Array<number>(c.length).fill(NaN);
  for (let i = period; i < c.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    // Channel of the PREVIOUS `period` bars, so the current bar can break it.
    for (let j = i - period; j < i; j++) {
      const x = c[j] as Candle;
      if (x.high > hi) hi = x.high;
      if (x.low < lo) lo = x.low;
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

/** Rolling VWAP over `period` bars using typical price. */
export function rollingVwap(c: readonly Candle[], period: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let pv = 0;
  let v = 0;
  for (let i = 0; i < c.length; i++) {
    const x = c[i] as Candle;
    const tp = (x.high + x.low + x.close) / 3;
    pv += tp * x.volume;
    v += x.volume;
    if (i >= period) {
      const o = c[i - period] as Candle;
      pv -= ((o.high + o.low + o.close) / 3) * o.volume;
      v -= o.volume;
    }
    if (i >= period - 1 && v > 0) out[i] = pv / v;
  }
  return out;
}

/** Percentile rank of the current value within the trailing window (0..1). */
export function percentileRank(xs: readonly number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  for (let i = period - 1; i < xs.length; i++) {
    const cur = xs[i] as number;
    if (Number.isNaN(cur)) continue;
    let below = 0;
    let n = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = xs[j] as number;
      if (Number.isNaN(v)) continue;
      n++;
      if (v <= cur) below++;
    }
    out[i] = n > 0 ? below / n : NaN;
  }
  return out;
}

export function slope(xs: readonly number[], lookback: number): number[] {
  return xs.map((x, i) => (i >= lookback ? x - (xs[i - lookback] as number) : NaN));
}
