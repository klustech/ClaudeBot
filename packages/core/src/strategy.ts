import {
  hashObject,
  ImmutabilityViolation,
  type ParamSet,
  type StrategyStage,
  type Timeframe,
} from "@ct/shared";

export interface StrategyGenome {
  /** Version id of the parent this was derived from, or null for a root. */
  readonly parent: string | null;
  /** Human-readable list of what changed relative to the parent. */
  readonly mutations: readonly string[];
  readonly generation: number;
}

export interface StrategyRiskProfile {
  readonly maxStakePercent?: number;
  readonly stopAtr?: number;
  readonly notes?: string;
}

/** The immutable definition of one version of a strategy. */
export interface StrategyVersionDefinition {
  /** Base id, e.g. ETH-15M-RSI-MACD-001. */
  readonly strategyId: string;
  readonly version: number;
  readonly name: string;
  readonly market: string;
  readonly timeframe: Timeframe;
  /** Strategy template key in @ct/strategies. */
  readonly template: string;
  readonly family: string;
  readonly hypothesis: string;
  readonly rationale: string;
  readonly invalidation: string;
  readonly expectedRegimes: readonly string[];
  readonly parameters: ParamSet;
  readonly risk: StrategyRiskProfile;
  readonly createdBy: "claude" | "human" | "system";
  readonly genome: StrategyGenome;
}

export interface StrategyVersionRecord extends StrategyVersionDefinition {
  /** e.g. ETH-15M-RSI-MACD-001-v2 */
  readonly id: string;
  readonly contentHash: string;
  readonly createdAt: string;
  /** Set when the version is frozen; the locked TEST period is only accessible afterwards. */
  readonly frozenAt: string | null;
}

export function versionId(strategyId: string, version: number): string {
  return `${strategyId}-v${version}`;
}

const STRATEGY_ID_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/;

export function isValidStrategyId(id: string): boolean {
  return STRATEGY_ID_RE.test(id);
}

/** Builds a canonical strategy id: ETH-15M-RSI-MACD-001. */
export function buildStrategyId(market: string, timeframe: string, family: string, sequence: number): string {
  const asset = market.replace(/USDT$|USD$|USDC$/i, "").toUpperCase();
  const fam = family.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${asset}-${timeframe.toUpperCase()}-${fam}-${String(sequence).padStart(3, "0")}`;
}

export function definitionHash(def: StrategyVersionDefinition): string {
  return hashObject({
    strategyId: def.strategyId,
    version: def.version,
    market: def.market,
    timeframe: def.timeframe,
    template: def.template,
    hypothesis: def.hypothesis,
    parameters: def.parameters,
    risk: def.risk,
    genome: def.genome,
  });
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

export function createVersionRecord(def: StrategyVersionDefinition, createdAt = new Date()): StrategyVersionRecord {
  if (!isValidStrategyId(def.strategyId)) {
    throw new Error(`Invalid strategy id "${def.strategyId}". Expected e.g. ETH-15M-RSI-MACD-001`);
  }
  if (!def.hypothesis.trim()) throw new Error("A strategy requires a falsifiable hypothesis");
  return deepFreeze({
    ...def,
    id: versionId(def.strategyId, def.version),
    contentHash: definitionHash(def),
    createdAt: createdAt.toISOString(),
    frozenAt: null,
  });
}

/**
 * Derives the next immutable version. The parent is never modified: any
 * change of parameters, filters or rules produces a new version that must
 * restart validation from RESEARCH.
 */
export function deriveNextVersion(
  parent: StrategyVersionRecord,
  latestVersion: number,
  changes: {
    parameters?: ParamSet;
    hypothesis?: string;
    rationale?: string;
    template?: string;
    mutations: readonly string[];
    createdBy?: StrategyVersionDefinition["createdBy"];
  },
  createdAt = new Date(),
): StrategyVersionRecord {
  if (changes.mutations.length === 0) throw new Error("A new version must describe at least one mutation");
  return createVersionRecord(
    {
      strategyId: parent.strategyId,
      version: latestVersion + 1,
      name: parent.name,
      market: parent.market,
      timeframe: parent.timeframe,
      template: changes.template ?? parent.template,
      family: parent.family,
      hypothesis: changes.hypothesis ?? parent.hypothesis,
      rationale: changes.rationale ?? parent.rationale,
      invalidation: parent.invalidation,
      expectedRegimes: parent.expectedRegimes,
      parameters: changes.parameters ?? parent.parameters,
      risk: parent.risk,
      createdBy: changes.createdBy ?? "claude",
      genome: { parent: parent.id, mutations: changes.mutations, generation: parent.genome.generation + 1 },
    },
    createdAt,
  );
}

export function verifyIntegrity(record: StrategyVersionRecord): void {
  const expected = definitionHash(record);
  if (expected !== record.contentHash) {
    throw new ImmutabilityViolation(`Strategy version ${record.id} was modified after creation`, {
      expected,
      actual: record.contentHash,
    });
  }
}

export interface StrategyStatusRecord {
  readonly versionId: string;
  readonly stage: StrategyStage;
  readonly liveEligible: boolean;
  readonly updatedAt: string;
}
