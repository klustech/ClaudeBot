import type { Timeframe } from "./types";

const MINUTE = 60_000;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": 60 * MINUTE,
  "4h": 240 * MINUTE,
  "1d": 1440 * MINUTE,
};

export const YEAR_MS = 365.25 * 24 * 60 * MINUTE;

export function barsPerYear(tf: Timeframe): number {
  return YEAR_MS / TIMEFRAME_MS[tf];
}
