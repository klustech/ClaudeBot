/**
 * Venue registry. Implemented: paper (in @ct/execution), bybit (API),
 * browser-bridge (fixed-payout venues without an API).
 * Planned (implement the ExecutionAdapter interface; start READ_ONLY):
 */
export const PLANNED_VENUES = ["binance", "okx", "blofin", "toobit", "weex"] as const;
export const IMPLEMENTED_VENUES = ["paper", "bybit", "browser-bridge"] as const;
