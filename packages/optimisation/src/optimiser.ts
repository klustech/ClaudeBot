import { runBacktest, type BacktestConfig, type BacktestMetrics } from "@ct/backtesting";
import { getTemplate, type StrategyTemplate } from "@ct/strategies";
import type { ParamSet } from "@ct/shared";
import { parameterGrid } from "./grid";
import { compositeObjective, type ObjectiveResult } from "./objective";

export interface OptimisationCandidate {
  params: ParamSet;
  metrics: BacktestMetrics;
  objective: ObjectiveResult;
  runHash: string;
}

export interface OptimisationResult {
  template: string;
  configurationsTested: number;
  candidates: OptimisationCandidate[];
}

export interface OptimiseOptions {
  maxConfigs?: number;
  seed?: number;
  minTrades: number;
  maxDrawdown: number;
  /** Optional callback for persisting every tested configuration. */
  onCandidate?: (c: OptimisationCandidate) => void;
}

/**
 * Searches the template's parameter space on the TRAIN slice only.
 * Every configuration tested is counted toward the multiple-testing total.
 */
export function optimise(
  base: Omit<BacktestConfig, "template" | "params">,
  templateOrKey: StrategyTemplate | string,
  opts: OptimiseOptions,
): OptimisationResult {
  const template = typeof templateOrKey === "string" ? getTemplate(templateOrKey) : templateOrKey;
  const grid = parameterGrid(template, { maxConfigs: opts.maxConfigs ?? 200, seed: opts.seed ?? base.seed });
  const candidates: OptimisationCandidate[] = [];
  for (const params of grid) {
    const r = runBacktest({ ...base, template, params });
    const objective = compositeObjective({ train: r.metrics, minTrades: opts.minTrades, maxDrawdown: opts.maxDrawdown });
    const cand = { params, metrics: r.metrics, objective, runHash: r.manifest.runHash };
    opts.onCandidate?.(cand);
    candidates.push(cand);
  }
  candidates.sort((a, b) => b.objective.score - a.objective.score);
  return { template: template.key, configurationsTested: grid.length, candidates };
}
