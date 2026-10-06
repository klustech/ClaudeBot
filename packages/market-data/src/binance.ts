import { TIMEFRAME_MS, type Candle, type Timeframe } from "@ct/shared";

const BASE = "https://api.binance.com";

type RawKline = [number, string, string, string, string, string, ...unknown[]];

/** Downloads historical klines from Binance's public REST API (no credentials). */
export async function fetchBinanceKlines(
  symbol: string,
  timeframe: Timeframe,
  start: number,
  end: number,
  fetchImpl: typeof fetch = fetch,
  baseUrl = BASE,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = start;
  const step = TIMEFRAME_MS[timeframe];
  while (cursor < end) {
    const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${timeframe}&startTime=${cursor}&endTime=${end - 1}&limit=1000`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as RawKline[];
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({ time: r[0], open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) });
    }
    const last = rows[rows.length - 1] as RawKline;
    cursor = last[0] + step;
  }
  return out;
}
