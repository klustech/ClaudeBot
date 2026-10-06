import type { Repository } from "@ct/database";
import { generateDailyReport, generateWeeklyReview, runCampaign, type Actor, type ResearchService } from "@ct/research";
import type { Timeframe } from "@ct/shared";
import type { JobHandler } from "./jobs";

/** Shared by the API (inline mode) and apps/worker (BullMQ mode). */
export function researchJobHandler(repo: Repository, research: ResearchService): JobHandler {
  return async (kind, input, progress) => {
    const actor = (input.actor as Actor | undefined) ?? { actor: "claude", model: "unknown", sessionId: "unknown" };
    switch (kind) {
      case "campaign":
        return runCampaign(repo, research, {
          name: String(input.name ?? "Research Campaign"),
          objective: String(input.objective ?? ""),
          markets: input.markets as string[],
          timeframe: (input.timeframe as Timeframe) ?? "15m",
          ...(input.templates ? { templates: input.templates as string[] } : {}),
          actor,
          onProgress: progress,
        });
      case "research_strategy": {
        const rec = await research.strategies.create({
          market: String(input.market),
          timeframe: (input.timeframe as Timeframe) ?? "15m",
          template: String(input.template),
          ...(input.name ? { name: String(input.name) } : {}),
          ...(input.hypothesis ? { hypothesis: String(input.hypothesis) } : {}),
          ...(input.rationale ? { rationale: String(input.rationale) } : {}),
          ...(input.invalidation ? { invalidation: String(input.invalidation) } : {}),
          ...(input.parameters ? { parameters: input.parameters as Record<string, number | string | boolean> } : {}),
          actor,
        });
        progress(`created ${rec.id}`);
        const bt = await research.researchAndBacktest(rec.id, actor, (input.campaignId as string | undefined) ?? null);
        return { versionId: rec.id, backtest: bt };
      }
      case "optimise":
        return research.optimiseVersion(String(input.versionId), actor, (input.campaignId as string | undefined) ?? null);
      case "validate": {
        const out = await research.validate(String(input.versionId), actor, (input.campaignId as string | undefined) ?? null);
        return { versionId: out.versionId, passed: out.passed, finalStage: out.finalStage, confidence: out.score?.confidence ?? null, reasons: out.reasons, checks: out.report?.checks ?? [] };
      }
      case "daily_report":
        return generateDailyReport(repo);
      case "weekly_review":
        return generateWeeklyReview(repo);
      default:
        throw new Error(`Unknown job kind ${kind as string}`);
    }
  };
}
