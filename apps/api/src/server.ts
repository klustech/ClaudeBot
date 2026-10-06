import cors from "@fastify/cors";
import { checkProtectedFiles, type PromotionEvidence } from "@ct/core";
import { evaluatePaper, importTraderDevBacktest, writeJournal } from "@ct/research";
import { listTemplates, RESEARCH_TEMPLATES } from "@ct/strategies";
import { STRATEGY_STAGES, TIMEFRAMES, type StrategyStage } from "@ct/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireHuman, resolveActor } from "./auth";
import type { ApiContext } from "./context";

const stageEnum = z.enum(STRATEGY_STAGES);

export function buildApi(ctx: ApiContext): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 20 * 1024 * 1024 });
  const tokens = { control: ctx.cfg.CONTROL_API_TOKEN, human: process.env.HUMAN_API_TOKEN };
  void app.register(cors, { origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/] });

  app.setErrorHandler((err, _req, reply) => {
    if ((err as Error).name === "ZodError") {
      return void reply.code(400).send({ error: "invalid request", issues: (err as unknown as { issues: unknown }).issues });
    }
    const code = (err as { code?: string }).code;
    const status = code === "LIFECYCLE_VIOLATION" || code === "LOCKED_PERIOD_VIOLATION" || code === "SAFETY_VIOLATION" ? 409 : ((err as { statusCode?: number }).statusCode ?? 500);
    void reply.code(status).send({ error: (err as Error).message, code: code ?? null });
  });

  // ---------------------------------------------------------------- health
  app.get("/api/health", async () => ({ ok: true, db: ctx.dbKind, time: new Date().toISOString() }));

  app.get("/api/system", async () => {
    const exec = await ctx.executor.call<Record<string, unknown>>("GET", "/status");
    return {
      db: ctx.dbKind,
      executor: exec.ok ? "up" : "down",
      executorError: exec.error ?? null,
      executorStatus: exec.data,
      killSwitch: ctx.killSwitch.state(),
      protectedFiles: checkProtectedFiles(),
      alerts: await ctx.repo.listAlerts(50),
      systemEvents: await ctx.repo.listSystemEvents(50),
      jobs: await ctx.jobs.list(),
    };
  });

  app.get("/api/settings", async () => ({
    tradingMode: ctx.cfg.TRADING_MODE,
    tradingEnabled: ctx.cfg.TRADING_ENABLED,
    liveTradingEnabled: ctx.cfg.LIVE_TRADING_ENABLED,
    exchange: ctx.cfg.EXCHANGE,
    exchangeReadOnly: ctx.cfg.EXCHANGE_READ_ONLY,
    currency: ctx.cfg.CURRENCY,
    riskLimits: ctx.limits,
    validationThresholds: ctx.thresholds,
    note: "Read-only. Risk limits, thresholds and locked periods are protected files changed only by a human.",
  }));

  // -------------------------------------------------------------- overview
  app.get("/api/overview", async () => {
    const exec = await ctx.executor.call<Record<string, unknown>>("GET", "/status");
    const stats = await ctx.repo.researchStats();
    const active = await ctx.repo.listVersions({ stage: ["PAPER", "APPROVED", "LIVE"], limit: 20 });
    const candidates = await ctx.repo.listVersions({ stage: ["INCUBATING"], limit: 20 });
    const recentTrades = await ctx.repo.listTrades({ limit: 20, sessionKind: ctx.cfg.TRADING_MODE === "LIVE" ? "live" : "paper" });
    const openPositions = await ctx.repo.listPositions({ status: "open" });
    const jobs = (await ctx.jobs.list()).filter((j) => j.status === "running" || j.status === "queued");
    return {
      mode: ctx.cfg.TRADING_MODE,
      tradingEnabled: ctx.cfg.TRADING_ENABLED,
      liveTradingEnabled: ctx.cfg.LIVE_TRADING_ENABLED,
      killSwitch: ctx.killSwitch.state(),
      executor: exec.data,
      research: stats,
      activeStrategies: active,
      candidates,
      openPositions,
      recentTrades,
      researchQueue: jobs,
    };
  });

  // ------------------------------------------------------------ strategies
  app.get("/api/templates", async () =>
    listTemplates().map((t) => ({ key: t.key, family: t.family, name: t.name, description: t.description, hypothesis: t.hypothesis, params: t.params, defaults: t.defaults, benchmark: Boolean(t.isBenchmark), expectedRegimes: t.expectedRegimes })),
  );

  app.get<{ Querystring: { stage?: string; market?: string; limit?: string } }>("/api/strategies", async (req) => {
    const stages = req.query.stage ? (req.query.stage.split(",").map((s) => stageEnum.parse(s)) as StrategyStage[]) : undefined;
    return ctx.repo.listVersions({ ...(stages ? { stage: stages } : {}), ...(req.query.market ? { market: req.query.market } : {}), limit: Number(req.query.limit ?? 500) });
  });

  app.get<{ Params: { id: string } }>("/api/strategies/:id", async (req, reply) => {
    const v = await ctx.repo.getVersion(req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    const [runs, validations, decisions, family, experiments] = await Promise.all([
      ctx.repo.listBacktestRuns({ strategyVersionId: v.id }),
      ctx.repo.listValidationRuns(v.id),
      ctx.repo.listDecisions({ strategyId: v.id }),
      ctx.repo.listVersions({ strategyId: v.strategyId }),
      ctx.repo.listExperiments({ strategyVersionId: v.id }),
    ]);
    const paperTrades = await ctx.repo.listTrades({ strategyVersionId: v.id, limit: 1000 });
    return {
      version: v,
      template: listTemplates().find((t) => t.key === v.template) ?? null,
      lineage: family.map((f) => ({ id: f.id, version: f.version, parent: f.genomeParent, mutations: f.mutations, generation: f.generation, stage: f.stage, confidence: f.confidence })),
      backtestRuns: runs,
      validations,
      decisions,
      experiments,
      forwardTrades: paperTrades.filter((t) => t.sessionKind !== "backtest"),
    };
  });

  app.get<{ Params: { id: string } }>("/api/backtests/:id", async (req, reply) => {
    const run = await ctx.repo.getBacktestRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "not found" });
    const [equity, trades] = await Promise.all([ctx.repo.equityForRun(run.id), ctx.repo.tradesForRun(run.id, 2000)]);
    return { run, equity, trades };
  });

  app.get<{ Querystring: { versionId?: string; limit?: string } }>("/api/backtests", async (req) =>
    ctx.repo.listBacktestRuns({ ...(req.query.versionId ? { strategyVersionId: req.query.versionId } : {}), limit: Number(req.query.limit ?? 200) }),
  );

  app.get<{ Querystring: { campaignId?: string; limit?: string } }>("/api/experiments", async (req) =>
    ctx.repo.listExperiments({ ...(req.query.campaignId ? { campaignId: req.query.campaignId } : {}), limit: Number(req.query.limit ?? 200) }),
  );

  app.get("/api/campaigns", async () => ctx.repo.listCampaigns());
  app.get<{ Querystring: { versionId?: string } }>("/api/validation", async (req) => ctx.repo.listValidationRuns(req.query.versionId, 200));
  app.get("/api/research/stats", async () => ({ ...(await ctx.repo.researchStats()), totalTrials: await ctx.repo.totalTrials() }));

  // -------------------------------------------------------- research (auth)
  const ResearchBody = z.object({
    market: z.string().regex(/^[A-Z0-9]{3,20}$/),
    timeframe: z.enum(TIMEFRAMES).default("15m"),
    template: z.enum(RESEARCH_TEMPLATES.map((t) => t.key) as [string, ...string[]]),
    name: z.string().optional(),
    hypothesis: z.string().min(20).optional(),
    rationale: z.string().optional(),
    invalidation: z.string().optional(),
    parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    campaignId: z.string().optional(),
    wait: z.boolean().default(false),
  });

  const submit = async (kind: Parameters<typeof ctx.jobs.submit>[0], input: Record<string, unknown>, wait: boolean) => {
    const job = await ctx.jobs.submit(kind, input);
    if (!wait) return job;
    for (;;) {
      const j = await ctx.jobs.get(job.id);
      if (j && (j.status === "completed" || j.status === "failed")) return j;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  app.post("/api/research/strategies", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const b = ResearchBody.parse(req.body);
    return submit("research_strategy", { ...b, actor }, b.wait);
  });

  app.post<{ Params: { id: string } }>("/api/research/strategies/:id/optimise", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const wait = Boolean((req.body as { wait?: boolean } | undefined)?.wait);
    return submit("optimise", { versionId: req.params.id, actor }, wait);
  });

  app.post<{ Params: { id: string } }>("/api/research/strategies/:id/validate", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const wait = Boolean((req.body as { wait?: boolean } | undefined)?.wait);
    return submit("validate", { versionId: req.params.id, actor }, wait);
  });

  const CampaignBody = z.object({
    name: z.string().min(3),
    objective: z.string().min(10),
    markets: z.array(z.string().regex(/^[A-Z0-9]{3,20}$/)).min(1),
    timeframe: z.enum(TIMEFRAMES).default("15m"),
    templates: z.array(z.string()).optional(),
  });
  app.post("/api/research/campaigns", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const b = CampaignBody.parse(req.body);
    return submit("campaign", { ...b, actor }, false);
  });

  app.get("/api/jobs", async () => ctx.jobs.list());
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => (await ctx.jobs.get(req.params.id)) ?? reply.code(404).send({ error: "not found" }));

  app.post("/api/research/rank", async () => ctx.research.rankAndSelect());

  app.post("/api/research/import/trader-dev", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const res = await importTraderDevBacktest(ctx.repo, req.body as Parameters<typeof importTraderDevBacktest>[1]);
    await ctx.repo.recordDecision({ strategyId: null, action: "IMPORT_TRADER_DEV_BACKTEST", reason: "imported external backtest", evidence: res, inputMetrics: {}, outputDecision: "IMPORTED", ...actor });
    return res;
  });

  // ------------------------------------------------- lifecycle (gated)
  const PromoteBody = z.object({ to: stageEnum, reason: z.string().min(5) });
  app.post<{ Params: { id: string } }>("/api/strategies/:id/promote", async (req, reply) => {
    const b = PromoteBody.parse(req.body);
    const actor = b.to === "LIVE" || b.to === "APPROVED" ? requireHuman(req, reply, tokens) : requireActor(req, reply, tokens);
    if (!actor) return;
    const v = await ctx.repo.getVersion(req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    // Evidence is always computed server-side; callers cannot assert it.
    const ev = v.evidence as PromotionEvidence & { holdoutPassed?: boolean };
    const evidence: PromotionEvidence & Record<string, unknown> = {};
    if (b.to === "PAPER") evidence.incubationPassed = Boolean(v.frozenAt && ev.holdoutPassed);
    if (b.to === "APPROVED" || b.to === "LIVE") {
      const pe = await evaluatePaper(ctx.repo, v.id, ctx.thresholds);
      evidence.paperPassed = pe.passed;
      evidence.paperTrades = pe.trades;
      const breakerEvents = (await ctx.repo.listRiskEvents(1000)).filter((e) => e.strategyVersionId === v.id && e.kind === "breaker");
      evidence.riskPassed = breakerEvents.length === 0 && !pe.degraded;
      evidence.paperEvaluation = pe;
    }
    await ctx.research.strategies.transition(v.id, b.to, { reason: b.reason, evidence, actor, humanApproval: actor.actor === "human" });
    if (["PAPER", "APPROVED", "LIVE"].includes(b.to)) await ctx.executor.call("POST", "/strategies/reload", {});
    return ctx.repo.getVersion(v.id);
  });

  const DemoteBody = z.object({ to: z.enum(["DEGRADED", "PAPER", "RETIRED"]), reason: z.string().min(5) });
  app.post<{ Params: { id: string } }>("/api/strategies/:id/demote", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const b = DemoteBody.parse(req.body);
    await ctx.research.strategies.transition(req.params.id, b.to, { reason: b.reason, actor });
    await ctx.executor.call("POST", "/strategies/reload", {});
    return ctx.repo.getVersion(req.params.id);
  });

  // -------------------------------------------------------------- decisions
  app.get<{ Querystring: { strategyId?: string; limit?: string } }>("/api/decisions", async (req) =>
    ctx.repo.listDecisions({ ...(req.query.strategyId ? { strategyId: req.query.strategyId } : {}), limit: Number(req.query.limit ?? 200) }),
  );
  const DecisionBody = z.object({
    strategyId: z.string().nullable().default(null),
    action: z.string().min(2),
    reason: z.string().min(3),
    evidence: z.record(z.string(), z.unknown()).default({}),
    inputMetrics: z.record(z.string(), z.unknown()).default({}),
    outputDecision: z.string().min(1),
  });
  app.post("/api/decisions", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const b = DecisionBody.parse(req.body);
    return { id: await ctx.repo.recordDecision({ ...b, ...actor }) };
  });

  app.get("/api/journal", async () => ctx.repo.listJournal(200));
  const JournalBody = z.object({
    title: z.string().min(3),
    hypothesis: z.string().optional(),
    result: z.string().min(2),
    reason: z.string().min(2),
    observed: z.string().optional(),
    next: z.string().optional(),
    experimentNumber: z.number().int().optional(),
  });
  app.post("/api/journal", async (req, reply) => {
    if (!requireActor(req, reply, tokens)) return;
    const b = JournalBody.parse(req.body);
    const file = await writeJournal(ctx.repo, b);
    return { file };
  });

  // ---------------------------------------------------------- paper trading
  app.get("/api/paper/sessions", async () => ctx.repo.listPaperSessions(50));
  app.get<{ Params: { id: string } }>("/api/paper/sessions/:id", async (req, reply) => {
    const s = await ctx.repo.getPaperSession(req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const [trades, equity, orders, positions] = await Promise.all([
      ctx.repo.listTrades({ sessionId: s.id, limit: 2000 }),
      ctx.repo.equityForSession(s.id),
      ctx.repo.listOrders({ sessionId: s.id, limit: 500 }),
      ctx.repo.listPositions({ sessionId: s.id }),
    ]);
    const evaluations = await Promise.all(s.strategyVersionIds.map((id) => evaluatePaper(ctx.repo, id, ctx.thresholds).catch(() => null)));
    return { session: s, trades, equity, orders, positions, evaluations: evaluations.filter(Boolean) };
  });
  app.get<{ Params: { id: string } }>("/api/paper/evaluate/:id", async (req) => evaluatePaper(ctx.repo, req.params.id, ctx.thresholds));
  app.post("/api/paper/reload", async (req, reply) => {
    if (!requireActor(req, reply, tokens)) return;
    const r = await ctx.executor.call("POST", "/strategies/reload", {});
    return r.ok ? r.data : reply.code(503).send({ error: r.error ?? "executor unavailable" });
  });

  app.get("/api/portfolio", async () => {
    const exec = await ctx.executor.call<Record<string, unknown>>("GET", "/status");
    const ranked = await ctx.research.rankAndSelect();
    return { executor: exec.data, executorError: exec.error ?? null, selection: ranked, openPositions: await ctx.repo.listPositions({ status: "open" }) };
  });

  app.get("/api/live", async () => ({
    liveTradingEnabled: ctx.cfg.LIVE_TRADING_ENABLED,
    sessions: await ctx.repo.listLiveSessions(20),
    liveStrategies: await ctx.repo.listVersions({ stage: ["LIVE", "APPROVED"] }),
    trades: await ctx.repo.listTrades({ sessionKind: "live", limit: 200 }),
  }));

  app.get("/api/orders", async () => ctx.repo.listOrders({ limit: 300 }));

  // -------------------------------------------------------- trade & risk
  const TradeBody = z.object({
    strategyVersionId: z.string(),
    direction: z.enum(["UP", "DOWN"]),
    stake: z.string().regex(/^\d+(\.\d+)?$/),
    idempotencyKey: z.string().min(8),
    reason: z.string().min(3),
  });
  /** request_trade: ALWAYS evaluated by the executor's risk engine. There is no direct order endpoint. */
  app.post("/api/trade/request", async (req, reply) => {
    const actor = requireActor(req, reply, tokens);
    if (!actor) return;
    const b = TradeBody.parse(req.body);
    const r = await ctx.executor.call("POST", "/trade/request", { ...b, requestedBy: actor.actor === "human" ? "human" : "claude" });
    await ctx.repo.recordDecision({
      strategyId: b.strategyVersionId,
      action: "REQUEST_TRADE",
      reason: b.reason,
      evidence: { request: b },
      inputMetrics: {},
      outputDecision: r.ok ? String((r.data as { status?: string } | null)?.status ?? "unknown") : "EXECUTOR_UNAVAILABLE",
      ...actor,
    });
    if (!r.ok) return reply.code(503).send({ error: r.error ?? "executor unavailable — no trade placed (fail closed)" });
    return r.data;
  });

  app.get("/api/risk", async () => {
    const exec = await ctx.executor.call<{ breakers?: unknown[] }>("GET", "/status");
    return {
      limits: ctx.limits,
      killSwitch: ctx.killSwitch.state(),
      breakers: exec.data?.breakers ?? null,
      executorReachable: exec.ok,
      events: await ctx.repo.listRiskEvents(200),
    };
  });

  /** disable_trading / kill: always allowed for any authenticated caller; release is human-only (CLI). */
  app.post("/api/kill", async (req, reply) => {
    const actor = resolveActor(req, tokens);
    if (!actor) return reply.code(401).send({ error: "unauthorised" });
    const reason = String((req.body as { reason?: string } | undefined)?.reason ?? "kill requested");
    ctx.killSwitch.engage(reason, `${actor.actor}:${actor.sessionId}`);
    const r = await ctx.executor.call("POST", "/kill", { reason, by: `${actor.actor}:${actor.sessionId}` });
    await ctx.repo.riskEvent({ kind: "kill", code: "KILL_SWITCH", message: reason, data: { by: actor, executorAcknowledged: r.ok } });
    await ctx.repo.recordDecision({ strategyId: null, action: "DISABLE_TRADING", reason, evidence: {}, inputMetrics: {}, outputDecision: "KILL_SWITCH_ENGAGED", ...actor });
    return { killSwitch: ctx.killSwitch.state(), executorAcknowledged: r.ok };
  });

  app.post("/api/breakers/reset", async (req, reply) => {
    const actor = requireHuman(req, reply, tokens);
    if (!actor) return;
    const r = await ctx.executor.call("POST", "/breakers/reset", req.body ?? {}, { "x-human-token": tokens.human ?? "" });
    return r.ok ? r.data : reply.code(r.status).send(r.data ?? { error: r.error });
  });

  // ---------------------------------------------------- browser bridge relay
  app.get("/api/bridge/commands", async (_req, reply) => {
    const r = await ctx.executor.call("GET", "/bridge/commands");
    return r.ok ? r.data : reply.code(r.status).send(r.data ?? { error: r.error });
  });
  app.post("/api/bridge/results", async (req, reply) => {
    const r = await ctx.executor.call("POST", "/bridge/results", req.body);
    return r.ok ? r.data : reply.code(r.status).send(r.data ?? { error: r.error });
  });

  // ------------------------------------------------------------- reports
  app.post("/api/reports/daily", async (req, reply) => {
    if (!requireActor(req, reply, tokens)) return;
    return submit("daily_report", {}, true);
  });
  app.post("/api/reports/weekly", async (req, reply) => {
    if (!requireActor(req, reply, tokens)) return;
    return submit("weekly_review", {}, true);
  });

  return app;
}
