import { timingSafeEqual } from "node:crypto";
import type { BridgeQueue, BridgeResult } from "@ct/execution";
import type { BreakerName } from "@ct/risk";
import type { TradingRuntime } from "@ct/runtime";
import { buildIdempotencyKey } from "@ct/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

const TradeBody = z.object({
  strategyVersionId: z.string().min(1),
  direction: z.enum(["UP", "DOWN"]),
  stake: z.string().regex(/^\d+(\.\d+)?$/),
  idempotencyKey: z.string().min(8).optional(),
  signalTime: z.number().int().optional(),
  requestedBy: z.enum(["claude", "human"]).default("claude"),
  reason: z.string().default(""),
});

function tokenOk(req: FastifyRequest, expected: string | undefined): boolean {
  if (!expected) return req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  const got = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Internal control server of the executor (bind to loopback only). The API
 * is its only intended client. There is no endpoint that sends an order
 * without risk evaluation.
 */
export function buildExecutorServer(rt: TradingRuntime, opts: { token?: string; humanToken?: string; bridge?: BridgeQueue; onReload?: () => Promise<void> }): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    if (!tokenOk(req, opts.token)) return reply.code(401).send({ error: "unauthorised" });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/status", async () => rt.status());

  app.post("/trade/request", async (req, reply) => {
    const parsed = TradeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const b = parsed.data;
    const v = rt.activeStrategies().find((s) => s.id === b.strategyVersionId);
    const now = Date.now();
    const signalTime = b.signalTime ?? now;
    const key =
      b.idempotencyKey ??
      buildIdempotencyKey({ market: v?.market ?? "UNKNOWN", timeframe: v?.timeframe ?? "na", signalTime, strategyId: b.strategyVersionId });
    const out = await rt.requestTrade({
      idempotencyKey: key,
      strategyVersionId: b.strategyVersionId,
      strategyStage: "IDEA",
      liveEligible: false,
      market: v?.market ?? "UNKNOWN",
      direction: b.direction,
      stake: b.stake,
      mode: "PAPER",
      confidence: 0,
      edge: 0,
      signalTime,
      requestedBy: b.requestedBy,
    });
    return {
      status: out.status,
      idempotencyKey: key,
      approved: out.decision?.approved ?? false,
      violations: out.decision?.violations ?? [],
      order: out.order ? { ...out.order, requestedStake: out.order.requestedStake.toFixed(2), filledStake: out.order.filledStake.toFixed(2), fees: out.order.fees.toFixed(4) } : null,
      latency: out.latency,
      error: out.error ?? null,
    };
  });

  app.post("/kill", async (req) => {
    const body = (req.body ?? {}) as { reason?: string; by?: string };
    await rt.kill(body.reason ?? "manual kill", body.by ?? "api");
    return rt.status();
  });

  app.post("/breakers/reset", async (req, reply) => {
    if (!opts.humanToken || String(req.headers["x-human-token"] ?? "") !== opts.humanToken) {
      return reply.code(403).send({ error: "breaker reset requires a human operator token" });
    }
    const body = (req.body ?? {}) as { name?: BreakerName; scope?: string; by?: string };
    if (!body.name || !body.by) return reply.code(400).send({ error: "name and by required" });
    const ok = rt.breakers.reset(body.name, body.by, body.scope ?? "global");
    return { ok, breakers: rt.breakers.openBreakers() };
  });

  app.post("/reconcile", async () => rt.reconcileNow());

  app.post("/strategies/reload", async () => {
    await opts.onReload?.();
    return { strategies: rt.activeStrategies().map((s) => s.id) };
  });

  app.get<{ Params: { id: string } }>("/paper/evaluate/:id", async (req) => rt.paperEvaluation(req.params.id));

  // Browser-extension bridge (fixed-payout venues without an API).
  app.get("/bridge/commands", async (_req, reply) => {
    if (!opts.bridge) return reply.code(404).send({ error: "bridge disabled" });
    return { commands: opts.bridge.take() };
  });
  app.post("/bridge/results", async (req, reply) => {
    if (!opts.bridge) return reply.code(404).send({ error: "bridge disabled" });
    const ok = opts.bridge.complete(req.body as BridgeResult);
    return ok ? { ok } : reply.code(400).send({ error: "invalid or unknown result" });
  });

  return app;
}
