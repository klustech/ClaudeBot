import { resample } from "@ct/market-data";
import { SeededRandom, TIMEFRAME_MS, type Candle, type Signal } from "@ct/shared";
import {
  atr,
  bollinger,
  closes,
  donchian,
  ema,
  macd,
  percentileRank,
  rollingVwap,
  rsi,
  sma,
  slope,
} from "./indicators";
import { bool, num, type StrategyTemplate } from "./types";

const isNum = (x: number | undefined): x is number => x !== undefined && !Number.isNaN(x);

function zeros(n: number): Signal[] {
  return new Array<Signal>(n).fill(0);
}

/** Momentum continuation: RSI regime + MACD histogram confirmation, optional volume filter. */
export const rsiMacdMomentum: StrategyTemplate = {
  key: "rsi-macd-momentum",
  family: "momentum",
  name: "RSI/MACD Momentum Continuation",
  description: "Enter in the direction of momentum when RSI is beyond a threshold and the MACD histogram confirms.",
  hypothesis:
    "Short-horizon momentum persists: when RSI exceeds the threshold and MACD histogram is rising, the next N bars drift in the same direction more often than chance after costs.",
  expectedRegimes: ["TREND_UP", "TREND_DOWN", "HIGH_VOLATILITY"],
  params: {
    rsiPeriod: { type: "int", min: 7, max: 21, step: 7 },
    rsiThreshold: { type: "int", min: 54, max: 66, step: 2 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
    volumeFilter: { type: "choice", values: [true, false] },
  },
  defaults: { rsiPeriod: 14, rsiThreshold: 60, holdBars: 1, volumeFilter: false },
  generate(c, p) {
    const cl = closes(c);
    const r = rsi(cl, num(p, "rsiPeriod"));
    const { hist } = macd(cl);
    const vol = sma(c.map((x) => x.volume), 20);
    const th = num(p, "rsiThreshold");
    const useVol = bool(p, "volumeFilter");
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const ri = r[i];
      const h = hist[i];
      const hp = hist[i - 1];
      if (!isNum(ri) || !isNum(h) || !isNum(hp)) continue;
      if (useVol && !((c[i] as Candle).volume > (vol[i] ?? Infinity))) continue;
      if (ri > th && h > 0 && h > hp) s[i] = 1;
      else if (ri < 100 - th && h < 0 && h < hp) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Mean reversion: fade closes outside Bollinger bands. */
export const bollingerReversion: StrategyTemplate = {
  key: "bollinger-reversion",
  family: "mean-reversion",
  name: "Bollinger Band Mean Reversion",
  description: "Fade closes beyond the Bollinger band, expecting reversion toward the mean.",
  hypothesis: "In ranging regimes, closes beyond k standard deviations over-extend and revert within N bars.",
  expectedRegimes: ["RANGE", "LOW_VOLATILITY"],
  params: {
    period: { type: "int", min: 14, max: 34, step: 4 },
    mult: { type: "float", min: 1.6, max: 2.8, step: 0.2 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { period: 20, mult: 2, holdBars: 2 },
  generate(c, p) {
    const cl = closes(c);
    const bb = bollinger(cl, num(p, "period"), num(p, "mult"));
    const s = zeros(c.length);
    for (let i = 0; i < c.length; i++) {
      const up = bb.upper[i];
      const lo = bb.lower[i];
      const x = cl[i] as number;
      if (!isNum(up) || !isNum(lo)) continue;
      if (x > up) s[i] = -1;
      else if (x < lo) s[i] = 1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Donchian channel breakout with ATR stop. */
export const donchianBreakout: StrategyTemplate = {
  key: "donchian-breakout",
  family: "breakout",
  name: "Donchian Breakout",
  description: "Enter on a close beyond the N-bar channel.",
  hypothesis: "Breaks of an N-bar range attract follow-through order flow, producing continuation within a few bars.",
  expectedRegimes: ["TREND_UP", "TREND_DOWN", "HIGH_VOLATILITY"],
  params: {
    period: { type: "int", min: 10, max: 60, step: 10 },
    holdBars: { type: "int", min: 2, max: 8, step: 2 },
    stopAtr: { type: "float", min: 1, max: 3, step: 0.5 },
  },
  defaults: { period: 20, holdBars: 4, stopAtr: 2 },
  generate(c, p) {
    const d = donchian(c, num(p, "period"));
    const s = zeros(c.length);
    for (let i = 0; i < c.length; i++) {
      const up = d.upper[i];
      const lo = d.lower[i];
      if (!isNum(up) || !isNum(lo)) continue;
      const x = (c[i] as Candle).close;
      if (x > up) s[i] = 1;
      else if (x < lo) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars"), stopAtr: num(p, "stopAtr") } };
  },
};

/** Volatility compression (Bollinger squeeze) then breakout. */
export const volatilityCompression: StrategyTemplate = {
  key: "volatility-compression-breakout",
  family: "volatility-compression",
  name: "Volatility Compression Breakout",
  description: "When band width is in its lowest percentile, trade the first close outside the band.",
  hypothesis: "Periods of compressed volatility are followed by expansion; the first directional break predicts the expansion's direction.",
  expectedRegimes: ["LOW_VOLATILITY", "TRANSITION"],
  params: {
    period: { type: "int", min: 14, max: 30, step: 4 },
    squeezePct: { type: "float", min: 0.1, max: 0.3, step: 0.05 },
    lookback: { type: "int", min: 100, max: 300, step: 100 },
    holdBars: { type: "int", min: 2, max: 8, step: 2 },
  },
  defaults: { period: 20, squeezePct: 0.2, lookback: 200, holdBars: 4 },
  generate(c, p) {
    const cl = closes(c);
    const bb = bollinger(cl, num(p, "period"), 2);
    const rank = percentileRank(bb.width, num(p, "lookback"));
    const sq = num(p, "squeezePct");
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const rk = rank[i - 1];
      if (!isNum(rk) || rk > sq) continue;
      const x = cl[i] as number;
      if (x > (bb.upper[i] as number)) s[i] = 1;
      else if (x < (bb.lower[i] as number)) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Trend continuation: pullback to fast EMA within a slow-EMA trend. */
export const emaTrendContinuation: StrategyTemplate = {
  key: "ema-trend-continuation",
  family: "trend-continuation",
  name: "EMA Trend Continuation",
  description: "In a slow-EMA trend with positive slope, buy pullbacks that close back above the fast EMA.",
  hypothesis: "Pullbacks within an established trend resume in the trend direction more often than they reverse.",
  expectedRegimes: ["TREND_UP", "TREND_DOWN"],
  params: {
    fast: { type: "int", min: 8, max: 21, step: 4 },
    slow: { type: "int", min: 50, max: 200, step: 50 },
    slopeBars: { type: "int", min: 5, max: 20, step: 5 },
    holdBars: { type: "int", min: 2, max: 8, step: 2 },
  },
  defaults: { fast: 12, slow: 100, slopeBars: 10, holdBars: 4 },
  generate(c, p) {
    const cl = closes(c);
    const f = ema(cl, num(p, "fast"));
    const sl = ema(cl, num(p, "slow"));
    const sls = slope(sl, num(p, "slopeBars"));
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const fi = f[i];
      const fp = f[i - 1];
      const si = sl[i];
      const ss = sls[i];
      if (!isNum(fi) || !isNum(fp) || !isNum(si) || !isNum(ss)) continue;
      const x = cl[i] as number;
      const xp = cl[i - 1] as number;
      if (ss > 0 && x > si && xp <= fp && x > fi) s[i] = 1;
      else if (ss < 0 && x < si && xp >= fp && x < fi) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Volume breakout: large range bar on abnormal volume. */
export const volumeBreakout: StrategyTemplate = {
  key: "volume-breakout",
  family: "volume-breakout",
  name: "Volume Breakout",
  description: "Trade in the direction of a bar whose volume exceeds k× average and whose body exceeds an ATR fraction.",
  hypothesis: "Abnormal volume on a directional bar reflects informed flow that continues over the next bars.",
  expectedRegimes: ["HIGH_VOLATILITY", "TRANSITION"],
  params: {
    volMult: { type: "float", min: 1.5, max: 3, step: 0.5 },
    bodyAtr: { type: "float", min: 0.5, max: 1.5, step: 0.25 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { volMult: 2, bodyAtr: 0.75, holdBars: 2 },
  generate(c, p) {
    const vavg = sma(c.map((x) => x.volume), 20);
    const a = atr(c, 14);
    const vm = num(p, "volMult");
    const ba = num(p, "bodyAtr");
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const x = c[i] as Candle;
      const va = vavg[i - 1];
      const ai = a[i];
      if (!isNum(va) || !isNum(ai)) continue;
      const body = x.close - x.open;
      if (x.volume > vm * va && Math.abs(body) > ba * ai) s[i] = body > 0 ? 1 : -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** ATR expansion: trade bars whose true range expands vs ATR. */
export const atrExpansion: StrategyTemplate = {
  key: "atr-expansion",
  family: "atr-expansion",
  name: "ATR Expansion Momentum",
  description: "Enter in the direction of a bar whose range exceeds k× ATR.",
  hypothesis: "Range expansion marks the start of directional moves that persist for several bars.",
  expectedRegimes: ["HIGH_VOLATILITY", "TREND_UP", "TREND_DOWN"],
  params: {
    atrPeriod: { type: "int", min: 10, max: 30, step: 10 },
    mult: { type: "float", min: 1.5, max: 3, step: 0.5 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { atrPeriod: 14, mult: 2, holdBars: 2 },
  generate(c, p) {
    const a = atr(c, num(p, "atrPeriod"));
    const m = num(p, "mult");
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const x = c[i] as Candle;
      const ap = a[i - 1];
      if (!isNum(ap)) continue;
      if (x.high - x.low > m * ap) s[i] = x.close > x.open ? 1 : -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** VWAP deviation mean reversion. */
export const vwapDeviation: StrategyTemplate = {
  key: "vwap-deviation",
  family: "mean-reversion",
  name: "VWAP Deviation Reversion",
  description: "Fade price when it deviates more than k ATR from rolling VWAP.",
  hypothesis: "Large deviations from volume-weighted fair value revert as liquidity providers lean against them.",
  expectedRegimes: ["RANGE", "LOW_VOLATILITY"],
  params: {
    period: { type: "int", min: 24, max: 96, step: 24 },
    devAtr: { type: "float", min: 1, max: 3, step: 0.5 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { period: 48, devAtr: 2, holdBars: 2 },
  generate(c, p) {
    const vw = rollingVwap(c, num(p, "period"));
    const a = atr(c, 14);
    const k = num(p, "devAtr");
    const s = zeros(c.length);
    for (let i = 0; i < c.length; i++) {
      const v = vw[i];
      const ai = a[i];
      if (!isNum(v) || !isNum(ai) || ai === 0) continue;
      const dev = ((c[i] as Candle).close - v) / ai;
      if (dev > k) s[i] = -1;
      else if (dev < -k) s[i] = 1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** RSI divergence: price makes a new N-bar extreme but RSI does not. */
export const rsiDivergence: StrategyTemplate = {
  key: "rsi-divergence",
  family: "reversal",
  name: "RSI Divergence Reversal",
  description: "Price makes a new lookback high (low) while RSI is below its own high (low): fade.",
  hypothesis: "Momentum divergence at local extremes signals exhaustion and a short-horizon reversal.",
  expectedRegimes: ["RANGE", "TRANSITION"],
  params: {
    rsiPeriod: { type: "int", min: 7, max: 21, step: 7 },
    lookback: { type: "int", min: 10, max: 40, step: 10 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { rsiPeriod: 14, lookback: 20, holdBars: 2 },
  generate(c, p) {
    const cl = closes(c);
    const r = rsi(cl, num(p, "rsiPeriod"));
    const lb = num(p, "lookback");
    const s = zeros(c.length);
    for (let i = lb; i < c.length; i++) {
      const ri = r[i];
      if (!isNum(ri)) continue;
      let maxP = -Infinity;
      let minP = Infinity;
      let maxR = -Infinity;
      let minR = Infinity;
      for (let j = i - lb; j < i; j++) {
        maxP = Math.max(maxP, cl[j] as number);
        minP = Math.min(minP, cl[j] as number);
        const rj = r[j];
        if (isNum(rj)) {
          maxR = Math.max(maxR, rj);
          minR = Math.min(minR, rj);
        }
      }
      const x = cl[i] as number;
      if (x > maxP && ri < maxR && ri > 60) s[i] = -1;
      else if (x < minP && ri > minR && ri < 40) s[i] = 1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Multi-timeframe confirmation: lower-TF momentum aligned with higher-TF trend. */
export const multiTimeframeMomentum: StrategyTemplate = {
  key: "mtf-momentum",
  family: "multi-timeframe",
  name: "Multi-Timeframe Momentum",
  description: "Enter on lower-timeframe EMA cross only when the 4h EMA trend agrees.",
  hypothesis: "Short-term momentum aligned with the higher-timeframe trend has better follow-through than counter-trend momentum.",
  expectedRegimes: ["TREND_UP", "TREND_DOWN"],
  params: {
    fast: { type: "int", min: 5, max: 15, step: 5 },
    slow: { type: "int", min: 20, max: 40, step: 10 },
    htfPeriod: { type: "int", min: 20, max: 50, step: 10 },
    holdBars: { type: "int", min: 2, max: 8, step: 2 },
  },
  defaults: { fast: 10, slow: 30, htfPeriod: 30, holdBars: 4 },
  generate(c, p) {
    const cl = closes(c);
    const f = ema(cl, num(p, "fast"));
    const sl = ema(cl, num(p, "slow"));
    const htf = resample(c, "4h");
    const htfE = ema(closes(htf), num(p, "htfPeriod"));
    const step = TIMEFRAME_MS["4h"];
    // Map each lower-TF bar to the last COMPLETED higher-TF bar (no look-ahead).
    const htfIndex = new Map<number, number>();
    htf.forEach((h, i) => htfIndex.set(h.time, i));
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const bucket = Math.floor((c[i] as Candle).time / step) * step;
      const hi = (htfIndex.get(bucket) ?? -1) - 1;
      if (hi < 0) continue;
      const he = htfE[hi];
      const hc = (htf[hi] as Candle).close;
      const fi = f[i];
      const fp = f[i - 1];
      const si = sl[i];
      const sp = sl[i - 1];
      if (!isNum(he) || !isNum(fi) || !isNum(fp) || !isNum(si) || !isNum(sp)) continue;
      const crossUp = fp <= sp && fi > si;
      const crossDn = fp >= sp && fi < si;
      if (crossUp && hc > he) s[i] = 1;
      else if (crossDn && hc < he) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

/** Regime switching: momentum in high-vol/trend, reversion in low-vol/range. */
export const regimeSwitching: StrategyTemplate = {
  key: "regime-switching",
  family: "regime-switching",
  name: "Regime-Switching Momentum/Reversion",
  description: "Uses ATR percentile to choose between momentum (high vol) and Bollinger reversion (low vol).",
  hypothesis: "Momentum works in expanding volatility and reversion in contracting volatility; switching captures both.",
  expectedRegimes: ["HIGH_VOLATILITY", "LOW_VOLATILITY", "RANGE"],
  params: {
    volLookback: { type: "int", min: 100, max: 300, step: 100 },
    highPct: { type: "float", min: 0.6, max: 0.8, step: 0.1 },
    holdBars: { type: "int", min: 1, max: 4, step: 1 },
  },
  defaults: { volLookback: 200, highPct: 0.7, holdBars: 2 },
  generate(c, p) {
    const cl = closes(c);
    const a = atr(c, 14);
    const rank = percentileRank(a, num(p, "volLookback"));
    const bb = bollinger(cl, 20, 2);
    const r = rsi(cl, 14);
    const hp = num(p, "highPct");
    const s = zeros(c.length);
    for (let i = 0; i < c.length; i++) {
      const rk = rank[i];
      const ri = r[i];
      if (!isNum(rk) || !isNum(ri) || !isNum(bb.upper[i])) continue;
      const x = cl[i] as number;
      if (rk >= hp) {
        if (ri > 60) s[i] = 1;
        else if (ri < 40) s[i] = -1;
      } else if (rk <= 1 - hp) {
        if (x > (bb.upper[i] as number)) s[i] = -1;
        else if (x < (bb.lower[i] as number)) s[i] = 1;
      }
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

// ---------------------------------------------------------------------------
// Benchmarks: every strategy is compared against these trivial alternatives.
// ---------------------------------------------------------------------------

export const benchmarkRandom: StrategyTemplate = {
  key: "benchmark-random",
  family: "benchmark",
  name: "Random Entry",
  description: "Random direction entries at a fixed rate.",
  hypothesis: "Null hypothesis: no edge.",
  expectedRegimes: [],
  isBenchmark: true,
  params: { rate: { type: "float", min: 0.05, max: 0.05, step: 0.05 }, holdBars: { type: "int", min: 1, max: 1, step: 1 } },
  defaults: { rate: 0.05, holdBars: 1 },
  generate(c, p, ctx) {
    const rng = new SeededRandom(ctx.seed);
    const rate = num(p, "rate");
    const s = c.map((): Signal => (rng.bool(rate) ? (rng.bool(0.5) ? 1 : -1) : 0));
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

export const benchmarkBuyHold: StrategyTemplate = {
  key: "benchmark-buy-hold",
  family: "benchmark",
  name: "Buy and Hold",
  description: "Single long position held for the whole period.",
  hypothesis: "Passive exposure.",
  expectedRegimes: [],
  isBenchmark: true,
  params: {},
  defaults: {},
  generate(c) {
    const s = zeros(c.length);
    if (c.length > 1) s[0] = 1;
    return { signals: s, exit: { holdBars: Math.max(1, c.length - 2) } };
  },
};

export const benchmarkSmaCross: StrategyTemplate = {
  key: "benchmark-sma-cross",
  family: "benchmark",
  name: "Simple Moving Average Cross",
  description: "50/200 SMA crossover.",
  hypothesis: "Classic trend-following baseline.",
  expectedRegimes: [],
  isBenchmark: true,
  params: { holdBars: { type: "int", min: 4, max: 4, step: 1 } },
  defaults: { holdBars: 4 },
  generate(c, p) {
    const cl = closes(c);
    const f = sma(cl, 50);
    const sl = sma(cl, 200);
    const s = zeros(c.length);
    for (let i = 1; i < c.length; i++) {
      const [fi, fp, si, sp] = [f[i], f[i - 1], sl[i], sl[i - 1]];
      if (!isNum(fi) || !isNum(fp) || !isNum(si) || !isNum(sp)) continue;
      if (fp <= sp && fi > si) s[i] = 1;
      else if (fp >= sp && fi < si) s[i] = -1;
    }
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

export const benchmarkMomentum: StrategyTemplate = {
  key: "benchmark-momentum",
  family: "benchmark",
  name: "Simple Momentum",
  description: "Direction of the last bar.",
  hypothesis: "Naive one-bar momentum baseline.",
  expectedRegimes: [],
  isBenchmark: true,
  params: { holdBars: { type: "int", min: 1, max: 1, step: 1 } },
  defaults: { holdBars: 1 },
  generate(c, p) {
    const s = c.map((x): Signal => (x.close > x.open ? 1 : x.close < x.open ? -1 : 0));
    return { signals: s, exit: { holdBars: num(p, "holdBars") } };
  },
};

export const benchmarkNoTrade: StrategyTemplate = {
  key: "benchmark-no-trade",
  family: "benchmark",
  name: "No Trade",
  description: "Never trades. Any strategy must beat doing nothing after costs.",
  hypothesis: "Cash.",
  expectedRegimes: [],
  isBenchmark: true,
  params: {},
  defaults: {},
  generate(c) {
    return { signals: zeros(c.length), exit: { holdBars: 1 } };
  },
};
