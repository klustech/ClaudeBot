import { ExecutionService } from "@ct/execution";
import { TOOLS, FORBIDDEN_TOOL_NAMES } from "../../mcp/trading-control/src/tools";
import { D } from "@ct/shared";
import { describe, expect, it, vi } from "vitest";
import { baseRequest } from "../helpers";
import { FIXED, harness } from "../execution/harness";

describe("safety: the risk engine cannot be bypassed", () => {
  it("cannot trade when TRADING_ENABLED=false — the venue is never called", async () => {
    const h = harness({ tradingEnabled: false });
    const spy = vi.spyOn(h.adapter, "placeOrder");
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.status).toBe("rejected_by_risk");
    expect(spy).not.toHaveBeenCalled();
  });

  it("cannot trade while the kill switch is engaged", async () => {
    const h = harness();
    h.killSwitch.engage("test", "tester");
    const spy = vi.spyOn(h.adapter, "placeOrder");
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.decision?.violations.map((v) => v.code)).toContain("KILL_SWITCH");
    expect(spy).not.toHaveBeenCalled();
    expect(() => h.killSwitch.release("claude")).toThrow();
    expect(() => h.killSwitch.release("system")).toThrow();
    h.killSwitch.release("Jane Operator");
    expect(h.killSwitch.isEngaged()).toBe(false);
  });

  it("cannot exceed max position", async () => {
    const h = harness();
    const out = await h.svc.requestTrade(baseRequest({ stake: "50" }), FIXED);
    expect(out.decision?.violations.map((v) => v.code)).toContain("MAX_POSITION");
  });

  it("cannot exceed daily loss", async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      const out = await h.svc.requestTrade(baseRequest({ idempotencyKey: `loss-key-${i}`, stake: "10" }), FIXED);
      expect(out.status).toBe("accepted");
      h.svc.settle(out.order!.orderId, D(-10), D(0));
    }
    const out = await h.svc.requestTrade(baseRequest({ idempotencyKey: "loss-key-final" }), FIXED);
    expect(out.decision?.violations.map((v) => v.code)).toContain("MAX_DAILY_LOSS");
  });

  it("cannot execute a stale signal", async () => {
    const h = harness();
    const out = await h.svc.requestTrade(baseRequest({ signalTime: h.clock.now() - 5 * 60_000 }), FIXED);
    expect(out.decision?.violations.map((v) => v.code)).toContain("STALE_SIGNAL");
  });

  it("cannot execute a duplicate trade (same idempotency key)", async () => {
    const h = harness();
    const spy = vi.spyOn(h.adapter, "placeOrder");
    expect((await h.svc.requestTrade(baseRequest(), FIXED)).status).toBe("accepted");
    expect((await h.svc.requestTrade(baseRequest(), FIXED)).status).toBe("duplicate");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ExecutionService exposes no method that places an order without risk evaluation", () => {
    const methods = Object.getOwnPropertyNames(ExecutionService.prototype).filter((m) => m !== "constructor");
    expect(methods.sort()).toEqual(["adapter", "pendingKeys", "requestTrade", "settle"]);
  });

  it("the Claude MCP surface has request_trade but no arbitrary-order, risk-limit or live-enable tools", () => {
    const names = TOOLS.map((t) => t.name);
    for (const required of ["research_strategy", "list_strategies", "get_strategy", "run_validation", "rank_strategies", "promote_strategy", "demote_strategy", "start_paper_session", "get_paper_results", "request_trade", "get_portfolio", "get_risk_status", "disable_trading"]) {
      expect(names).toContain(required);
    }
    for (const forbidden of FORBIDDEN_TOOL_NAMES) expect(names).not.toContain(forbidden);
    expect(names.some((n) => /order|withdraw|credential|secret|leverage/i.test(n))).toBe(false);
  });
});
