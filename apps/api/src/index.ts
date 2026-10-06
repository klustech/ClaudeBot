import { assertProtectedFilesIntact } from "@ct/core";
import { openDatabase, Repository } from "@ct/database";
import { ResearchService } from "@ct/research";
import { KillSwitch, loadRiskLimits } from "@ct/risk";
import { loadConfig } from "@ct/shared";
import { loadLockedPeriods, loadValidationThresholds } from "@ct/validation";
import { httpExecutorClient } from "./context";
import { BullJobRunner, InlineJobRunner, type JobRunner } from "./jobs";
import { researchJobHandler } from "./research-jobs";
import { buildApi } from "./server";

const cfg = loadConfig();
assertProtectedFilesIntact();
const h = await openDatabase();
const repo = new Repository(h.db);
const thresholds = loadValidationThresholds();
const research = new ResearchService(repo, {
  thresholds,
  periods: loadLockedPeriods(),
  stake: process.env.RESEARCH_STAKE ?? "10",
  initialCapital: process.env.RESEARCH_CAPITAL ?? "1000",
  seed: Number(process.env.RESEARCH_SEED ?? 42),
  maxConfigs: Number(process.env.RESEARCH_MAX_CONFIGS ?? 120),
  ...(process.env.INSTRUMENT ? { instrumentKey: process.env.INSTRUMENT } : {}),
});
const jobs: JobRunner = cfg.REDIS_URL ? await BullJobRunner.create(cfg.REDIS_URL) : new InlineJobRunner(researchJobHandler(repo, research));
const app = buildApi({
  cfg,
  repo,
  research,
  jobs,
  killSwitch: new KillSwitch(),
  limits: loadRiskLimits(),
  thresholds,
  executor: httpExecutorClient(process.env.EXECUTOR_URL ?? "http://127.0.0.1:4200", process.env.EXECUTOR_TOKEN),
  dbKind: h.kind,
});
await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
await repo.systemEvent({ source: "api", level: "info", kind: "system_restart", message: `API started (${h.kind}, jobs=${cfg.REDIS_URL ? "bullmq" : "inline"})` });

const shutdown = async (): Promise<void> => {
  await app.close();
  await h.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
