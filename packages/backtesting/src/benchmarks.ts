import { BENCHMARK_TEMPLATES } from "@ct/strategies";
import { runBacktest, type BacktestConfig } from "./engine";
import type { BacktestMetrics } from "./types";

export interface BenchmarkComparison {
  benchmarks: Record<string, BacktestMetrics>;
  beats: Record<string, boolean>;
  passed: boolean;
  notes: string[];
}

/**
 * Compares a strategy against trivial alternatives on the same data and
 * cost model. Buy-and-hold has different exposure, so it is compared on a
 * risk-adjusted (Sharpe) basis; the others on expectancy and net profit.
 */
export function compareToBenchmarks(strategy: BacktestMetrics, base: Omit<BacktestConfig, "template" | "params">): BenchmarkComparison {
  const benchmarks: Record<string, BacktestMetrics> = {};
  const beats: Record<string, boolean> = {};
  const notes: string[] = [];
  for (const t of BENCHMARK_TEMPLATES) {
    const m = runBacktest({ ...base, template: t, params: t.defaults }).metrics;
    benchmarks[t.key] = m;
    let ok: boolean;
    if (t.key === "benchmark-buy-hold") ok = strategy.sharpe > m.sharpe;
    else if (t.key === "benchmark-no-trade") ok = Number(strategy.netProfit) > 0;
    else ok = strategy.expectancyR > m.expectancyR && Number(strategy.netProfit) > Number(m.netProfit);
    beats[t.key] = ok;
    if (!ok) notes.push(`does not beat ${t.name}`);
  }
  return { benchmarks, beats, passed: Object.values(beats).every(Boolean), notes };
}
