import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repository } from "@ct/database";
import { RESEARCH_TEMPLATES } from "@ct/strategies";
import { repoRoot, type Timeframe } from "@ct/shared";
import type { ResearchService, ValidationOutcome } from "./research-service";
import type { Actor } from "./strategy-service";

export interface CampaignInput {
  name: string;
  objective: string;
  markets: string[];
  timeframe: Timeframe;
  templates?: string[];
  actor: Actor;
  onProgress?: (msg: string) => void;
}

export interface CampaignResult {
  campaignId: string;
  hypothesesTested: number;
  outcomes: { market: string; template: string; rootVersion: string; validatedVersion: string | null; outcome: ValidationOutcome | null; error?: string }[];
  selected: string[];
  reportPath: string;
}

/**
 * Runs a research campaign: independent hypothesis families × markets,
 * each taken through backtest → TRAIN optimisation → validation → holdout.
 * Every hypothesis is tracked (including failures) and a full report written.
 */
export async function runCampaign(repo: Repository, research: ResearchService, input: CampaignInput): Promise<CampaignResult> {
  const log = input.onProgress ?? (() => undefined);
  const campaignId = await repo.createCampaign({ name: input.name, objective: input.objective, markets: input.markets, timeframe: input.timeframe });
  const templates = input.templates ?? RESEARCH_TEMPLATES.map((t) => t.key);
  const outcomes: CampaignResult["outcomes"] = [];
  for (const market of input.markets) {
    for (const template of templates) {
      log(`[${market}] ${template}: creating hypothesis`);
      const rec = await research.strategies.create({ market, timeframe: input.timeframe, template, actor: input.actor });
      try {
        await research.researchAndBacktest(rec.id, input.actor, campaignId);
        log(`[${market}] ${template}: optimising on TRAIN`);
        const opt = await research.optimiseVersion(rec.id, input.actor, campaignId);
        const target = opt.childId ?? rec.id;
        log(`[${market}] ${template}: validating ${target}`);
        const outcome = await research.validate(target, input.actor, campaignId);
        log(`[${market}] ${template}: ${outcome.finalStage}${outcome.reasons.length ? ` — ${outcome.reasons[0]}` : ""}`);
        outcomes.push({ market, template, rootVersion: rec.id, validatedVersion: target, outcome });
      } catch (err) {
        log(`[${market}] ${template}: ERROR ${(err as Error).message}`);
        outcomes.push({ market, template, rootVersion: rec.id, validatedVersion: null, outcome: null, error: (err as Error).message });
      }
    }
  }
  const selection = await research.rankAndSelect(["INCUBATING"]);
  const reportPath = writeCampaignReport(campaignId, input, outcomes, selection, await repo.totalTrials());
  await repo.completeCampaign(campaignId);
  return { campaignId, hypothesesTested: outcomes.length, outcomes, selected: selection.selected, reportPath };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function writeCampaignReport(
  campaignId: string,
  input: CampaignInput,
  outcomes: CampaignResult["outcomes"],
  selection: { selected: string[]; rejected: { id: string; reason: string }[] },
  totalTrials: number,
  root = repoRoot(),
): string {
  const survivors = outcomes.filter((o) => o.outcome?.finalStage === "INCUBATING");
  const rejected = outcomes.filter((o) => o.outcome && o.outcome.finalStage !== "INCUBATING");
  const errors = outcomes.filter((o) => o.error);
  const L: string[] = [];
  L.push(`# Research Campaign Report — ${input.name}`, "", `Campaign: \`${campaignId}\`  `, `Generated: ${new Date().toISOString()}`, "");
  L.push("## Objective", "", input.objective, "");
  L.push("## Scope", "", `- Markets: ${input.markets.join(", ")}`, `- Timeframe: ${input.timeframe}`, `- Hypothesis families: ${new Set(outcomes.map((o) => o.template)).size}`, `- Hypotheses tested this campaign: ${outcomes.length}`, `- Programme-wide configurations tested (multiple-testing denominator): ${totalTrials.toLocaleString("en-GB")}`, "");
  L.push("## Hypotheses tested", "", "| Market | Template | Version | Outcome | Confidence |", "|---|---|---|---|---|");
  for (const o of outcomes) {
    L.push(`| ${o.market} | ${o.template} | ${o.validatedVersion ?? o.rootVersion} | ${o.error ? "ERROR" : (o.outcome?.finalStage ?? "-")} | ${o.outcome?.score?.confidence ?? "-"} |`);
  }
  L.push("", "## Rejected strategies", "");
  if (rejected.length === 0) L.push("None.");
  for (const o of rejected) L.push(`- **${o.validatedVersion}** (${o.template}, ${o.market}): ${o.outcome?.reasons.slice(0, 4).join("; ")}`);
  if (errors.length) {
    L.push("", "### Errors", "");
    for (const o of errors) L.push(`- ${o.rootVersion}: ${o.error}`);
  }
  L.push("", "## Surviving strategies & statistical evidence", "");
  if (survivors.length === 0) L.push("No strategy survived. This is an acceptable and common outcome: no edge was demonstrated after costs, out-of-sample testing and multiple-testing correction.");
  for (const o of survivors) {
    const r = o.outcome?.report;
    if (!r) continue;
    L.push(
      `### ${o.validatedVersion}`,
      "",
      `- Parameters: \`${JSON.stringify(r.selectedParams)}\``,
      `- TRAIN: ${r.train.tradeCount} trades, PF ${r.train.profitFactor.toFixed(2)}, E[R] ${r.train.expectancyR.toFixed(4)}, DD ${pct(r.train.maxDrawdown)}`,
      `- VALIDATION: ${r.validation.tradeCount} trades, PF ${r.validation.profitFactor.toFixed(2)}, E[R] ${r.validation.expectancyR.toFixed(4)}, DD ${pct(r.validation.maxDrawdown)}`,
      `- Walk-forward: ${r.walkForward.profitableWindows}/${r.walkForward.windows.length} windows profitable; worst window E[R] ${r.walkForward.worstWindowExpectancyR.toFixed(4)}`,
      `- Monte Carlo (${r.monteCarlo.simulations}): median ${pct(r.monteCarlo.medianReturn)}, 5th pct ${pct(r.monteCarlo.p05Return)}, P(ruin) ${pct(r.monteCarlo.probabilityOfRuin)}, E[maxDD] ${pct(r.monteCarlo.expectedMaxDrawdown)}`,
      `- Deflated Sharpe probability: ${r.deflatedSharpe.deflatedSharpeProbability.toFixed(3)} (trials ${r.deflatedSharpe.trials})`,
      `- Parameter stability: ${r.stability.score.toFixed(0)}/100`,
      `- Confidence: ${o.outcome?.score.confidence}`,
      `- Expected regimes: ${Object.entries(r.regimes).filter(([, s]) => s.trades >= 20 && s.expectancyR > 0).map(([k]) => k).join(", ") || "n/a"}`,
      `- Weaknesses / failure conditions: ${Object.entries(r.regimes).filter(([, s]) => s.trades >= 20 && s.expectancyR <= 0).map(([k]) => `negative in ${k}`).join(", ") || "none observed with sufficient sample"}; longest losing streak ${r.validation.longestLosingStreak}`,
      "",
    );
  }
  L.push("## Diversified PAPER selection", "");
  L.push(selection.selected.length ? selection.selected.map((s) => `- ${s}`).join("\n") : "None selected.");
  if (selection.rejected.length) L.push("", "Excluded for diversification:", ...selection.rejected.map((r) => `- ${r.id}: ${r.reason}`));
  L.push(
    "",
    "## Recommended paper-testing plan",
    "",
    "1. Promote selected strategies INCUBATING → PAPER (deterministic gate).",
    "2. Run paper sessions with realistic latency, fees, slippage and missed fills.",
    "3. Evaluate at 100 / 250 / 500 / 1,000 trade tiers; graduation is trade-count based, not calendar based.",
    "4. Auto-demote on statistically significant degradation versus the OOS distribution.",
    "5. Live trading remains disabled. Any live step requires explicit human approval and LIVE_TRADING_ENABLED=true.",
    "",
  );
  const dir = join(root, "reports", "campaigns");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().slice(0, 10)}-${campaignId}.md`);
  writeFileSync(path, L.join("\n"));
  return path;
}
