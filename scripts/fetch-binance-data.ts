/**
 * Downloads public historical klines from Binance and stores a versioned dataset in data/.
 *   pnpm data:fetch --symbol ETHUSDT --timeframe 15m --from 2019-01-01 --to 2026-01-01
 */
import { parseArgs } from "node:util";
import { fetchBinanceKlines, makeDataset, saveDataset } from "@ct/market-data";
import { datasetPath } from "@ct/research";
import type { Timeframe } from "@ct/shared";

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "ETHUSDT" },
    timeframe: { type: "string", default: "15m" },
    from: { type: "string", default: "2019-01-01" },
    to: { type: "string", default: new Date().toISOString().slice(0, 10) },
  },
});
const tf = values.timeframe as Timeframe;
const candles = await fetchBinanceKlines(values.symbol as string, tf, Date.parse(values.from as string), Date.parse(values.to as string));
const ds = makeDataset(values.symbol as string, tf, candles, "binance");
const path = datasetPath(ds.symbol, tf);
saveDataset(path, ds);
console.log(`Saved ${candles.length} candles → ${path} (version ${ds.version})`);
