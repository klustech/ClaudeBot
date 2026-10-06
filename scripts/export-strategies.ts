/**
 * Exports every strategy version to strategies/<stage>/<id>.json so the
 * lifecycle is visible in the repository (the database remains the source
 * of truth). Files for a version move between folders as its stage changes.
 *   pnpm strategies:export
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, Repository } from "@ct/database";
import { repoRoot } from "@ct/shared";

const FOLDER: Record<string, string> = {
  IDEA: "research",
  RESEARCH: "research",
  BACKTESTED: "research",
  VALIDATING: "research",
  INCUBATING: "incubating",
  PAPER: "paper",
  APPROVED: "approved",
  LIVE: "live",
  DEGRADED: "paper",
  RETIRED: "retired",
};

const h = await openDatabase();
const repo = new Repository(h.db);
const root = join(repoRoot(), "strategies");
for (const dir of new Set(Object.values(FOLDER))) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const f of readdirSync(join(root, dir))) if (f.endsWith(".json")) rmSync(join(root, dir, f));
}
const versions = await repo.listVersions({ limit: 100_000 });
for (const v of versions) {
  const record = {
    id: v.id,
    strategyId: v.strategyId,
    name: v.name,
    market: v.market,
    timeframe: v.timeframe,
    version: v.version,
    status: v.stage.toLowerCase(),
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
    hypothesis: v.hypothesis,
    rationale: v.rationale,
    invalidation: v.invalidation,
    template: v.template,
    parameters: v.parameters,
    risk: v.risk,
    genome: { parent: v.genomeParent, mutations: v.mutations, generation: v.generation },
    contentHash: v.contentHash,
    frozenAt: v.frozenAt?.toISOString() ?? null,
    confidence: v.confidence,
    validation: v.evidence,
  };
  writeFileSync(join(root, FOLDER[v.stage] ?? "research", `${v.id}.json`), JSON.stringify(record, null, 2) + "\n");
}
console.log(`Exported ${versions.length} strategy versions to strategies/`);
await h.close();
