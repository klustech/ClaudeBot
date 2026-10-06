import type { CircuitBreakerBoard } from "@ct/risk";
import type { Alerter } from "@ct/telemetry";
import { D, type Money } from "@ct/shared";
import type { PortfolioLedger } from "./ledger";
import type { ExecutionAdapter } from "./types";

export interface ReconciliationReport {
  ok: boolean;
  at: number;
  internalPositions: string[];
  brokerPositions: string[];
  missingAtBroker: string[];
  unknownAtBroker: string[];
  stakeMismatches: string[];
  balanceDifference: string | null;
  error?: string;
}

/**
 * Compares internal positions (ledger) with broker positions. Any mismatch,
 * or failure to reach the broker, halts trading until a human resolves it.
 */
export async function reconcile(input: {
  adapter: ExecutionAdapter;
  ledger: PortfolioLedger;
  breakers: CircuitBreakerBoard;
  alerter: Alerter;
  now: number;
  /** Expected broker balance (if the venue reports equity comparable to the ledger). */
  expectedBalance?: Money;
  balanceTolerance?: string;
}): Promise<ReconciliationReport> {
  const internal = input.ledger.openPositions();
  const base = {
    at: input.now,
    internalPositions: internal.map((p) => p.orderId),
    brokerPositions: [] as string[],
    missingAtBroker: [] as string[],
    unknownAtBroker: [] as string[],
    stakeMismatches: [] as string[],
    balanceDifference: null as string | null,
  };
  try {
    const broker = await input.adapter.getPositions();
    base.brokerPositions = broker.map((p) => p.orderId);
    const bmap = new Map(broker.map((p) => [p.orderId, p]));
    for (const p of internal) {
      const b = bmap.get(p.orderId);
      if (!b) base.missingAtBroker.push(p.orderId);
      else if (!b.stake.eq(p.stake)) base.stakeMismatches.push(p.orderId);
    }
    const imap = new Set(internal.map((p) => p.orderId));
    for (const b of broker) if (!imap.has(b.orderId)) base.unknownAtBroker.push(b.orderId);
    if (input.expectedBalance) {
      const bal = await input.adapter.getBalance();
      const diff = bal.total.minus(input.expectedBalance).abs();
      base.balanceDifference = diff.toFixed(8);
      if (diff.gt(D(input.balanceTolerance ?? "0.01"))) {
        input.breakers.trip("balance_mismatch", `Broker balance differs from ledger by ${diff.toFixed(2)}`);
      }
    }
  } catch (err) {
    input.breakers.trip("reconciliation_failed", `Reconciliation failed: ${(err as Error).message}`);
    input.ledger.markUnknown();
    await input.alerter.alert("reconciliation_failed", "critical", (err as Error).message);
    return { ...base, ok: false, error: (err as Error).message };
  }
  const ok = base.missingAtBroker.length === 0 && base.unknownAtBroker.length === 0 && base.stakeMismatches.length === 0;
  if (!ok) {
    input.breakers.trip("reconciliation_failed", "Internal and broker positions differ");
    input.ledger.markUnknown();
    await input.alerter.alert("broker_mismatch", "critical", "Position reconciliation mismatch; trading halted", base);
  }
  return { ...base, ok: ok && !input.breakers.openBreakers().some((b) => b.name === "balance_mismatch") };
}
