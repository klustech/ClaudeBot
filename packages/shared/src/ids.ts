import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

function compactIso(time: number): string {
  // 2026-10-06T12:00:00.000Z -> 20261006T120000
  return new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

/**
 * Idempotency key in the form MARKET-TF-YYYYMMDDTHHMMSS-STRATEGY.
 * The same signal bar for the same strategy always yields the same key, so a
 * retried or duplicated instruction cannot execute twice.
 */
export function buildIdempotencyKey(input: {
  market: string;
  timeframe: string;
  signalTime: number;
  strategyId: string;
}): string {
  return [input.market, input.timeframe.toUpperCase(), compactIso(input.signalTime), input.strategyId].join("-");
}
