import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@ct/shared";
import { z } from "zod";

export const RiskLimitsSchema = z.object({
  MAX_POSITION_PERCENT: z.number().positive().max(100),
  MAX_STRATEGY_EXPOSURE_PERCENT: z.number().positive().max(100),
  MAX_PORTFOLIO_EXPOSURE_PERCENT: z.number().positive().max(100),
  MAX_DAILY_LOSS_PERCENT: z.number().positive().max(100),
  MAX_WEEKLY_LOSS_PERCENT: z.number().positive().max(100),
  MAX_DRAWDOWN_PERCENT: z.number().positive().max(100),
  MAX_CONSECUTIVE_LOSSES: z.number().int().positive(),
  MAX_OPEN_POSITIONS: z.number().int().positive(),
  MAX_TRADES_PER_HOUR: z.number().int().positive(),
  MIN_CONFIDENCE: z.number().min(0).max(100),
  MIN_EDGE: z.number(),
  MAX_SLIPPAGE_BPS: z.number().nonnegative(),
  MAX_LATENCY_MS: z.number().int().positive(),
  MAX_DATA_STALENESS_MS: z.number().int().positive(),
  MAX_SIGNAL_AGE_MS: z.number().int().positive(),
  MIN_PAYOUT: z.number().nonnegative(),
  MAX_CLOCK_DRIFT_MS: z.number().int().positive(),
  /** Absolute stake ceilings per progressive-capital stage (account currency). */
  LIVE_CAPITAL_STAGES: z.array(z.string()).min(1),
});

export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

/** Loads protected risk limits. Agents may never edit config/risk-limits.json. */
export function loadRiskLimits(root = repoRoot()): RiskLimits {
  const p = join(root, "config/risk-limits.json");
  if (!existsSync(p)) throw new Error(`Missing ${p}`);
  return Object.freeze(RiskLimitsSchema.parse(JSON.parse(readFileSync(p, "utf8"))));
}

export const LivePermissionsSchema = z.object({
  liveStrategies: z.array(z.string()),
  allowedVenues: z.array(z.string()),
  requireSubAccount: z.boolean(),
  currentCapitalStage: z.number().int().min(0),
});
export type LivePermissions = z.infer<typeof LivePermissionsSchema>;

export function loadLivePermissions(root = repoRoot()): LivePermissions {
  const p = join(root, "config/live-permissions.json");
  if (!existsSync(p)) return { liveStrategies: [], allowedVenues: [], requireSubAccount: true, currentCapitalStage: 0 };
  return Object.freeze(LivePermissionsSchema.parse(JSON.parse(readFileSync(p, "utf8"))));
}
