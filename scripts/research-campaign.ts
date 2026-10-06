/**
 * Runs a research campaign end-to-end against locally stored datasets.
 *
 *   pnpm research:campaign --markets SYNTHETHUSDT,SYNTHBTCUSDT --timeframe 15m [--templates a,b] [--name "..."]
 *
 * Never touches live trading. Real markets need `pnpm data:fetch` first.
 */
import { openDatabase, Repository } from "@ct/database";
import { ResearchService, runCampaign } from "@ct/research";
import { assertProtectedFilesIntact } from "@ct/core";
import type { Timeframe } from "@ct/shared";
import { loadLockedPeriods, loadValidationThresholds } from "@ct/validation";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    markets: { type: "string", default: "SYNTHETHUSDT,SYNTHBTCUSDT" },
    timeframe: { type: "string", default: "15m" },
    templates: { type: "string" },
    name: { type: "string", default: "Research Campaign" },
    objective: {
      type: "string",
      default: "Investigate whether short-horizon directional strategies can produce statistically significant positive expectancy after realistic costs.",
    },
    "max-configs": { type: "string", default: "60" },
    instrument: { type: "string" },
    seed: { type: "string", default: "42" },
  },
});

assertProtectedFilesIntact();
const h = await openDatabase();
const repo = new Repository(h.db);
const research = new ResearchService(repo, {
  thresholds: loadValidationThresholds(),
  periods: loadLockedPeriods(),
  stake: "10",
  initialCapital: "1000",
  seed: Number(values.seed),
  maxConfigs: Number(values["max-configs"]),
  ...(values.instrument ? { instrumentKey: values.instrument } : {}),
});
const t0 = Date.now();
const res = await runCampaign(repo, research, {
  name: values.name as string,
  objective: values.objective as string,
  markets: (values.markets as string).split(","),
  timeframe: values.timeframe as Timeframe,
  ...(values.templates ? { templates: values.templates.split(",") } : {}),
  actor: { actor: "system", model: "cli", sessionId: `cli-${process.pid}` },
  onProgress: (m) => console.log(m),
});
console.log(`\nCampaign ${res.campaignId}: ${res.hypothesesTested} hypotheses in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`Selected for PAPER incubation: ${res.selected.join(", ") || "none"}`);
console.log(`Report: ${res.reportPath}`);
await h.close();
