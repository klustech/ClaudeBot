export const BREAKERS = [
  "api_disconnected",
  "market_feed_stale",
  "unexpected_payout",
  "spread_explosion",
  "execution_mismatch",
  "balance_mismatch",
  "max_daily_loss",
  "max_weekly_loss",
  "drawdown_threshold",
  "strategy_degradation",
  "broker_inconsistent",
  "clock_drift",
  "execution_unknown_state",
  "reconciliation_failed",
  "protected_config_tampered",
] as const;
export type BreakerName = (typeof BREAKERS)[number];

export interface BreakerTrip {
  name: BreakerName;
  reason: string;
  at: number;
  scope: string;
}

/**
 * Circuit breakers halt NEW trading immediately. Once tripped they stay open
 * until explicitly reset by a human (resetBy is recorded); nothing resets
 * automatically.
 */
export class CircuitBreakerBoard {
  private readonly open = new Map<string, BreakerTrip>();
  private readonly listeners: Array<(trip: BreakerTrip) => void> = [];
  readonly history: Array<BreakerTrip & { resetAt?: number; resetBy?: string }> = [];

  constructor(private readonly now: () => number = Date.now) {}

  onTrip(l: (trip: BreakerTrip) => void): void {
    this.listeners.push(l);
  }

  /** scope: "global" or a strategy id. */
  trip(name: BreakerName, reason: string, scope = "global"): BreakerTrip {
    const key = `${scope}:${name}`;
    const existing = this.open.get(key);
    if (existing) return existing;
    const trip = { name, reason, at: this.now(), scope };
    this.open.set(key, trip);
    this.history.push(trip);
    for (const l of this.listeners) l(trip);
    return trip;
  }

  reset(name: BreakerName, resetBy: string, scope = "global"): boolean {
    if (!resetBy.trim()) throw new Error("A breaker reset must name the human who authorised it");
    const key = `${scope}:${name}`;
    const trip = this.open.get(key);
    if (!trip) return false;
    this.open.delete(key);
    const h = this.history.find((x) => x === trip);
    if (h) Object.assign(h, { resetAt: this.now(), resetBy });
    return true;
  }

  isHalted(scope?: string): boolean {
    for (const t of this.open.values()) {
      if (t.scope === "global" || (scope !== undefined && t.scope === scope)) return true;
    }
    return false;
  }

  openBreakers(): BreakerTrip[] {
    return [...this.open.values()];
  }
}
