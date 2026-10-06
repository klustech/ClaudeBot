import { BridgeQueue, BrowserExecutionAdapter, PaperExecutionAdapter, reconcile, type ExecutionAdapter } from "@ct/execution";
import { D, loadConfig } from "@ct/shared";
import { Alerter, MemoryAlertChannel } from "@ct/telemetry";
import { describe, expect, it } from "vitest";
import { baseRequest } from "../helpers";
import { FIXED, harness } from "../execution/harness";

function delegating(inner: ExecutionAdapter, overrides: Partial<ExecutionAdapter>): ExecutionAdapter {
  return new Proxy(inner, { get: (t, p) => (p in overrides ? (overrides as Record<string | symbol, unknown>)[p] : (t as unknown as Record<string | symbol, unknown>)[p]) }) as ExecutionAdapter;
}

describe("failure injection: uncertain state = NO NEW TRADE", () => {
  it("broker timeout → unknown state → breaker → further trades rejected", async () => {
    const h = harness({ adapter: () => ({ name: "slow", mode: "PAPER", placeOrder: () => new Promise(() => undefined) }) as unknown as ExecutionAdapter, orderTimeoutMs: 50 });
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.status).toBe("unknown");
    expect(h.breakers.openBreakers().map((b) => b.name)).toContain("execution_unknown_state");
    const next = await h.svc.requestTrade(baseRequest({ idempotencyKey: "second-key-1" }), FIXED);
    expect(next.decision?.violations.map((v) => v.code)).toEqual(expect.arrayContaining(["CIRCUIT_BREAKER", "UNKNOWN_STATE"]));
  });

  it("internet/venue disconnect → halt", async () => {
    const h = harness();
    (h.adapter as PaperExecutionAdapter).setConnected(false);
    expect((await h.svc.requestTrade(baseRequest(), FIXED)).status).toBe("unknown");
    expect(h.breakers.isHalted()).toBe(true);
  });

  it("double click / concurrent duplicate order → executes once", async () => {
    const h = harness();
    let calls = 0;
    const inner = h.adapter;
    const slow = delegating(inner, {
      placeOrder: async (o) => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return inner.placeOrder(o);
      },
    });
    const h2 = harness({ adapter: () => slow });
    const [a, b] = await Promise.all([h2.svc.requestTrade(baseRequest(), FIXED), h2.svc.requestTrade(baseRequest(), FIXED)]);
    expect([a.status, b.status].sort()).toEqual(["accepted", "duplicate"]);
    expect(calls).toBe(1);
  });

  it("partial/inconsistent broker response (filled stake ≠ approved) → execution_mismatch breaker", async () => {
    const h = harness();
    const inner = h.adapter;
    const partial = delegating(inner, { placeOrder: async (o) => ({ ...(await inner.placeOrder(o)), filledStake: D(3) }) });
    const h2 = harness({ adapter: () => partial });
    await h2.svc.requestTrade(baseRequest(), FIXED);
    expect(h2.breakers.openBreakers().map((b) => b.name)).toContain("execution_mismatch");
  });

  it("incorrect broker balance → balance_mismatch breaker", async () => {
    const h = harness();
    const r = await reconcile({ adapter: h.adapter, ledger: h.ledger, breakers: h.breakers, alerter: new Alerter([new MemoryAlertChannel()]), now: h.clock.now(), expectedBalance: D(900) });
    expect(r.ok).toBe(false);
    expect(h.breakers.openBreakers().map((b) => b.name)).toContain("balance_mismatch");
  });

  it("reconciliation cannot reach broker → halt", async () => {
    const h = harness();
    (h.adapter as PaperExecutionAdapter).setConnected(false);
    const r = await reconcile({ adapter: h.adapter, ledger: h.ledger, breakers: h.breakers, alerter: new Alerter([new MemoryAlertChannel()]), now: h.clock.now() });
    expect(r.ok).toBe(false);
    expect(h.breakers.openBreakers().map((b) => b.name)).toContain("reconciliation_failed");
  });

  it("stale market price → rejected", async () => {
    const h = harness();
    const out = await h.svc.requestTrade(baseRequest({ dataAgeMs: 10 * 60_000 }), FIXED);
    expect(out.decision?.violations.map((v) => v.code)).toContain("STALE_DATA");
  });

  it("database failure while recording an execution → treated as unknown state", async () => {
    const h = harness({
      onOutcome: async () => {
        throw new Error("connection terminated (postgres restart)");
      },
    });
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.status).toBe("unknown");
    expect(h.breakers.isHalted()).toBe(true);
  });

  it("browser extension disconnected → bridge timeout → halt", async () => {
    const bridge = new BridgeQueue("b".repeat(40));
    const h = harness({ adapter: () => new BrowserExecutionAdapter(bridge, "PAPER", { timeoutMs: 50, ttlMs: 1000 }), orderTimeoutMs: 1000 });
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.status).toBe("unknown");
    expect(h.breakers.openBreakers().map((b) => b.name)).toContain("execution_unknown_state");
  });

  it("configuration defaults are safe and LIVE cannot start without LIVE_TRADING_ENABLED", () => {
    const cfg = loadConfig({});
    expect(cfg.TRADING_MODE).toBe("PAPER");
    expect(cfg.TRADING_ENABLED).toBe(false);
    expect(cfg.LIVE_TRADING_ENABLED).toBe(false);
    expect(cfg.EXCHANGE_READ_ONLY).toBe(true);
    expect(() => loadConfig({ TRADING_MODE: "live" })).toThrow(/LIVE_TRADING_ENABLED/);
    expect(loadConfig({ TRADING_MODE: "live", LIVE_TRADING_ENABLED: "true" }).TRADING_MODE).toBe("LIVE");
  });
});
