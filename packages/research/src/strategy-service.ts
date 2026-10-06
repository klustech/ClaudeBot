import {
  allowedTransitions,
  buildStrategyId,
  createVersionRecord,
  deriveNextVersion,
  evaluateGate,
  isLiveEligible,
  type PromotionEvidence,
  type StrategyVersionRecord,
} from "@ct/core";
import type { Repository, StrategyVersionRow } from "@ct/database";
import { getTemplate, validateParams } from "@ct/strategies";
import { LifecycleViolation, type ParamSet, type StrategyStage, type Timeframe } from "@ct/shared";
import type { ValidationThresholds } from "@ct/validation";

export interface Actor {
  actor: "claude" | "human" | "system";
  model: string;
  sessionId: string;
}

export const SYSTEM_ACTOR: Actor = { actor: "system", model: "deterministic", sessionId: "system" };

export function rowToRecord(r: StrategyVersionRow): StrategyVersionRecord {
  return {
    id: r.id,
    strategyId: r.strategyId,
    version: r.version,
    name: r.name,
    market: r.market,
    timeframe: r.timeframe as Timeframe,
    template: r.template,
    family: r.family,
    hypothesis: r.hypothesis,
    rationale: r.rationale,
    invalidation: r.invalidation,
    expectedRegimes: r.expectedRegimes,
    parameters: r.parameters,
    risk: r.risk,
    createdBy: r.createdBy as StrategyVersionRecord["createdBy"],
    genome: { parent: r.genomeParent, mutations: r.mutations, generation: r.generation },
    contentHash: r.contentHash,
    createdAt: r.createdAt.toISOString(),
    frozenAt: r.frozenAt ? r.frozenAt.toISOString() : null,
  };
}

/**
 * Strategy lifecycle service: creates immutable versions and performs
 * gated stage transitions. Every transition writes a claude_decisions row.
 */
export class StrategyService {
  constructor(
    private readonly repo: Repository,
    private readonly thresholds: ValidationThresholds,
    private readonly liveTradingEnabled = false,
  ) {}

  async create(input: {
    market: string;
    timeframe: Timeframe;
    template: string;
    name?: string;
    hypothesis?: string;
    rationale?: string;
    invalidation?: string;
    parameters?: ParamSet;
    actor: Actor;
  }): Promise<StrategyVersionRecord> {
    const t = getTemplate(input.template);
    if (t.isBenchmark) throw new Error("Benchmarks cannot be registered as strategies");
    const params = validateParams(t, input.parameters ?? t.defaults);
    const prefix = buildStrategyId(input.market, input.timeframe, t.family, 0).replace(/-000$/, "");
    const seq = await this.repo.nextStrategySequence(prefix);
    const rec = createVersionRecord({
      strategyId: buildStrategyId(input.market, input.timeframe, t.family, seq),
      version: 1,
      name: input.name ?? `${input.market} ${t.name}`,
      market: input.market,
      timeframe: input.timeframe,
      template: t.key,
      family: t.family,
      hypothesis: input.hypothesis ?? t.hypothesis,
      rationale: input.rationale ?? t.description,
      invalidation: input.invalidation ?? "Reject if out-of-sample expectancy after costs is not positive, or walk-forward fails.",
      expectedRegimes: t.expectedRegimes,
      parameters: params,
      risk: {},
      createdBy: input.actor.actor === "human" ? "human" : input.actor.actor === "claude" ? "claude" : "system",
      genome: { parent: null, mutations: [], generation: 0 },
    });
    await this.repo.insertStrategyVersion(rec, "IDEA");
    await this.repo.recordDecision({
      strategyId: rec.id,
      action: "CREATE_STRATEGY",
      reason: rec.hypothesis,
      evidence: { template: rec.template, parameters: rec.parameters },
      inputMetrics: {},
      outputDecision: "IDEA",
      ...input.actor,
    });
    return rec;
  }

  /** Creates the next immutable version (never edits the parent). */
  async derive(parentId: string, changes: { parameters?: ParamSet; hypothesis?: string; rationale?: string; mutations: string[] }, actor: Actor): Promise<StrategyVersionRecord> {
    const parent = await this.repo.getVersion(parentId);
    if (!parent) throw new Error(`Unknown strategy version ${parentId}`);
    if (changes.parameters) validateParams(getTemplate(parent.template), changes.parameters);
    const latest = await this.repo.latestVersionNumber(parent.strategyId);
    const child = deriveNextVersion(rowToRecord(parent), latest, { ...changes, createdBy: actor.actor === "system" ? "system" : actor.actor });
    await this.repo.insertStrategyVersion(child, "IDEA");
    await this.repo.recordDecision({
      strategyId: child.id,
      action: "DERIVE_VERSION",
      reason: changes.mutations.join("; "),
      evidence: { parent: parentId, parameters: child.parameters },
      inputMetrics: {},
      outputDecision: "IDEA",
      ...actor,
    });
    return child;
  }

  async transition(
    versionId: string,
    to: StrategyStage,
    input: { reason: string; evidence?: PromotionEvidence & Record<string, unknown>; metrics?: Record<string, unknown>; actor: Actor; humanApproval?: boolean },
  ): Promise<void> {
    const v = await this.repo.getVersion(versionId);
    if (!v) throw new Error(`Unknown strategy version ${versionId}`);
    const from = v.stage as StrategyStage;
    if (!allowedTransitions(from).includes(to)) {
      throw new LifecycleViolation(`Illegal lifecycle transition ${from} → ${to} for ${versionId}`, { allowed: allowedTransitions(from) });
    }
    const evidence: PromotionEvidence = {
      ...(v.evidence as PromotionEvidence),
      ...(input.evidence ?? {}),
      frozen: v.frozenAt !== null,
      humanApproval: input.humanApproval ?? false,
    };
    if (to === "LIVE" && input.actor.actor !== "human") {
      throw new LifecycleViolation("Only a human can promote a strategy to LIVE");
    }
    if (to === "APPROVED" && input.actor.actor === "claude") {
      throw new LifecycleViolation("Claude may recommend but not approve; APPROVED requires a human or the deterministic gate");
    }
    const gate = evaluateGate(from, to, evidence, {
      minConfidence: this.thresholds.minConfidence,
      minPaperTrades: this.thresholds.paperGraduationTrades[0] ?? 100,
      liveTradingEnabled: this.liveTradingEnabled,
    });
    if (!gate.allowed) {
      await this.repo.recordDecision({
        strategyId: versionId,
        action: `PROMOTE_${from}_TO_${to}`,
        reason: input.reason,
        evidence: { ...evidence, gateFailures: gate.failures },
        inputMetrics: input.metrics ?? {},
        outputDecision: "BLOCKED_BY_GATE",
        ...input.actor,
      });
      throw new LifecycleViolation(`Gate ${from} → ${to} blocked: ${gate.failures.join("; ")}`, { failures: gate.failures });
    }
    const { humanApproval: _h, frozen: _f, ...persistable } = evidence;
    await this.repo.updateLifecycle(versionId, {
      stage: to,
      evidence: persistable as Record<string, unknown>,
      liveEligible: isLiveEligible(evidence),
      ...(evidence.confidenceScore !== undefined ? { confidence: evidence.confidenceScore } : {}),
    });
    await this.repo.recordDecision({
      strategyId: versionId,
      action: `${stageOrderLabel(from, to)}_${from}_TO_${to}`,
      reason: input.reason,
      evidence: persistable as Record<string, unknown>,
      inputMetrics: input.metrics ?? {},
      outputDecision: to,
      ...input.actor,
    });
  }
}

function stageOrderLabel(from: StrategyStage, to: StrategyStage): string {
  if (to === "RETIRED") return "RETIRE";
  if (to === "DEGRADED" || (from === "DEGRADED" && to === "PAPER") || (from === "APPROVED" && to === "PAPER")) return "DEMOTE";
  return "PROMOTE";
}
