import { PaperExecutionAdapter, reconcile } from "@ct/execution";
import { D } from "@ct/shared";
import { describe, expect, it } from "vitest";
import { baseRequest } from "../helpers";
import { FIXED, harness } from "./harness";

describe("execution service", () => {
  it("accepts a risk-approved order, records latency per stage and updates the ledger", async () => {
    const h = harness();
    const out = await h.svc.requestTrade(baseRequest(), FIXED);
    expect(out.status).toBe("accepted");
    expect(out.order?.filledStake.toString()).toBe("10");
    expect(Object.keys(out.latency)).toEqual(expect.arrayContaining(["signal->decision", "total"]));
    expect(h.ledger.openPositions()).toHaveLength(1);
    expect(h.alerts.map((a) => a.type)).toContain("trade_opened");
  });

  it("settles fixed-payout positions into the ledger with correct P&L", async () => {
    const h = harness();
    await h.svc.requestTrade(baseRequest(), FIXED);
    h.price.v = 101;
    h.clock.advance(900_000);
    const settled = (h.adapter as PaperExecutionAdapter).settleExpired();
    expect(settled).toHaveLength(1);
    expect(settled[0]!.pnl!.toString()).toBe("8");
    h.svc.settle(settled[0]!.orderId, settled[0]!.pnl!, settled[0]!.fees);
    expect(h.ledger.currentEquity().toString()).toBe("1008");
    expect((await h.adapter.getBalance()).total.toString()).toBe("1008");
  });

  it("reconciliation passes when books agree and halts when they differ", async () => {
    const h = harness();
    await h.svc.requestTrade(baseRequest(), FIXED);
    const ok = await reconcile({ adapter: h.adapter, ledger: h.ledger, breakers: h.breakers, alerter: { alert: async () => ({}) } as never, now: h.clock.now(), expectedBalance: D(1000) });
    expect(ok.ok).toBe(true);
    // Broker shows a position the ledger does not know about.
    await (h.adapter as PaperExecutionAdapter).placeOrder({ idempotencyKey: "rogue-order-1", strategyVersionId: "X", market: "ETHUSDT", direction: "UP", stake: D(5), kind: "fixed-payout", expiryMs: 900_000 });
    const bad = await reconcile({ adapter: h.adapter, ledger: h.ledger, breakers: h.breakers, alerter: { alert: async () => ({}) } as never, now: h.clock.now() });
    expect(bad.ok).toBe(false);
    expect(bad.unknownAtBroker).toEqual([expect.stringMatching(/^paper-/)]);
    expect(h.breakers.isHalted()).toBe(true);
    expect((await h.svc.requestTrade(baseRequest({ idempotencyKey: "another-key-123" }), FIXED)).status).toBe("rejected_by_risk");
  });
});
