import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repository } from "@ct/database";
import { correlationMatrix, dailyReturnStream } from "@ct/portfolio";
import { detectDegradation, type ExpectedDistribution } from "@ct/risk";
import { mean, repoRoot } from "@ct/shared";

const DAY = 86_400_000;

export async function generateDailyReport(repo: Repository, now = Date.now(), root = repoRoot()): Promise<{ path: string; markdown: string }> {
  const since = now - DAY;
  const experiments = (await repo.listExperiments({ limit: 5000 })).filter((e) => e.createdAt.getTime() >= since);
  const versions = await repo.listVersions({ limit: 5000 });
  const decisions = (await repo.listDecisions({ limit: 2000 })).filter((d) => d.timestamp.getTime() >= since);
  const promotions = decisions.filter((d) => d.outputDecision === "INCUBATING");
  const rejections = decisions.filter((d) => d.outputDecision === "RETIRED");
  const paperTrades = (await repo.listTrades({ sessionKind: "paper", limit: 10_000 })).filter((t) => t.exitTime.getTime() >= since);
  const pnl = paperTrades.reduce((a, t) => a + Number(t.pnl), 0);
  const riskEvents = (await repo.listRiskEvents(1000)).filter((e) => e.at.getTime() >= since);
  const sysEvents = (await repo.listSystemEvents(1000)).filter((e) => e.at.getTime() >= since && (e.level === "error" || e.level === "critical"));
  const sessions = await repo.listPaperSessions(10);
  let maxDd = 0;
  for (const s of sessions) {
    const eq = await repo.equityForSession(s.id);
    for (const p of eq) maxDd = Math.max(maxDd, p.drawdown);
  }
  const stats = await repo.researchStats();
  const failedFamilies = new Map<string, number>();
  for (const d of rejections) {
    const v = versions.find((x) => x.id === d.strategyId);
    if (v) failedFamilies.set(v.family, (failedFamilies.get(v.family) ?? 0) + 1);
  }
  const L = [
    `# Daily Research Report — ${new Date(now).toISOString().slice(0, 10)}`,
    "",
    "## Research",
    `- Experiments run (24h): ${experiments.length}`,
    `- Configurations tested (24h): ${experiments.reduce((a, e) => a + e.configurationsTested, 0).toLocaleString("en-GB")}`,
    `- New candidates (→ INCUBATING): ${promotions.length}${promotions.length ? ` (${promotions.map((p) => p.strategyId).join(", ")})` : ""}`,
    `- Rejections: ${rejections.length}`,
    `- Programme totals: ${stats.strategies} strategies, ${stats.strategyVersions} versions, ${stats.parameterConfigurations.toLocaleString("en-GB")} configurations`,
    "",
    "## Paper performance (24h)",
    `- Trades: ${paperTrades.length}`,
    `- Win rate: ${paperTrades.length ? ((paperTrades.filter((t) => t.win).length / paperTrades.length) * 100).toFixed(1) : "0.0"}%`,
    `- P&L: ${pnl.toFixed(2)}`,
    `- Max drawdown (recent sessions): ${(maxDd * 100).toFixed(2)}%`,
    "",
    "## Risk events (24h)",
    ...(riskEvents.length ? riskEvents.slice(0, 30).map((e) => `- ${e.at.toISOString()} [${e.kind}] ${e.code}: ${e.message}`) : ["- none"]),
    "",
    "## System health",
    ...(sysEvents.length ? sysEvents.slice(0, 30).map((e) => `- ${e.at.toISOString()} [${e.level}] ${e.source}: ${e.message}`) : ["- no errors"]),
    "",
    "## Recommended experiments",
    ...([...failedFamilies.entries()].map(([f, n]) => `- ${f}: ${n} rejection(s) today — analyse failure regimes before generating more variants.`) || []),
    "- Prefer new hypothesis families over further mutation of families with repeated OOS collapse (multiple-testing budget).",
    "",
  ];
  const md = L.join("\n");
  const dir = join(root, "reports", "daily");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date(now).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, md);
  return { path, markdown: md };
}

export async function generateWeeklyReview(repo: Repository, now = Date.now(), root = repoRoot()): Promise<{ path: string; markdown: string; degraded: string[] }> {
  const since = now - 7 * DAY;
  const active = await repo.listVersions({ stage: ["PAPER", "APPROVED", "LIVE", "DEGRADED"] });
  const L = [`# Weekly Review — week ending ${new Date(now).toISOString().slice(0, 10)}`, "", "## Expectation vs paper/live behaviour", ""];
  L.push("| Strategy | Stage | Trades | Expected E[R] | Realised E[R] | Expected WR | Realised WR | Degraded |", "|---|---|---|---|---|---|---|---|");
  const degraded: string[] = [];
  const streams = [];
  for (const v of active) {
    const trades = (await repo.listTrades({ strategyVersionId: v.id, limit: 10_000 })).filter((t) => t.sessionKind !== "backtest");
    const rets = trades.map((t) => t.returnOnStake).reverse();
    const expected = (v.evidence as { expected?: ExpectedDistribution }).expected;
    const deg = expected ? detectDegradation(rets, expected) : null;
    if (deg?.degraded) degraded.push(v.id);
    streams.push(dailyReturnStream(v.id, trades.map((t) => ({ exitTime: t.exitTime.getTime(), returnOnStake: t.returnOnStake }))));
    L.push(
      `| ${v.id} | ${v.stage} | ${rets.length} | ${expected?.expectancyR.toFixed(4) ?? "-"} | ${mean(rets).toFixed(4)} | ${expected ? (expected.winRate * 100).toFixed(1) + "%" : "-"} | ${rets.length ? ((rets.filter((r) => r > 0).length / rets.length) * 100).toFixed(1) : "0.0"}% | ${deg?.degraded ? "YES" : "no"} |`,
    );
  }
  L.push("", "## Unexpected correlation", "");
  const cm = correlationMatrix(streams);
  const pairs: string[] = [];
  cm.ids.forEach((a, i) =>
    cm.ids.forEach((b, j) => {
      const c = cm.matrix[i]?.[j] ?? 0;
      if (j > i && Math.abs(c) > 0.5) pairs.push(`- ${a} ↔ ${b}: ${c.toFixed(2)}`);
    }),
  );
  L.push(...(pairs.length ? pairs : ["- none above 0.5"]));
  const risk = (await repo.listRiskEvents(2000)).filter((e) => e.at.getTime() >= since);
  const byCode = new Map<string, number>();
  for (const e of risk) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
  L.push("", "## Execution problems", "", ...([...byCode.entries()].map(([k, n]) => `- ${k}: ${n}`) || []), risk.length ? "" : "- none", "");
  L.push("## Edge degradation", "", ...(degraded.length ? degraded.map((d) => `- ${d}: statistically degraded → demote to PAPER/RETIRED per policy`) : ["- none detected"]), "");
  const md = L.join("\n");
  const dir = join(root, "reports", "weekly");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date(now).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, md);
  return { path, markdown: md, degraded };
}
