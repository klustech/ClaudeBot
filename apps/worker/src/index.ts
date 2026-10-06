/**
 * Research worker: consumes the BullMQ "research" queue (campaigns,
 * backtests, optimisation, validation, reports) and runs scheduled
 * daily/weekly reports. Never places trades.
 *
 * Without REDIS_URL, run `--schedule-only` for report scheduling, or let the
 * API run jobs inline.
 */
import { assertProtectedFilesIntact } from "@ct/core";
import { openDatabase, Repository } from "@ct/database";
import { generateDailyReport, generateWeeklyReview, ResearchService } from "@ct/research";
import { loadConfig } from "@ct/shared";
import { createLogger } from "@ct/telemetry";
import { loadLockedPeriods, loadValidationThresholds } from "@ct/validation";
import { RESEARCH_QUEUE, type JobKind } from "@ct/api/jobs";
import { researchJobHandler } from "@ct/api/research-jobs";

const log = createLogger("worker");
const cfg = loadConfig();
assertProtectedFilesIntact();
const h = await openDatabase();
const repo = new Repository(h.db);
const research = new ResearchService(repo, {
  thresholds: loadValidationThresholds(),
  periods: loadLockedPeriods(),
  stake: process.env.RESEARCH_STAKE ?? "10",
  initialCapital: process.env.RESEARCH_CAPITAL ?? "1000",
  seed: Number(process.env.RESEARCH_SEED ?? 42),
  maxConfigs: Number(process.env.RESEARCH_MAX_CONFIGS ?? 120),
  ...(process.env.INSTRUMENT ? { instrumentKey: process.env.INSTRUMENT } : {}),
});
const handler = researchJobHandler(repo, research);

if (cfg.REDIS_URL && !process.argv.includes("--schedule-only")) {
  const { Worker } = await import("bullmq");
  const { Redis } = await import("ioredis");
  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker(
    RESEARCH_QUEUE,
    async (job) => {
      const progress: string[] = [];
      return handler(job.name as JobKind, job.data as Record<string, unknown>, (m) => {
        progress.push(m);
        void job.updateProgress(progress.slice(-200));
      });
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1) },
  );
  worker.on("failed", (job, err) => log.error({ job: job?.id, err: err.message }, "job failed"));
  worker.on("completed", (job) => log.info({ job: job.id, name: job.name }, "job completed"));
  log.info("research worker consuming queue");
}

// Report scheduler (UTC): daily at 23:55, weekly review Sundays 23:58.
let lastDaily = "";
let lastWeekly = "";
setInterval(async () => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  try {
    if (hm >= 23 * 60 + 55 && lastDaily !== day) {
      lastDaily = day;
      const r = await generateDailyReport(repo);
      log.info({ path: r.path }, "daily report written");
    }
    if (now.getUTCDay() === 0 && hm >= 23 * 60 + 58 && lastWeekly !== day) {
      lastWeekly = day;
      const r = await generateWeeklyReview(repo);
      log.info({ path: r.path, degraded: r.degraded }, "weekly review written");
    }
  } catch (err) {
    log.error({ err }, "scheduled report failed");
  }
}, 30_000);
log.info("report scheduler running");
