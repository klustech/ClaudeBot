import type { Repository } from "@ct/database";
import { hashObject } from "@ct/shared";
import { z } from "zod";

/**
 * Normalised import format for results produced through the Trader.dev MCP.
 *
 * We deliberately do NOT hard-code Trader.dev tool names or response schemas.
 * Claude inspects the live MCP tool list/outputs, then maps a backtest result
 * into this documented format and calls `import_trader_dev_backtest` on the
 * local trading-control MCP (or POST /api/research/import/trader-dev).
 */
export const TraderDevImportSchema = z.object({
  strategyVersionId: z.string().nullable().default(null),
  externalStrategyId: z.string(),
  externalBacktestId: z.string(),
  market: z.string(),
  timeframe: z.string(),
  template: z.string().default("trader-dev"),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  period: z.object({ from: z.string(), to: z.string() }),
  partition: z.enum(["train", "validation"]).default("train"),
  feeModel: z.record(z.string(), z.unknown()).default({}),
  metrics: z.object({
    netProfit: z.union([z.string(), z.number()]).transform(String),
    tradeCount: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1),
    profitFactor: z.number().nonnegative(),
    sharpe: z.number().default(0),
    maxDrawdown: z.number().min(0).max(1),
    expectancy: z.union([z.string(), z.number()]).transform(String).optional(),
  }),
  trades: z
    .array(
      z.object({
        entryTime: z.string(),
        exitTime: z.string(),
        direction: z.enum(["UP", "DOWN", "LONG", "SHORT"]),
        entryPrice: z.number(),
        exitPrice: z.number(),
        stake: z.union([z.string(), z.number()]).transform(String),
        pnl: z.union([z.string(), z.number()]).transform(String),
        fees: z.union([z.string(), z.number()]).transform(String).default("0"),
      }),
    )
    .default([]),
  equity: z.array(z.object({ time: z.string(), equity: z.number() })).default([]),
  rawToolName: z.string().optional(),
});

export type TraderDevImport = z.input<typeof TraderDevImportSchema>;

export async function importTraderDevBacktest(repo: Repository, input: TraderDevImport, campaignId: string | null = null) {
  const r = TraderDevImportSchema.parse(input);
  const exp = await repo.createExperiment({
    kind: "trader_dev_backtest",
    campaignId,
    strategyVersionId: r.strategyVersionId,
    template: r.template,
    market: r.market,
    timeframe: r.timeframe,
    dateFrom: Date.parse(r.period.from),
    dateTo: Date.parse(r.period.to),
    params: r.parameters,
    feeModel: r.feeModel,
    source: "trader-dev",
  });
  let peak = -Infinity;
  const equity = r.equity.map((p) => {
    peak = Math.max(peak, p.equity);
    return { time: Date.parse(p.time), equity: p.equity, drawdown: peak > 0 ? (peak - p.equity) / peak : 0 };
  });
  const expectancy = r.metrics.expectancy ?? (r.metrics.tradeCount ? String(Number(r.metrics.netProfit) / r.metrics.tradeCount) : "0");
  const runId = await repo.insertBacktestRun({
    experimentId: exp.id,
    strategyVersionId: r.strategyVersionId,
    template: r.template,
    market: r.market,
    timeframe: r.timeframe,
    partition: r.partition,
    source: "trader-dev",
    manifest: {
      runHash: hashObject({ ext: r.externalBacktestId, params: r.parameters, period: r.period }),
      datasetVersion: `trader-dev:${r.market}:${r.timeframe}:${r.period.from}:${r.period.to}`,
      parameters: r.parameters,
      externalStrategyId: r.externalStrategyId,
      externalBacktestId: r.externalBacktestId,
      rawToolName: r.rawToolName ?? null,
    },
    metrics: { ...r.metrics, expectancy },
    trades: r.trades.map((t) => {
      const stake = Number(t.stake);
      const pnl = Number(t.pnl);
      return {
        market: r.market,
        direction: t.direction === "LONG" ? "UP" : t.direction === "SHORT" ? "DOWN" : t.direction,
        entryTime: Date.parse(t.entryTime),
        exitTime: Date.parse(t.exitTime),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        stake: t.stake,
        fees: t.fees,
        pnl: t.pnl,
        returnOnStake: stake ? pnl / stake : 0,
        exitReason: null,
        win: pnl > 0,
      };
    }),
    equity,
  });
  await repo.completeExperiment(exp.id, { status: "completed", configurationsTested: 1, resultSummary: { ...r.metrics } });
  return { experimentId: exp.id, experimentNumber: exp.number, backtestRunId: runId };
}
