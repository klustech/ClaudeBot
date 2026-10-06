import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InstrumentModel } from "@ct/backtesting";
import { generateSyntheticCandles, loadDataset, makeDataset, saveDataset, type Dataset } from "@ct/market-data";
import { repoRoot, seedFromString, type Timeframe } from "@ct/shared";

export function datasetPath(symbol: string, timeframe: Timeframe, root = repoRoot()): string {
  return join(root, "data", `${symbol}-${timeframe}.json`);
}

const SYNTH_START = Date.UTC(2023, 0, 1);
const SYNTH_END = Date.UTC(2025, 6, 1);

/**
 * Loads a versioned dataset from data/. Symbols prefixed SYNTH are generated
 * deterministically on first use (offline development only). Real symbols must
 * be downloaded with `pnpm data:fetch`.
 */
export function loadMarketDataset(symbol: string, timeframe: Timeframe, root = repoRoot()): Dataset {
  const p = datasetPath(symbol, timeframe, root);
  if (existsSync(p)) return loadDataset(p);
  if (symbol.startsWith("SYNTH")) {
    const ds = buildSyntheticDataset(symbol, timeframe);
    saveDataset(p, ds);
    return ds;
  }
  throw new Error(`No dataset for ${symbol} ${timeframe} at ${p}. Run: pnpm data:fetch --symbol ${symbol} --timeframe ${timeframe}`);
}

export function buildSyntheticDataset(symbol: string, timeframe: Timeframe, start = SYNTH_START, end = SYNTH_END): Dataset {
  const stepMs = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 }[timeframe];
  const candles = generateSyntheticCandles({
    seed: seedFromString(`${symbol}-${timeframe}`),
    start,
    bars: Math.floor((end - start) / stepMs),
    timeframe,
    startPrice: symbol.includes("BTC") ? 30000 : 2000,
    momentumEdge: 0.08,
  });
  return makeDataset(symbol, timeframe, candles, "synthetic");
}

export function loadInstrument(key?: string, root = repoRoot()): { key: string; model: InstrumentModel } {
  const cfg = JSON.parse(readFileSync(join(root, "config/instruments.json"), "utf8")) as {
    default: string;
    instruments: Record<string, InstrumentModel>;
  };
  const k = key ?? cfg.default;
  const model = cfg.instruments[k];
  if (!model) throw new Error(`Unknown instrument model "${k}"`);
  return { key: k, model };
}
