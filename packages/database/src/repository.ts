import type { DecisionRecord, StrategyVersionRecord } from "@ct/core";
import { hashObject, newId, type StrategyStage } from "@ct/shared";
import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";

export type StrategyVersionRow = typeof s.strategyVersions.$inferSelect;
export type ExperimentRow = typeof s.experiments.$inferSelect;
export type BacktestRunRow = typeof s.backtestRuns.$inferSelect;
export type OrderRow = typeof s.orders.$inferSelect;
export type TradeRow = typeof s.trades.$inferSelect;

export interface TradeInsert {
  sessionKind: "backtest" | "paper" | "testnet" | "live";
  backtestRunId?: string | null;
  sessionId?: string | null;
  orderId?: string | null;
  strategyVersionId?: string | null;
  market: string;
  direction: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stake: string;
  fees: string;
  pnl: string;
  returnOnStake: number;
  exitReason?: string | null;
  win: boolean;
}

export interface ResearchStats {
  strategies: number;
  strategyVersions: number;
  experiments: number;
  parameterConfigurations: number;
  byStage: Record<string, number>;
}

const d = (ms: number | null | undefined): Date | null => (ms === null || ms === undefined ? null : new Date(ms));

/** Typed data-access layer used by every app. Append-only tables are enforced by DB triggers. */
export class Repository {
  constructor(readonly db: Db) {}

  // ---------------------------------------------------------------- campaigns
  async createCampaign(c: { id?: string; name: string; objective: string; markets: string[]; timeframe: string }): Promise<string> {
    const id = c.id ?? `CAMPAIGN-${newId().slice(0, 8).toUpperCase()}`;
    await this.db.insert(s.campaigns).values({ id, name: c.name, objective: c.objective, markets: c.markets, timeframe: c.timeframe });
    return id;
  }

  async completeCampaign(id: string, status = "completed"): Promise<void> {
    await this.db.update(s.campaigns).set({ status, completedAt: new Date() }).where(eq(s.campaigns.id, id));
  }

  listCampaigns() {
    return this.db.select().from(s.campaigns).orderBy(desc(s.campaigns.createdAt));
  }

  // --------------------------------------------------------------- strategies
  async nextStrategySequence(prefix: string): Promise<number> {
    const rows = await this.db
      .select({ id: s.strategies.id })
      .from(s.strategies)
      .where(sql`${s.strategies.id} LIKE ${`${prefix}-%`}`);
    let max = 0;
    for (const r of rows) {
      const m = r.id.match(/-(\d{3,})$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  async insertStrategyVersion(rec: StrategyVersionRecord, stage: StrategyStage = "IDEA"): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx.select().from(s.strategies).where(eq(s.strategies.id, rec.strategyId));
      if (existing.length === 0) {
        await tx.insert(s.strategies).values({
          id: rec.strategyId,
          name: rec.name,
          market: rec.market,
          timeframe: rec.timeframe,
          family: rec.family,
          createdBy: rec.createdBy,
          latestVersion: rec.version,
        });
      } else {
        await tx
          .update(s.strategies)
          .set({ latestVersion: sql`GREATEST(${s.strategies.latestVersion}, ${rec.version})` })
          .where(eq(s.strategies.id, rec.strategyId));
      }
      await tx.insert(s.strategyVersions).values({
        id: rec.id,
        strategyId: rec.strategyId,
        version: rec.version,
        name: rec.name,
        template: rec.template,
        family: rec.family,
        market: rec.market,
        timeframe: rec.timeframe,
        hypothesis: rec.hypothesis,
        rationale: rec.rationale,
        invalidation: rec.invalidation,
        expectedRegimes: [...rec.expectedRegimes],
        parameters: { ...rec.parameters },
        risk: { ...rec.risk },
        genomeParent: rec.genome.parent,
        mutations: [...rec.genome.mutations],
        generation: rec.genome.generation,
        contentHash: rec.contentHash,
        createdBy: rec.createdBy,
        createdAt: new Date(rec.createdAt),
        stage,
      });
    });
  }

  async getVersion(id: string): Promise<StrategyVersionRow | null> {
    const rows = await this.db.select().from(s.strategyVersions).where(eq(s.strategyVersions.id, id));
    return rows[0] ?? null;
  }

  async latestVersionNumber(strategyId: string): Promise<number> {
    const rows = await this.db
      .select({ v: sql<number>`COALESCE(MAX(${s.strategyVersions.version}), 0)` })
      .from(s.strategyVersions)
      .where(eq(s.strategyVersions.strategyId, strategyId));
    return Number(rows[0]?.v ?? 0);
  }

  listVersions(filter: { stage?: StrategyStage | StrategyStage[]; market?: string; strategyId?: string; limit?: number } = {}) {
    const conds = [];
    if (filter.stage) conds.push(Array.isArray(filter.stage) ? inArray(s.strategyVersions.stage, filter.stage) : eq(s.strategyVersions.stage, filter.stage));
    if (filter.market) conds.push(eq(s.strategyVersions.market, filter.market));
    if (filter.strategyId) conds.push(eq(s.strategyVersions.strategyId, filter.strategyId));
    return this.db
      .select()
      .from(s.strategyVersions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.strategyVersions.confidence), desc(s.strategyVersions.createdAt))
      .limit(filter.limit ?? 500);
  }

  /** Updates lifecycle columns only (the DB trigger rejects anything else). */
  async updateLifecycle(
    id: string,
    patch: { stage?: StrategyStage; evidence?: Record<string, unknown>; confidence?: number | null; liveEligible?: boolean },
  ): Promise<void> {
    const current = await this.getVersion(id);
    if (!current) throw new Error(`Unknown strategy version ${id}`);
    await this.db
      .update(s.strategyVersions)
      .set({
        ...(patch.stage ? { stage: patch.stage, stageUpdatedAt: new Date() } : {}),
        ...(patch.evidence ? { evidence: { ...current.evidence, ...patch.evidence } } : {}),
        ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
        ...(patch.liveEligible !== undefined ? { liveEligible: patch.liveEligible } : {}),
      })
      .where(eq(s.strategyVersions.id, id));
  }

  async freezeVersion(id: string): Promise<Date> {
    const current = await this.getVersion(id);
    if (!current) throw new Error(`Unknown strategy version ${id}`);
    if (current.frozenAt) return current.frozenAt;
    const at = new Date();
    await this.db.update(s.strategyVersions).set({ frozenAt: at }).where(eq(s.strategyVersions.id, id));
    return at;
  }

  // ---------------------------------------------------------- parameter sets
  async upsertParameterSet(template: string, params: Record<string, unknown>): Promise<string> {
    const paramsHash = hashObject(params);
    const existing = await this.db
      .select({ id: s.parameterSets.id })
      .from(s.parameterSets)
      .where(and(eq(s.parameterSets.template, template), eq(s.parameterSets.paramsHash, paramsHash)));
    if (existing[0]) return existing[0].id;
    const id = `ps_${paramsHash.slice(0, 20)}`;
    await this.db.insert(s.parameterSets).values({ id, template, params, paramsHash }).onConflictDoNothing();
    return id;
  }

  // -------------------------------------------------------------- experiments
  async createExperiment(e: {
    kind: string;
    campaignId?: string | null;
    strategyVersionId?: string | null;
    template?: string | null;
    market?: string | null;
    timeframe?: string | null;
    hypothesis?: string | null;
    datasetVersion?: string | null;
    codeHash?: string | null;
    engineVersion?: string | null;
    seed?: number | null;
    dateFrom?: number | null;
    dateTo?: number | null;
    params?: Record<string, unknown> | null;
    feeModel?: Record<string, unknown> | null;
    source?: string;
  }): Promise<{ id: string; number: number }> {
    const id = newId();
    const rows = await this.db
      .insert(s.experiments)
      .values({
        id,
        kind: e.kind,
        campaignId: e.campaignId ?? null,
        strategyVersionId: e.strategyVersionId ?? null,
        template: e.template ?? null,
        market: e.market ?? null,
        timeframe: e.timeframe ?? null,
        hypothesis: e.hypothesis ?? null,
        datasetVersion: e.datasetVersion ?? null,
        codeHash: e.codeHash ?? null,
        engineVersion: e.engineVersion ?? null,
        seed: e.seed ?? null,
        dateFrom: d(e.dateFrom),
        dateTo: d(e.dateTo),
        params: e.params ?? null,
        feeModel: e.feeModel ?? null,
        source: e.source ?? "local",
      })
      .returning({ number: s.experiments.number });
    return { id, number: Number(rows[0]?.number ?? 0) };
  }

  async completeExperiment(
    id: string,
    r: { status: "completed" | "failed" | "rejected" | "passed"; verdict?: string; resultSummary?: Record<string, unknown>; configurationsTested?: number; notes?: string },
  ): Promise<void> {
    await this.db
      .update(s.experiments)
      .set({
        status: r.status,
        verdict: r.verdict ?? null,
        resultSummary: r.resultSummary ?? null,
        ...(r.configurationsTested !== undefined ? { configurationsTested: r.configurationsTested } : {}),
        notes: r.notes ?? null,
        completedAt: new Date(),
      })
      .where(eq(s.experiments.id, id));
  }

  listExperiments(filter: { campaignId?: string; strategyVersionId?: string; limit?: number } = {}) {
    const conds = [];
    if (filter.campaignId) conds.push(eq(s.experiments.campaignId, filter.campaignId));
    if (filter.strategyVersionId) conds.push(eq(s.experiments.strategyVersionId, filter.strategyVersionId));
    return this.db
      .select()
      .from(s.experiments)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.experiments.number))
      .limit(filter.limit ?? 200);
  }

  /** Total configurations tested programme-wide — the multiple-testing trial count. */
  async totalTrials(): Promise<number> {
    const rows = await this.db.select({ n: sum(s.experiments.configurationsTested) }).from(s.experiments);
    return Number(rows[0]?.n ?? 0);
  }

  // ------------------------------------------------------------ backtest runs
  async insertBacktestRun(run: {
    experimentId?: string | null;
    strategyVersionId?: string | null;
    template: string;
    market: string;
    timeframe: string;
    partition: string;
    manifest: { runHash: string; datasetVersion: string; parameters: Record<string, unknown> } & Record<string, unknown>;
    metrics: {
      netProfit: string;
      expectancy: string;
      tradeCount: number;
      profitFactor: number;
      sharpe: number;
      maxDrawdown: number;
      winRate: number;
    } & Record<string, unknown>;
    source?: string;
    trades?: Omit<TradeInsert, "backtestRunId" | "sessionKind">[];
    equity?: { time: number; equity: number; drawdown: number }[];
  }): Promise<string> {
    const id = newId();
    const parameterSetId = await this.upsertParameterSet(run.template, run.manifest.parameters);
    await this.db.transaction(async (tx) => {
      await tx.insert(s.backtestRuns).values({
        id,
        experimentId: run.experimentId ?? null,
        strategyVersionId: run.strategyVersionId ?? null,
        parameterSetId,
        template: run.template,
        market: run.market,
        timeframe: run.timeframe,
        partition: run.partition,
        runHash: run.manifest.runHash,
        datasetVersion: run.manifest.datasetVersion,
        manifest: run.manifest,
        metrics: run.metrics,
        netProfit: run.metrics.netProfit,
        expectancy: run.metrics.expectancy,
        tradeCount: run.metrics.tradeCount,
        profitFactor: Math.min(run.metrics.profitFactor, 1e6),
        sharpe: run.metrics.sharpe,
        maxDrawdown: run.metrics.maxDrawdown,
        winRate: run.metrics.winRate,
        source: run.source ?? "local",
      });
      if (run.trades?.length) {
        for (let i = 0; i < run.trades.length; i += 500) {
          await tx.insert(s.trades).values(
            run.trades.slice(i, i + 500).map((t) => toTradeValues({ ...t, sessionKind: "backtest", backtestRunId: id })),
          );
        }
      }
      if (run.equity?.length) {
        for (let i = 0; i < run.equity.length; i += 1000) {
          await tx.insert(s.equityPoints).values(
            run.equity.slice(i, i + 1000).map((p) => ({ backtestRunId: id, time: new Date(p.time), equity: p.equity.toFixed(8), drawdown: p.drawdown })),
          );
        }
      }
    });
    return id;
  }

  listBacktestRuns(filter: { strategyVersionId?: string; experimentId?: string; limit?: number } = {}) {
    const conds = [];
    if (filter.strategyVersionId) conds.push(eq(s.backtestRuns.strategyVersionId, filter.strategyVersionId));
    if (filter.experimentId) conds.push(eq(s.backtestRuns.experimentId, filter.experimentId));
    return this.db
      .select()
      .from(s.backtestRuns)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.backtestRuns.createdAt))
      .limit(filter.limit ?? 200);
  }

  async getBacktestRun(id: string) {
    const rows = await this.db.select().from(s.backtestRuns).where(eq(s.backtestRuns.id, id));
    return rows[0] ?? null;
  }

  equityForRun(backtestRunId: string) {
    return this.db.select().from(s.equityPoints).where(eq(s.equityPoints.backtestRunId, backtestRunId)).orderBy(s.equityPoints.time);
  }

  tradesForRun(backtestRunId: string, limit = 5000) {
    return this.db.select().from(s.trades).where(eq(s.trades.backtestRunId, backtestRunId)).orderBy(s.trades.entryTime).limit(limit);
  }

  // ---------------------------------------------------------- validation runs
  async insertValidationRun(v: {
    experimentId?: string | null;
    strategyVersionId: string;
    kind?: string;
    passed: boolean;
    checks: { name: string; passed: boolean; detail: string }[];
    report: Record<string, unknown>;
    scoreCard?: Record<string, unknown> | null;
    confidence?: number | null;
    trials: number;
  }): Promise<string> {
    const id = newId();
    await this.db.insert(s.validationRuns).values({
      id,
      experimentId: v.experimentId ?? null,
      strategyVersionId: v.strategyVersionId,
      kind: v.kind ?? "validation",
      passed: v.passed,
      checks: v.checks,
      report: v.report,
      scoreCard: v.scoreCard ?? null,
      confidence: v.confidence ?? null,
      trials: v.trials,
    });
    return id;
  }

  listValidationRuns(strategyVersionId?: string, limit = 100) {
    return this.db
      .select()
      .from(s.validationRuns)
      .where(strategyVersionId ? eq(s.validationRuns.strategyVersionId, strategyVersionId) : undefined)
      .orderBy(desc(s.validationRuns.createdAt))
      .limit(limit);
  }

  // ---------------------------------------------------------------- decisions
  async recordDecision(dec: Omit<DecisionRecord, "id" | "timestamp"> & { id?: string; timestamp?: string }): Promise<string> {
    const id = dec.id ?? newId();
    await this.db.insert(s.claudeDecisions).values({
      id,
      timestamp: dec.timestamp ? new Date(dec.timestamp) : new Date(),
      strategyId: dec.strategyId,
      action: dec.action,
      reason: dec.reason,
      evidence: dec.evidence,
      inputMetrics: dec.inputMetrics,
      outputDecision: dec.outputDecision,
      model: dec.model,
      sessionId: dec.sessionId,
      actor: dec.actor,
    });
    return id;
  }

  listDecisions(filter: { strategyId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(s.claudeDecisions)
      .where(filter.strategyId ? eq(s.claudeDecisions.strategyId, filter.strategyId) : undefined)
      .orderBy(desc(s.claudeDecisions.timestamp))
      .limit(filter.limit ?? 200);
  }

  // ------------------------------------------------------------------- events
  async riskEvent(e: { kind: string; code: string; message: string; strategyVersionId?: string | null; data?: Record<string, unknown> }): Promise<void> {
    await this.db.insert(s.riskEvents).values({ kind: e.kind, code: e.code, message: e.message, strategyVersionId: e.strategyVersionId ?? null, data: e.data ?? null });
  }

  listRiskEvents(limit = 200) {
    return this.db.select().from(s.riskEvents).orderBy(desc(s.riskEvents.at)).limit(limit);
  }

  async systemEvent(e: { source: string; level: "info" | "warning" | "error" | "critical"; kind: string; message: string; data?: Record<string, unknown> }): Promise<void> {
    await this.db.insert(s.systemEvents).values({ ...e, data: e.data ?? null });
  }

  listSystemEvents(limit = 200) {
    return this.db.select().from(s.systemEvents).orderBy(desc(s.systemEvents.at)).limit(limit);
  }

  async insertAlert(a: { type: string; severity: string; message: string; data?: Record<string, unknown> }): Promise<void> {
    await this.db.insert(s.alerts).values({ ...a, data: a.data ?? null });
  }

  listAlerts(limit = 100) {
    return this.db.select().from(s.alerts).orderBy(desc(s.alerts.at)).limit(limit);
  }

  // ------------------------------------------------------------------ journal
  async addJournal(j: { title: string; body: string; campaignId?: string | null; experimentId?: string | null }): Promise<void> {
    await this.db.insert(s.researchJournal).values({ title: j.title, body: j.body, campaignId: j.campaignId ?? null, experimentId: j.experimentId ?? null });
  }

  listJournal(limit = 100) {
    return this.db.select().from(s.researchJournal).orderBy(desc(s.researchJournal.at)).limit(limit);
  }

  // ------------------------------------------------------- paper/live trading
  async createPaperSession(p: { name: string; startingBalance: string; currency: string; strategyVersionIds: string[]; config: Record<string, unknown> }): Promise<string> {
    const id = `PAPER-${newId().slice(0, 8).toUpperCase()}`;
    await this.db.insert(s.paperSessions).values({ id, ...p });
    return id;
  }

  async endPaperSession(id: string, status = "stopped"): Promise<void> {
    await this.db.update(s.paperSessions).set({ status, endedAt: new Date() }).where(eq(s.paperSessions.id, id));
  }

  listPaperSessions(limit = 50) {
    return this.db.select().from(s.paperSessions).orderBy(desc(s.paperSessions.startedAt)).limit(limit);
  }

  async getPaperSession(id: string) {
    const rows = await this.db.select().from(s.paperSessions).where(eq(s.paperSessions.id, id));
    return rows[0] ?? null;
  }

  async createLiveSession(p: { mode: string; venue: string; capitalStage: number; strategyVersionIds: string[]; config: Record<string, unknown> }): Promise<string> {
    const id = `${p.mode}-${newId().slice(0, 8).toUpperCase()}`;
    await this.db.insert(s.liveSessions).values({ id, ...p });
    return id;
  }

  listLiveSessions(limit = 50) {
    return this.db.select().from(s.liveSessions).orderBy(desc(s.liveSessions.startedAt)).limit(limit);
  }

  async insertOrder(o: typeof s.orders.$inferInsert): Promise<void> {
    await this.db.insert(s.orders).values(o);
  }

  async orderExists(idempotencyKey: string): Promise<boolean> {
    const rows = await this.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.idempotencyKey, idempotencyKey));
    return rows.length > 0;
  }

  async updateOrder(id: string, patch: Partial<typeof s.orders.$inferInsert>): Promise<void> {
    await this.db.update(s.orders).set({ ...patch, updatedAt: new Date() }).where(eq(s.orders.id, id));
  }

  listOrders(filter: { sessionId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(s.orders)
      .where(filter.sessionId ? eq(s.orders.sessionId, filter.sessionId) : undefined)
      .orderBy(desc(s.orders.createdAt))
      .limit(filter.limit ?? 200);
  }

  async insertPosition(p: typeof s.positions.$inferInsert): Promise<void> {
    await this.db.insert(s.positions).values(p);
  }

  async closePosition(orderId: string, p: { exitPrice: number; pnl: string; closedAt: Date; status?: string }): Promise<void> {
    await this.db
      .update(s.positions)
      .set({ status: p.status ?? "closed", exitPrice: String(p.exitPrice), pnl: p.pnl, closedAt: p.closedAt })
      .where(eq(s.positions.orderId, orderId));
  }

  listPositions(filter: { sessionId?: string; status?: string } = {}) {
    const conds = [];
    if (filter.sessionId) conds.push(eq(s.positions.sessionId, filter.sessionId));
    if (filter.status) conds.push(eq(s.positions.status, filter.status));
    return this.db
      .select()
      .from(s.positions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.positions.openedAt))
      .limit(500);
  }

  async insertTrade(t: TradeInsert): Promise<void> {
    await this.db.insert(s.trades).values(toTradeValues(t));
  }

  listTrades(filter: { sessionId?: string; strategyVersionId?: string; sessionKind?: string; limit?: number } = {}) {
    const conds = [];
    if (filter.sessionId) conds.push(eq(s.trades.sessionId, filter.sessionId));
    if (filter.strategyVersionId) conds.push(eq(s.trades.strategyVersionId, filter.strategyVersionId));
    if (filter.sessionKind) conds.push(eq(s.trades.sessionKind, filter.sessionKind));
    return this.db
      .select()
      .from(s.trades)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.trades.exitTime))
      .limit(filter.limit ?? 500);
  }

  async insertEquityPoint(p: { sessionId: string; time: number; equity: string; drawdown: number }): Promise<void> {
    await this.db.insert(s.equityPoints).values({ sessionId: p.sessionId, time: new Date(p.time), equity: p.equity, drawdown: p.drawdown });
  }

  equityForSession(sessionId: string) {
    return this.db.select().from(s.equityPoints).where(eq(s.equityPoints.sessionId, sessionId)).orderBy(s.equityPoints.time);
  }

  // -------------------------------------------------------------------- stats
  async researchStats(): Promise<ResearchStats> {
    const [strats] = await this.db.select({ n: count() }).from(s.strategies);
    const [versions] = await this.db.select({ n: count() }).from(s.strategyVersions);
    const [exps] = await this.db.select({ n: count(), configs: sum(s.experiments.configurationsTested) }).from(s.experiments);
    const stages = await this.db.select({ stage: s.strategyVersions.stage, n: count() }).from(s.strategyVersions).groupBy(s.strategyVersions.stage);
    return {
      strategies: Number(strats?.n ?? 0),
      strategyVersions: Number(versions?.n ?? 0),
      experiments: Number(exps?.n ?? 0),
      parameterConfigurations: Number(exps?.configs ?? 0),
      byStage: Object.fromEntries(stages.map((r) => [r.stage, Number(r.n)])),
    };
  }
}

function toTradeValues(t: TradeInsert): typeof s.trades.$inferInsert {
  return {
    sessionKind: t.sessionKind,
    backtestRunId: t.backtestRunId ?? null,
    sessionId: t.sessionId ?? null,
    orderId: t.orderId ?? null,
    strategyVersionId: t.strategyVersionId ?? null,
    market: t.market,
    direction: t.direction,
    entryTime: new Date(t.entryTime),
    exitTime: new Date(t.exitTime),
    entryPrice: String(t.entryPrice),
    exitPrice: String(t.exitPrice),
    stake: t.stake,
    fees: t.fees,
    pnl: t.pnl,
    returnOnStake: t.returnOnStake,
    exitReason: t.exitReason ?? null,
    win: t.win,
  };
}
