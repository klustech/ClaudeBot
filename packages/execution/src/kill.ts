import type { KillSwitch } from "@ct/risk";
import type { Alerter } from "@ct/telemetry";
import type { ExecutionAdapter } from "./types";

export interface KillResult {
  engagedAt: string;
  cancelled: string[];
  cancelErrors: string[];
}

/**
 * Emergency stop: blocks new positions (kill-switch file), cancels pending
 * orders, never deletes logs, and sends a critical alert.
 */
export async function engageKillSwitch(input: {
  killSwitch: KillSwitch;
  reason: string;
  by: string;
  adapters?: ExecutionAdapter[];
  pendingOrderIds?: string[];
  alerter?: Alerter;
}): Promise<KillResult> {
  const state = input.killSwitch.engage(input.reason, input.by);
  const cancelled: string[] = [];
  const cancelErrors: string[] = [];
  for (const adapter of input.adapters ?? []) {
    for (const id of input.pendingOrderIds ?? []) {
      try {
        await adapter.cancelOrder(id);
        cancelled.push(id);
      } catch (err) {
        cancelErrors.push(`${id}: ${(err as Error).message}`);
      }
    }
  }
  await input.alerter?.alert("kill_switch", "critical", `KILL SWITCH ENGAGED by ${input.by}: ${input.reason}`, { cancelled, cancelErrors });
  return { engagedAt: state.engagedAt as string, cancelled, cancelErrors };
}
