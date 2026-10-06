import type { ParamSet } from "@ct/shared";
import {
  atrExpansion,
  benchmarkBuyHold,
  benchmarkMomentum,
  benchmarkNoTrade,
  benchmarkRandom,
  benchmarkSmaCross,
  bollingerReversion,
  donchianBreakout,
  emaTrendContinuation,
  multiTimeframeMomentum,
  regimeSwitching,
  rsiDivergence,
  rsiMacdMomentum,
  volatilityCompression,
  volumeBreakout,
  vwapDeviation,
} from "./templates";
import type { ParamSpec, StrategyTemplate } from "./types";

export const RESEARCH_TEMPLATES: readonly StrategyTemplate[] = [
  rsiMacdMomentum,
  bollingerReversion,
  donchianBreakout,
  volatilityCompression,
  emaTrendContinuation,
  volumeBreakout,
  atrExpansion,
  vwapDeviation,
  rsiDivergence,
  multiTimeframeMomentum,
  regimeSwitching,
];

export const BENCHMARK_TEMPLATES: readonly StrategyTemplate[] = [
  benchmarkRandom,
  benchmarkBuyHold,
  benchmarkSmaCross,
  benchmarkMomentum,
  benchmarkNoTrade,
];

const ALL = new Map<string, StrategyTemplate>([...RESEARCH_TEMPLATES, ...BENCHMARK_TEMPLATES].map((t) => [t.key, t]));

export function getTemplate(key: string): StrategyTemplate {
  const t = ALL.get(key);
  if (!t) throw new Error(`Unknown strategy template "${key}". Known: ${[...ALL.keys()].join(", ")}`);
  return t;
}

export function listTemplates(): StrategyTemplate[] {
  return [...ALL.values()];
}

export function validateParams(template: StrategyTemplate, params: ParamSet): ParamSet {
  const out: Record<string, ParamSet[string]> = { ...template.defaults };
  for (const [k, v] of Object.entries(params)) {
    const spec: ParamSpec | undefined = template.params[k];
    if (!spec) throw new Error(`Unknown parameter "${k}" for template ${template.key}`);
    if (spec.type === "choice") {
      if (!spec.values.includes(v)) throw new Error(`Parameter ${k}=${String(v)} not in ${JSON.stringify(spec.values)}`);
    } else {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Parameter ${k} must be numeric`);
      if (spec.type === "int" && !Number.isInteger(v)) throw new Error(`Parameter ${k} must be an integer`);
    }
    out[k] = v;
  }
  return Object.freeze(out);
}
