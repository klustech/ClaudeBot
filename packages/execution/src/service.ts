import type { Alerter } from "@ct/telemetry";
import { LatencyTrace } from "@ct/telemetry";
import type { CircuitBreakerBoard, KillSwitch, RiskDecision, RiskEngine, TradeRequest } from "@ct/risk";
import { D, type Clock, type InstrumentKind, type Money, systemClock } from "@ct/shared";
import type { PortfolioLedger } from "./ledger";
import { AdapterTimeoutError, type ExecutionAdapter, type OrderResult } from "./types";

export interface ExecutionOutcome {
  status: "rejected_by_risk" | "duplicate" | "accepted" | "venue_rejected" | "unknown";
  decision: RiskDecision | null;
  order: OrderResult | null;
  latency: Record<string, number | undefined>;
  error?: string;
}

export interface ExecutionServiceOptions {
  adapter: ExecutionAdapter;
  risk: RiskEngine;
  breakers: CircuitBreakerBoard;
  killSwitch: KillSwitch;
  ledger: PortfolioLedger;
  alerter: Alerter;
  flags: () => { tradingEnabled: boolean; liveTradingEnabled: boolean; liveStakeCeiling?: Money; livePermittedStrategies?: readonly string[] };
  clock?: Clock;
  orderTimeoutMs?: number;
  /** Persist every outcome (orders table, risk_events, telemetry). */
  onOutcome?: (req: TradeRequest, outcome: ExecutionOutcome) => Promise<void> | void;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new AdapterTimeoutError(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The only path from a trade intent to a venue. There is deliberately no
 * method that places an order without risk evaluation.
 */
export class ExecutionService {
  private readonly clock: Clock;
  private readonly pending = new Set<string>();

  constructor(private readonly o: ExecutionServiceOptions) {
    this.clock = o.clock ?? systemClock;
  }

  get adapter(): ExecutionAdapter {
    return this.o.adapter;
  }

  async requestTrade(
    req: TradeRequest,
    exec: { kind: InstrumentKind; expiryMs?: number; maxHoldMs?: number },
  ): Promise<ExecutionOutcome> {
    const trace = new LatencyTrace(() => this.clock.now());
    trace.mark("signal", req.signalTime).mark("decision");
    const finish = async (outcome: ExecutionOutcome): Promise<ExecutionOutcome> => {
      outcome.latency = trace.breakdown();
      try {
        await this.o.onOutcome?.(req, outcome);
      } catch (err) {
        // Failing to persist an execution means our books may be wrong: fail closed.
        this.o.ledger.markUnknown();
        this.o.breakers.trip("execution_unknown_state", `Persistence failed for ${req.idempotencyKey}: ${(err as Error).message}`);
        await this.o.alerter.alert("api_failure", "critical", `Could not record ${req.idempotencyKey}; trading halted`, { error: (err as Error).message });
        if (outcome.status === "accepted") return { ...outcome, status: "unknown", error: (err as Error).message };
      }
      return outcome;
    };

    const flags = this.o.flags();
    const now = this.clock.now();
    const state = this.o.ledger.snapshot(now);
    const decision = this.o.risk.evaluate(req, state, {
      tradingEnabled: flags.tradingEnabled,
      liveTradingEnabled: flags.liveTradingEnabled,
      killSwitchEngaged: this.o.killSwitch.isEngaged(),
      breakers: this.o.breakers,
      now,
      ...(flags.liveStakeCeiling ? { liveStakeCeiling: flags.liveStakeCeiling } : {}),
      ...(flags.livePermittedStrategies ? { livePermittedStrategies: flags.livePermittedStrategies } : {}),
    });

    if (!decision.approved) {
      const dup = decision.violations.length === 1 && decision.violations[0]?.code === "DUPLICATE";
      if (!dup) {
        await this.o.alerter.alert("risk_rejection", "info", `Rejected ${req.idempotencyKey}: ${decision.violations.map((v) => v.code).join(",")}`, {
          violations: decision.violations,
        });
      }
      return finish({ status: dup ? "duplicate" : "rejected_by_risk", decision, order: null, latency: {} });
    }
    // Reserve the key before touching the venue so a concurrent duplicate cannot pass.
    if (!this.o.ledger.reserveKey(req.idempotencyKey)) {
      return finish({ status: "duplicate", decision, order: null, latency: {} });
    }
    trace.mark("risk_approved").mark("execution_requested");
    this.pending.add(req.idempotencyKey);
    try {
      const order = await withTimeout(
        this.o.adapter.placeOrder({
          idempotencyKey: req.idempotencyKey,
          strategyVersionId: req.strategyVersionId,
          market: req.market,
          direction: req.direction,
          stake: decision.stake,
          kind: exec.kind,
          ...(exec.expiryMs !== undefined ? { expiryMs: exec.expiryMs } : {}),
          ...(exec.maxHoldMs !== undefined ? { maxHoldMs: exec.maxHoldMs } : {}),
          maxSlippageBps: this.o.risk.config.MAX_SLIPPAGE_BPS,
        }),
        this.o.orderTimeoutMs ?? 10_000,
      );
      trace.mark("broker_accepted");
      if (order.state === "rejected") {
        return finish({ status: "venue_rejected", decision, order, latency: {} });
      }
      // Verify the venue executed exactly what was approved.
      if (order.market !== req.market || order.direction !== req.direction || !order.filledStake.eq(decision.stake)) {
        this.o.breakers.trip("execution_mismatch", `Order ${order.orderId} does not match approved instruction ${req.idempotencyKey}`);
        await this.o.alerter.alert("broker_mismatch", "critical", `Execution mismatch on ${req.idempotencyKey}`, { order });
      }
      this.o.ledger.recordOpen(
        { strategyVersionId: req.strategyVersionId, market: req.market, stake: order.filledStake, orderId: order.orderId },
        order.fees,
        this.clock.now(),
      );
      await this.o.alerter.alert("trade_opened", "info", `${req.direction} ${req.market} stake ${order.filledStake.toFixed(2)} (${req.strategyVersionId})`);
      return finish({ status: "accepted", decision, order, latency: {} });
    } catch (err) {
      // Unknown execution state: we cannot know whether the order exists. Fail closed.
      this.o.ledger.markUnknown();
      this.o.breakers.trip("execution_unknown_state", `${req.idempotencyKey}: ${(err as Error).message}`);
      await this.o.alerter.alert("api_failure", "critical", `Unknown execution state for ${req.idempotencyKey}; trading halted`, {
        error: (err as Error).message,
      });
      return finish({ status: "unknown", decision, order: null, latency: {}, error: (err as Error).message });
    } finally {
      this.pending.delete(req.idempotencyKey);
    }
  }

  /** Records a settlement reported by the venue. */
  settle(orderId: string, pnl: Money, entryFees: Money): void {
    this.o.ledger.recordSettlement(orderId, pnl, entryFees, this.clock.now());
  }

  pendingKeys(): string[] {
    return [...this.pending];
  }
}

export function moneyOrZero(v: string | undefined): Money {
  return D(v ?? "0");
}
