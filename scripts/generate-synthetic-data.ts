/**
 * Generates deterministic synthetic datasets for offline development and tests.
 * Synthetic data must never be used to justify paper or live deployment.
 */
import { saveDataset } from "@ct/market-data";
import { buildSyntheticDataset, datasetPath } from "@ct/research";

for (const symbol of ["SYNTHETHUSDT", "SYNTHBTCUSDT"]) {
  const ds = buildSyntheticDataset(symbol, "15m");
  saveDataset(datasetPath(symbol, "15m"), ds);
  console.log(`${symbol}: ${ds.candles.length} candles (${ds.version})`);
}
