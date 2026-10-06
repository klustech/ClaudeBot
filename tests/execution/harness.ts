import { ExecutionService, PaperExecutionAdapter, PortfolioLedger, type ExecutionAdapter } from "@ct/execution";
import { CircuitBreakerBoard, RiskEngine, type KillSwitch } from "@ct/risk";
import { ManualClock } from "@ct/shared";
import { Alerter, MemoryAlertChannel } from "@ct/telemetry";
import { LIMITS, NOW, tempKillSwitch } from "../helpers";

export function harness(over: { adapter?: (clock: ManualClock) => ExecutionAdapter; tradingEnabled?: boolean; killSwitch?: KillSwitch; orderTimeoutMs?: number; onOutcome?: () => Promise<void> } = {}) {
  const clock = new ManualClock(NOW);
  const price = { v: 100 };
  const adapter =
    over.adapter?.(clock) ??
    new PaperExecutionAdapter({ startingBalance: "1000", currency: "GBP", seed: 1, priceSource: () => price.v, clock, kind: "fixed-payout", payout: 0.8, feePerTrade: "0" });
  const breakers = new CircuitBreakerBoard(() => clock.now());
  const ledger = new PortfolioLedger("1000", clock.now());
  const channel = new MemoryAlertChannel();
  const alerter = new Alerter([channel], () => clock.now());
  const killSwitch = over.killSwitch ?? tempKillSwitch();
  const svc = new ExecutionService({
    adapter,
    risk: new RiskEngine(LIMITS),
    breakers,
    killSwitch,
    ledger,
    alerter,
    clock,
    flags: () => ({ tradingEnabled: over.tradingEnabled ?? true, liveTradingEnabled: false }),
    ...(over.orderTimeoutMs ? { orderTimeoutMs: over.orderTimeoutMs } : {}),
    ...(over.onOutcome ? { onOutcome: over.onOutcome } : {}),
  });
  return { svc, adapter, breakers, ledger, alerts: channel.alerts, clock, price, killSwitch };
}

export const FIXED = { kind: "fixed-payout" as const, expiryMs: 900_000 };
