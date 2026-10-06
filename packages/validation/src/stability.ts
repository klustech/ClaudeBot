import { runBacktest, type BacktestConfig } from "@ct/backtesting";
import { specValues } from "@ct/optimisation";
import type { ParamSpec, StrategyTemplate } from "@ct/strategies";
import { clamp, mean, median, stddev, type ParamSet, type ParamValue } from "@ct/shared";

export interface NeighbourResult {
  params: ParamSet;
  changed: string;
  expectancyR: number;
  profitFactor: number;
  trades: number;
}

export interface HeatmapCell {
  x: ParamValue;
  y: ParamValue;
  expectancyR: number;
}

export interface StabilityResult {
  score: number;
  positiveFraction: number;
  medianRatio: number;
  dispersion: number;
  neighbours: NeighbourResult[];
  heatmap: { xParam: string; yParam: string; cells: HeatmapCell[] } | null;
}

function neighbourValues(spec: ParamSpec, current: ParamValue, radius: number): ParamValue[] {
  const vals = specValues(spec);
  const idx = vals.findIndex((v) => v === current);
  if (idx < 0) return [];
  const out: ParamValue[] = [];
  for (let d = -radius; d <= radius; d++) {
    if (d === 0) continue;
    const v = vals[idx + d];
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * Parameter Stability Score (0-100). A robust strategy performs similarly in
 * its parameter neighbourhood; a spike surrounded by poor results (RSI 63 good,
 * 62/64 terrible) scores low.
 */
export function parameterStability(
  base: Omit<BacktestConfig, "template" | "params">,
  template: StrategyTemplate,
  best: ParamSet,
  opts: { radius?: number; heatmap?: boolean } = {},
): StabilityResult {
  const radius = opts.radius ?? 2;
  const bestRun = runBacktest({ ...base, template, params: best }).metrics;
  const neighbours: NeighbourResult[] = [];
  for (const [key, spec] of Object.entries(template.params)) {
    if (spec.type === "choice") continue;
    for (const v of neighbourValues(spec, best[key] as ParamValue, radius)) {
      const params = { ...best, [key]: v };
      const m = runBacktest({ ...base, template, params }).metrics;
      neighbours.push({ params, changed: `${key}=${String(v)}`, expectancyR: m.expectancyR, profitFactor: m.profitFactor, trades: m.tradeCount });
    }
  }
  if (neighbours.length === 0) {
    return { score: 50, positiveFraction: 0, medianRatio: 0, dispersion: 0, neighbours, heatmap: null };
  }
  const exps = neighbours.map((n) => n.expectancyR);
  const positiveFraction = exps.filter((e) => e > 0).length / exps.length;
  const bestExp = bestRun.expectancyR;
  const medianRatio = bestExp > 0 ? clamp(median(exps) / bestExp, -1, 1) : 0;
  const scale = Math.max(Math.abs(mean(exps)), Math.abs(bestExp), 1e-6);
  const dispersion = stddev(exps) / scale;
  const score = clamp(100 * (0.5 * positiveFraction + 0.3 * clamp(medianRatio, 0, 1) + 0.2 * clamp(1 - dispersion, 0, 1)), 0, 100);

  let heatmap: StabilityResult["heatmap"] = null;
  if (opts.heatmap !== false) {
    const numeric = Object.entries(template.params).filter(([, s]) => s.type !== "choice");
    if (numeric.length >= 2) {
      const [xKey, xSpec] = numeric[0] as [string, ParamSpec];
      const [yKey, ySpec] = numeric[1] as [string, ParamSpec];
      const cells: HeatmapCell[] = [];
      for (const x of specValues(xSpec)) {
        for (const y of specValues(ySpec)) {
          const m = runBacktest({ ...base, template, params: { ...best, [xKey]: x, [yKey]: y } }).metrics;
          cells.push({ x, y, expectancyR: m.expectancyR });
        }
      }
      heatmap = { xParam: xKey, yParam: yKey, cells };
    }
  }
  return { score, positiveFraction, medianRatio, dispersion, neighbours, heatmap };
}
