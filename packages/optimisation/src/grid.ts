import type { ParamSpec, StrategyTemplate } from "@ct/strategies";
import { SeededRandom, type ParamSet, type ParamValue } from "@ct/shared";

export function specValues(spec: ParamSpec): ParamValue[] {
  if (spec.type === "choice") return [...spec.values];
  const out: number[] = [];
  const decimals = spec.type === "float" ? Math.max(0, (String(spec.step).split(".")[1] ?? "").length) : 0;
  for (let v = spec.min; v <= spec.max + 1e-9; v += spec.step) {
    out.push(Number(v.toFixed(decimals)));
  }
  return out;
}

export function gridSize(template: StrategyTemplate): number {
  return Object.values(template.params).reduce((acc, s) => acc * specValues(s).length, 1);
}

/** Full cartesian grid, or a seeded random sample when larger than maxConfigs. */
export function parameterGrid(template: StrategyTemplate, opts: { maxConfigs?: number; seed?: number } = {}): ParamSet[] {
  const keys = Object.keys(template.params);
  const values = keys.map((k) => specValues(template.params[k] as ParamSpec));
  const total = values.reduce((a, v) => a * v.length, 1);
  const max = opts.maxConfigs ?? 500;
  const build = (idx: number): ParamSet => {
    const out: Record<string, ParamValue> = {};
    let r = idx;
    for (let i = keys.length - 1; i >= 0; i--) {
      const vs = values[i] as ParamValue[];
      out[keys[i] as string] = vs[r % vs.length] as ParamValue;
      r = Math.floor(r / vs.length);
    }
    return Object.freeze(out);
  };
  if (keys.length === 0) return [Object.freeze({})];
  if (total <= max) return Array.from({ length: total }, (_, i) => build(i));
  const rng = new SeededRandom(opts.seed ?? 1);
  const chosen = new Set<number>();
  while (chosen.size < max) chosen.add(rng.int(0, total));
  return [...chosen].sort((a, b) => a - b).map(build);
}
