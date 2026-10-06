import { buildApi } from "../../apps/api/src/server";
import { InlineJobRunner } from "../../apps/api/src/jobs";
import type { ExecutorClient } from "../../apps/api/src/context";
import { createVersionRecord } from "@ct/core";
import type { DatabaseHandle, Repository } from "@ct/database";
import { ResearchService } from "@ct/research";
import { loadConfig } from "@ct/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITS, memoryRepo, TEST_PERIODS, TEST_THRESHOLDS, tempKillSwitch, testDatasetLoader } from "../helpers";

let app: FastifyInstance;
let h: DatabaseHandle;
let repo: Repository;
const ks = tempKillSwitch();
const executorCalls: string[] = [];
let executorUp = false;
const executor: ExecutorClient = {
  async call(method, path) {
    executorCalls.push(`${method} ${path}`);
    if (!executorUp) return { ok: false, status: 503, data: null, error: "executor unreachable" };
    return { ok: true, status: 200, data: { status: "rejected_by_risk", breakers: [] } as never };
  },
};

beforeAll(async () => {
  const m = await memoryRepo();
  h = m.h;
  repo = m.repo;
  const research = new ResearchService(repo, { thresholds: TEST_THRESHOLDS, periods: TEST_PERIODS, stake: "10", initialCapital: "1000", seed: 1, instrumentKey: "fixed-payout-80", datasetLoader: testDatasetLoader, writeJournalFiles: false });
  process.env.HUMAN_API_TOKEN = "human-token-0123456789";
  app = buildApi({
    cfg: { ...loadConfig({}), CONTROL_API_TOKEN: "claude-token-0123456789" },
    repo,
    research,
    jobs: new InlineJobRunner(async () => ({})),
    killSwitch: ks,
    limits: LIMITS,
    thresholds: TEST_THRESHOLDS,
    executor,
    dbKind: "pglite",
  });
  const rec = createVersionRecord({
    strategyId: "ETH-15M-MOMENTUM-001",
    version: 1,
    name: "x",
    market: "ETHUSDT",
    timeframe: "15m",
    template: "rsi-macd-momentum",
    family: "momentum",
    hypothesis: "Momentum continuation over one bar after RSI/MACD confirmation",
    rationale: "x",
    invalidation: "x",
    expectedRegimes: [],
    parameters: { rsiPeriod: 14, rsiThreshold: 60, holdBars: 1, volumeFilter: false },
    risk: {},
    createdBy: "claude",
    genome: { parent: null, mutations: [], generation: 0 },
  });
  await repo.insertStrategyVersion(rec, "PAPER");
});
afterAll(async () => {
  await app.close();
  await h.close();
  delete process.env.HUMAN_API_TOKEN;
});

const claude = { authorization: "Bearer claude-token-0123456789" };
const human = { authorization: "Bearer human-token-0123456789" };

describe("API permissions", () => {
  it("reads are open; writes need a token", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/decisions", payload: { action: "NOTE", reason: "abc", outputDecision: "Y" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/decisions", headers: claude, payload: { action: "NOTE", reason: "abc", outputDecision: "Y" } })).statusCode).toBe(200);
  });

  it("validates input (400 on bad payloads)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/trade/request", headers: claude, payload: { strategyVersionId: "x", direction: "SIDEWAYS", stake: "1", idempotencyKey: "abcdefgh", reason: "x" } });
    expect(r.statusCode).toBe(400);
  });

  it("request_trade fails closed (503) when the executor/risk engine is unreachable", async () => {
    executorUp = false;
    const r = await app.inject({ method: "POST", url: "/api/trade/request", headers: claude, payload: { strategyVersionId: "ETH-15M-MOMENTUM-001-v1", direction: "UP", stake: "5", idempotencyKey: "ETH-15M-20261006T120000-X", reason: "test" } });
    expect(r.statusCode).toBe(503);
    const d = await repo.listDecisions({ strategyId: "ETH-15M-MOMENTUM-001-v1" });
    expect(d[0]?.outputDecision).toBe("EXECUTOR_UNAVAILABLE");
  });

  it("Claude cannot approve or go live; humans still face the gates", async () => {
    const a = await app.inject({ method: "POST", url: "/api/strategies/ETH-15M-MOMENTUM-001-v1/promote", headers: claude, payload: { to: "APPROVED", reason: "please approve" } });
    expect(a.statusCode).toBe(403);
    const b = await app.inject({ method: "POST", url: "/api/strategies/ETH-15M-MOMENTUM-001-v1/promote", headers: human, payload: { to: "APPROVED", reason: "human approval attempt" } });
    expect(b.statusCode).toBe(409);
    expect(b.json().error).toMatch(/paper promotion gate/);
  });

  it("caller-supplied evidence is ignored", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/strategies/ETH-15M-MOMENTUM-001-v1/promote",
      headers: human,
      payload: { to: "APPROVED", reason: "forged evidence", evidence: { paperPassed: true, riskPassed: true, paperTrades: 5000 } },
    });
    expect(r.statusCode).toBe(409);
  });

  it("disable_trading engages the kill switch even when the executor is down", async () => {
    executorUp = false;
    const r = await app.inject({ method: "POST", url: "/api/kill", headers: claude, payload: { reason: "test kill" } });
    expect(r.statusCode).toBe(200);
    expect(ks.isEngaged()).toBe(true);
    expect(r.json().executorAcknowledged).toBe(false);
    ks.release("Test Human");
  });

  it("breaker reset is human-only", async () => {
    expect((await app.inject({ method: "POST", url: "/api/breakers/reset", headers: claude, payload: { name: "clock_drift", by: "claude" } })).statusCode).toBe(403);
  });

  it("exposes no direct order endpoint", () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/order(?!s)/i);
    expect(routes).toMatch(/trade\/request/);
  });
});
