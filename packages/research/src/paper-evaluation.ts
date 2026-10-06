import type { Repository } from "@ct/database";
import { detectDegradation, type ExpectedDistribution } from "@ct/risk";
import { mean } from "@ct/shared";
import type { ValidationThresholds } from "@ct/validation";

export interface PaperEvaluation {
  versionId: string;
  trades: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdown: number;
  deviationFromOos: number | null;
  tier: number;
  nextTierTrades: number | null;
  passed: boolean;
  degraded: boolean;
  reasons: string[];
}

/** Paper promotion gate: performance-based graduation by trade count tiers. */
export async function evaluatePaper(repo: Repository, versionId: string, t: ValidationThresholds): Promise<PaperEvaluation> {
  const v = await repo.getVersion(versionId);
  if (!v) throw new Error(`Unknown version ${versionId}`);
  const trades = (await repo.listTrades({ strategyVersionId: versionId, sessionKind: "paper", limit: 100_000 })).reverse();
  const rets = trades.map((x) => x.returnOnStake);
  const wins = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = -rets.filter((r) => r <= 0).reduce((a, b) => a + b, 0);
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  const stakeFrac = 0.01;
  for (const r of rets) {
    eq *= 1 + r * stakeFrac;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, (peak - eq) / peak);
  }
  const expected = (v.evidence as { expected?: ExpectedDistribution }).expected;
  const e = mean(rets);
  const pf = losses > 0 ? wins / losses : wins > 0 ? 999 : 0;
  const dev = expected && expected.expectancyR !== 0 ? Math.abs(e - expected.expectancyR) / Math.abs(expected.expectancyR) : null;
  const tiers = t.paperGraduationTrades;
  const tier = tiers.filter((x) => rets.length >= x).length;
  const reasons: string[] = [];
  if (rets.length < (tiers[0] ?? 100)) reasons.push(`${rets.length}/${tiers[0]} trades for first tier`);
  if (e <= 0) reasons.push("non-positive paper expectancy");
  if (pf < t.paperMinProfitFactor) reasons.push(`paper PF ${pf.toFixed(2)} < ${t.paperMinProfitFactor}`);
  if (mdd > t.paperMaxDrawdown) reasons.push(`paper drawdown ${(mdd * 100).toFixed(1)}%`);
  if (dev !== null && dev > t.paperMaxDeviationFromOos) reasons.push(`paper deviates ${(dev * 100).toFixed(0)}% from OOS expectation`);
  const failures = await repo.listRiskEvents(500);
  const infra = failures.filter((f) => f.strategyVersionId === versionId && f.kind === "breaker").length;
  if (infra > 0) reasons.push(`${infra} infrastructure breaker events`);
  const deg = expected ? detectDegradation(rets, expected, { currentDrawdown: mdd }) : null;
  if (deg?.degraded) reasons.push(...deg.reasons);
  return {
    versionId,
    trades: rets.length,
    expectancyR: e,
    profitFactor: pf,
    maxDrawdown: mdd,
    deviationFromOos: dev,
    tier,
    nextTierTrades: tiers[tier] ?? null,
    passed: reasons.length === 0,
    degraded: deg?.degraded ?? false,
    reasons,
  };
}
