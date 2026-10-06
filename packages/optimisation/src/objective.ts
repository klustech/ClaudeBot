import type { BacktestMetrics } from "@ct/backtesting";
import { clamp } from "@ct/shared";

export interface ObjectiveWeights {
  expectancy: number;
  profitFactor: number;
  sharpe: number;
  outOfSample: number;
  stability: number;
  drawdown: number;
  sampleSize: number;
}

export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  expectancy: 0.25,
  profitFactor: 0.2,
  sharpe: 0.15,
  outOfSample: 0.15,
  stability: 0.1,
  drawdown: 0.1,
  sampleSize: 0.05,
};

export interface ObjectiveInput {
  train: BacktestMetrics;
  oos?: BacktestMetrics;
  /** 0-100 parameter stability score if known. */
  stability?: number;
  minTrades: number;
  maxDrawdown: number;
  maxLosingStreak?: number;
}

export interface ObjectiveResult {
  score: number;
  components: Record<keyof ObjectiveWeights, number>;
  penalties: string[];
}

const nExp = (r: number): number => clamp(0.5 + r * 5, 0, 1);

/**
 * Composite optimisation objective (never raw profit). Returns 0-100 after
 * penalties for small samples, large drawdowns, parameter sensitivity,
 * train/test divergence and long losing streaks.
 */
export function compositeObjective(input: ObjectiveInput, w: ObjectiveWeights = DEFAULT_WEIGHTS): ObjectiveResult {
  const t = input.train;
  const components = {
    expectancy: nExp(t.expectancyR),
    profitFactor: clamp((Math.min(t.profitFactor, 10) - 1) / 1, 0, 1),
    sharpe: clamp(t.sharpe / 3, 0, 1),
    outOfSample: input.oos ? nExp(input.oos.expectancyR) : 0,
    stability: input.stability !== undefined ? input.stability / 100 : 0.5,
    drawdown: clamp(1 - t.maxDrawdown / Math.max(1e-9, 2 * input.maxDrawdown), 0, 1),
    sampleSize: clamp(t.tradeCount / 1000, 0, 1),
  };
  let score =
    100 *
    (w.expectancy * components.expectancy +
      w.profitFactor * components.profitFactor +
      w.sharpe * components.sharpe +
      w.outOfSample * components.outOfSample +
      w.stability * components.stability +
      w.drawdown * components.drawdown +
      w.sampleSize * components.sampleSize);
  const penalties: string[] = [];
  if (t.tradeCount < input.minTrades) {
    score *= t.tradeCount / input.minTrades;
    penalties.push(`small sample (${t.tradeCount} < ${input.minTrades})`);
  }
  if (t.maxDrawdown > input.maxDrawdown) {
    score -= 30;
    penalties.push(`drawdown ${(t.maxDrawdown * 100).toFixed(1)}% > ${(input.maxDrawdown * 100).toFixed(1)}%`);
  }
  if (input.stability !== undefined && input.stability < 50) {
    score -= 20;
    penalties.push(`parameter sensitivity (stability ${input.stability.toFixed(0)})`);
  }
  if (input.oos) {
    if (t.expectancyR > 0 && input.oos.expectancyR < 0.5 * t.expectancyR) {
      score -= 20;
      penalties.push("train/test divergence");
    }
  }
  if (t.longestLosingStreak > (input.maxLosingStreak ?? 15)) {
    score -= 10;
    penalties.push(`losing streak ${t.longestLosingStreak}`);
  }
  if (t.expectancyR <= 0) {
    score -= 25;
    penalties.push("non-positive expectancy");
  }
  return { score: clamp(score, 0, 100), components, penalties };
}
