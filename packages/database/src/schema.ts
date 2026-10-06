import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 30, scale: 10 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const now = () => ts("created_at").notNull().default(sql`now()`);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  markets: jsonb("markets").$type<string[]>().notNull(),
  timeframe: text("timeframe").notNull(),
  status: text("status").notNull().default("running"),
  createdAt: now(),
  completedAt: ts("completed_at"),
});

export const strategies = pgTable("strategies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  timeframe: text("timeframe").notNull(),
  family: text("family").notNull(),
  createdBy: text("created_by").notNull(),
  latestVersion: integer("latest_version").notNull().default(1),
  createdAt: now(),
});

/**
 * Immutable strategy definitions. A database trigger rejects any UPDATE to
 * the definition columns; only lifecycle columns (stage, evidence, confidence,
 * frozen_at once) may change.
 */
export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    template: text("template").notNull(),
    family: text("family").notNull(),
    market: text("market").notNull(),
    timeframe: text("timeframe").notNull(),
    hypothesis: text("hypothesis").notNull(),
    rationale: text("rationale").notNull(),
    invalidation: text("invalidation").notNull(),
    expectedRegimes: jsonb("expected_regimes").$type<string[]>().notNull(),
    parameters: jsonb("parameters").$type<Record<string, string | number | boolean>>().notNull(),
    risk: jsonb("risk").$type<Record<string, unknown>>().notNull(),
    genomeParent: text("genome_parent"),
    mutations: jsonb("mutations").$type<string[]>().notNull(),
    generation: integer("generation").notNull(),
    contentHash: text("content_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: now(),
    frozenAt: ts("frozen_at"),
    // Mutable lifecycle columns
    stage: text("stage").notNull().default("IDEA"),
    liveEligible: boolean("live_eligible").notNull().default(false),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    confidence: real("confidence"),
    stageUpdatedAt: ts("stage_updated_at").notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("strategy_versions_strategy_version_idx").on(t.strategyId, t.version), index("strategy_versions_stage_idx").on(t.stage)],
);

export const parameterSets = pgTable(
  "parameter_sets",
  {
    id: text("id").primaryKey(),
    template: text("template").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    paramsHash: text("params_hash").notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex("parameter_sets_hash_idx").on(t.template, t.paramsHash)],
);

export const experiments = pgTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    number: bigserial("number", { mode: "number" }).notNull(),
    campaignId: text("campaign_id"),
    strategyVersionId: text("strategy_version_id"),
    template: text("template"),
    market: text("market"),
    timeframe: text("timeframe"),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("running"),
    hypothesis: text("hypothesis"),
    configurationsTested: integer("configurations_tested").notNull().default(0),
    datasetVersion: text("dataset_version"),
    codeHash: text("code_hash"),
    engineVersion: text("engine_version"),
    seed: integer("seed"),
    dateFrom: ts("date_from"),
    dateTo: ts("date_to"),
    params: jsonb("params").$type<Record<string, unknown>>(),
    feeModel: jsonb("fee_model").$type<Record<string, unknown>>(),
    resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
    verdict: text("verdict"),
    notes: text("notes"),
    source: text("source").notNull().default("local"),
    createdAt: now(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("experiments_campaign_idx").on(t.campaignId), index("experiments_version_idx").on(t.strategyVersionId)],
);

export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").references(() => experiments.id),
    strategyVersionId: text("strategy_version_id"),
    parameterSetId: text("parameter_set_id"),
    template: text("template").notNull(),
    market: text("market").notNull(),
    timeframe: text("timeframe").notNull(),
    partition: text("partition").notNull(),
    runHash: text("run_hash").notNull(),
    datasetVersion: text("dataset_version").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    netProfit: money("net_profit").notNull(),
    expectancy: money("expectancy").notNull(),
    tradeCount: integer("trade_count").notNull(),
    profitFactor: real("profit_factor").notNull(),
    sharpe: real("sharpe").notNull(),
    maxDrawdown: real("max_drawdown").notNull(),
    winRate: real("win_rate").notNull(),
    source: text("source").notNull().default("local"),
    createdAt: now(),
  },
  (t) => [index("backtest_runs_experiment_idx").on(t.experimentId), index("backtest_runs_version_idx").on(t.strategyVersionId)],
);

export const validationRuns = pgTable("validation_runs", {
  id: text("id").primaryKey(),
  experimentId: text("experiment_id").references(() => experiments.id),
  strategyVersionId: text("strategy_version_id").notNull(),
  kind: text("kind").notNull().default("validation"),
  passed: boolean("passed").notNull(),
  checks: jsonb("checks").$type<{ name: string; passed: boolean; detail: string }[]>().notNull(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  scoreCard: jsonb("score_card").$type<Record<string, unknown>>(),
  confidence: real("confidence"),
  trials: integer("trials").notNull().default(0),
  createdAt: now(),
});

export const paperSessions = pgTable("paper_sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("running"),
  startingBalance: money("starting_balance").notNull(),
  currency: text("currency").notNull(),
  strategyVersionIds: jsonb("strategy_version_ids").$type<string[]>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  startedAt: ts("started_at").notNull().default(sql`now()`),
  endedAt: ts("ended_at"),
});

export const liveSessions = pgTable("live_sessions", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  venue: text("venue").notNull(),
  status: text("status").notNull().default("running"),
  capitalStage: integer("capital_stage").notNull().default(0),
  strategyVersionIds: jsonb("strategy_version_ids").$type<string[]>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  startedAt: ts("started_at").notNull().default(sql`now()`),
  endedAt: ts("ended_at"),
});

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    sessionId: text("session_id"),
    sessionKind: text("session_kind").notNull(),
    strategyVersionId: text("strategy_version_id").notNull(),
    venue: text("venue").notNull(),
    venueOrderId: text("venue_order_id"),
    market: text("market").notNull(),
    direction: text("direction").notNull(),
    requestedStake: money("requested_stake").notNull(),
    filledStake: money("filled_stake"),
    fillPrice: numeric("fill_price", { precision: 30, scale: 10 }),
    fees: money("fees"),
    state: text("state").notNull(),
    reason: text("reason"),
    riskDecision: jsonb("risk_decision").$type<Record<string, unknown>>(),
    latency: jsonb("latency").$type<Record<string, unknown>>(),
    requestedBy: text("requested_by").notNull(),
    createdAt: now(),
    updatedAt: ts("updated_at").notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("orders_idempotency_idx").on(t.idempotencyKey), index("orders_session_idx").on(t.sessionId)],
);

export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  sessionKind: text("session_kind").notNull(),
  orderId: text("order_id").notNull(),
  strategyVersionId: text("strategy_version_id").notNull(),
  market: text("market").notNull(),
  direction: text("direction").notNull(),
  stake: money("stake").notNull(),
  entryPrice: numeric("entry_price", { precision: 30, scale: 10 }).notNull(),
  openedAt: ts("opened_at").notNull(),
  expiresAt: ts("expires_at"),
  status: text("status").notNull().default("open"),
  closedAt: ts("closed_at"),
  exitPrice: numeric("exit_price", { precision: 30, scale: 10 }),
  pnl: money("pnl"),
});

export const trades = pgTable(
  "trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionKind: text("session_kind").notNull(),
    backtestRunId: text("backtest_run_id"),
    sessionId: text("session_id"),
    orderId: text("order_id"),
    strategyVersionId: text("strategy_version_id"),
    market: text("market").notNull(),
    direction: text("direction").notNull(),
    entryTime: ts("entry_time").notNull(),
    exitTime: ts("exit_time").notNull(),
    entryPrice: numeric("entry_price", { precision: 30, scale: 10 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 30, scale: 10 }).notNull(),
    stake: money("stake").notNull(),
    fees: money("fees").notNull(),
    pnl: money("pnl").notNull(),
    returnOnStake: real("return_on_stake").notNull(),
    exitReason: text("exit_reason"),
    win: boolean("win").notNull(),
  },
  (t) => [index("trades_run_idx").on(t.backtestRunId), index("trades_session_idx").on(t.sessionId), index("trades_version_idx").on(t.strategyVersionId)],
);

export const equityPoints = pgTable(
  "equity_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    backtestRunId: text("backtest_run_id"),
    sessionId: text("session_id"),
    time: ts("time").notNull(),
    equity: money("equity").notNull(),
    drawdown: real("drawdown").notNull(),
  },
  (t) => [index("equity_run_idx").on(t.backtestRunId), index("equity_session_idx").on(t.sessionId)],
);

export const riskEvents = pgTable("risk_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().default(sql`now()`),
  kind: text("kind").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  strategyVersionId: text("strategy_version_id"),
  data: jsonb("data").$type<Record<string, unknown>>(),
});

export const systemEvents = pgTable("system_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().default(sql`now()`),
  source: text("source").notNull(),
  level: text("level").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
});

/** Append-only audit trail of every Claude/human/system decision. */
export const claudeDecisions = pgTable("claude_decisions", {
  id: text("id").primaryKey(),
  timestamp: ts("timestamp").notNull().default(sql`now()`),
  strategyId: text("strategy_id"),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  inputMetrics: jsonb("input_metrics").$type<Record<string, unknown>>().notNull(),
  outputDecision: text("output_decision").notNull(),
  model: text("model").notNull(),
  sessionId: text("session_id").notNull(),
  actor: text("actor").notNull().default("claude"),
});

export const alerts = pgTable("alerts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().default(sql`now()`),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
});

export const researchJournal = pgTable("research_journal", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().default(sql`now()`),
  campaignId: text("campaign_id"),
  experimentId: text("experiment_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
});
