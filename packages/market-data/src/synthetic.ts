import { SeededRandom, TIMEFRAME_MS, type Candle, type Timeframe } from "@ct/shared";

export interface SyntheticOptions {
  seed: number;
  start: number;
  bars: number;
  timeframe: Timeframe;
  startPrice?: number;
  /** Per-bar volatility baseline (log-return stdev). */
  baseVol?: number;
  /** Mean bars per regime before switching. */
  regimeLength?: number;
  /** Optional injected edge: probability that next bar continues momentum after a strong move. */
  momentumEdge?: number;
}

interface RegimeSpec {
  drift: number;
  volMult: number;
}

const REGIMES: RegimeSpec[] = [
  { drift: 0.0004, volMult: 1.0 }, // trend up
  { drift: -0.0004, volMult: 1.1 }, // trend down
  { drift: 0, volMult: 0.6 }, // range / low vol
  { drift: 0, volMult: 2.0 }, // high vol
];

/**
 * Deterministic regime-switching geometric random walk. Used for tests,
 * offline development and engine validation. NOT a substitute for real data:
 * research conclusions must come from real historical datasets.
 */
export function generateSyntheticCandles(opts: SyntheticOptions): Candle[] {
  const rng = new SeededRandom(opts.seed);
  const step = TIMEFRAME_MS[opts.timeframe];
  const baseVol = opts.baseVol ?? 0.004;
  const regimeLength = opts.regimeLength ?? 400;
  const edge = opts.momentumEdge ?? 0;
  let price = opts.startPrice ?? 2000;
  let regime = REGIMES[0] as RegimeSpec;
  let lastRet = 0;
  const out: Candle[] = [];
  for (let i = 0; i < opts.bars; i++) {
    if (rng.bool(1 / regimeLength)) regime = rng.pick(REGIMES);
    const vol = baseVol * regime.volMult;
    let ret = regime.drift + rng.normal(0, vol);
    if (edge > 0 && Math.abs(lastRet) > 1.5 * vol && rng.bool(edge)) {
      ret = Math.sign(lastRet) * Math.abs(ret);
    }
    const open = price;
    const close = open * Math.exp(ret);
    const wick = Math.abs(rng.normal(0, vol * 0.5));
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - Math.abs(rng.normal(0, vol * 0.5)));
    const volume = Math.max(1, 1000 * regime.volMult * (1 + Math.abs(ret) / vol) * (0.5 + rng.next()));
    out.push({ time: opts.start + i * step, open, high, low, close, volume });
    price = close;
    lastRet = ret;
  }
  return out;
}
