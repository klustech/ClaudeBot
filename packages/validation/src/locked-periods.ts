import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "@ct/market-data";
import { LockedPeriodViolation, repoRoot, type Candle } from "@ct/shared";
import { z } from "zod";

const PeriodSchema = z.object({
  trainStart: z.string().optional(),
  trainEnd: z.string(),
  validationEnd: z.string(),
  testEnd: z.string(),
});
export const LockedPeriodsSchema = z.record(z.string(), PeriodSchema);
export type LockedPeriod = z.infer<typeof PeriodSchema>;
export type LockedPeriods = z.infer<typeof LockedPeriodsSchema>;

export function loadLockedPeriods(root = repoRoot()): LockedPeriods {
  const p = join(root, "validation/locked-periods.json");
  if (!existsSync(p)) throw new Error(`Missing ${p}`);
  const parsed = LockedPeriodsSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  for (const [sym, per] of Object.entries(parsed)) {
    const t = [per.trainStart ?? "1970-01-01", per.trainEnd, per.validationEnd, per.testEnd].map((d) => Date.parse(d));
    if (t.some(Number.isNaN)) throw new Error(`Invalid date in locked period for ${sym}`);
    for (let i = 1; i < t.length; i++) {
      if ((t[i] as number) <= (t[i - 1] as number)) throw new Error(`Locked periods for ${sym} must be strictly increasing`);
    }
  }
  return Object.freeze(parsed);
}

export type Partition = "train" | "validation" | "test" | "forward";

export interface FrozenStrategyRef {
  id: string;
  frozenAt: string | null;
}

export interface PartitionAccess {
  partition: Partition;
  strategyVersionId: string | null;
  at: string;
}

/**
 * Splits a dataset into TRAIN / VALIDATION / TEST / FORWARD according to the
 * locked periods and enforces access rules:
 *   - TRAIN: optimisation allowed.
 *   - VALIDATION: model comparison allowed (no fitting).
 *   - TEST: only for a FROZEN strategy version; never during research.
 *   - FORWARD: everything after testEnd; reserved for paper trading.
 * Every access is recorded so the audit log shows who saw what.
 */
export class DataPartitioner {
  readonly accessLog: PartitionAccess[] = [];
  private readonly bounds: { trainStart: number; trainEnd: number; validationEnd: number; testEnd: number };

  constructor(
    private readonly dataset: Dataset,
    periods: LockedPeriods,
  ) {
    const p = periods[dataset.symbol];
    if (!p) throw new LockedPeriodViolation(`No locked periods defined for ${dataset.symbol}; refusing to partition`);
    this.bounds = {
      trainStart: p.trainStart ? Date.parse(p.trainStart) : -Infinity,
      trainEnd: Date.parse(p.trainEnd),
      validationEnd: Date.parse(p.validationEnd),
      testEnd: Date.parse(p.testEnd),
    };
  }

  get periodBounds(): Readonly<{ trainStart: number; trainEnd: number; validationEnd: number; testEnd: number }> {
    return this.bounds;
  }

  private slice(from: number, to: number): Candle[] {
    return this.dataset.candles.filter((c) => c.time >= from && c.time < to);
  }

  private log(partition: Partition, strategyVersionId: string | null): void {
    this.accessLog.push({ partition, strategyVersionId, at: new Date().toISOString() });
  }

  train(): Candle[] {
    this.log("train", null);
    return this.slice(this.bounds.trainStart, this.bounds.trainEnd);
  }

  validation(): Candle[] {
    this.log("validation", null);
    return this.slice(this.bounds.trainEnd, this.bounds.validationEnd);
  }

  /** Train + validation, for walk-forward (never includes TEST). */
  research(): Candle[] {
    this.log("validation", null);
    return this.slice(this.bounds.trainStart, this.bounds.validationEnd);
  }

  /** Candles immediately before `time`, used as indicator warm-up. */
  warmupBefore(time: number, bars: number): Candle[] {
    const idx = this.dataset.candles.findIndex((c) => c.time >= time);
    const end = idx < 0 ? this.dataset.candles.length : idx;
    return this.dataset.candles.slice(Math.max(0, end - bars), end);
  }

  test(strategy: FrozenStrategyRef): Candle[] {
    if (!strategy.frozenAt) {
      throw new LockedPeriodViolation(
        `Strategy ${strategy.id} is not frozen. The locked TEST period is only available to frozen strategy versions.`,
        { strategy: strategy.id },
      );
    }
    this.log("test", strategy.id);
    return this.slice(this.bounds.validationEnd, this.bounds.testEnd);
  }

  forward(): Candle[] {
    this.log("forward", null);
    return this.slice(this.bounds.testEnd, Infinity);
  }
}
