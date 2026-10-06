/**
 * EMERGENCY KILL SWITCH
 *
 *   pnpm trading:kill [--reason "..."]          engage: block new positions, cancel pending, alert
 *   pnpm trading:kill --release --by "Jane Doe"  HUMAN ONLY: release after investigation
 *
 * Works even if the API/executor are down: the kill-switch file is checked by
 * every process before any order. Logs are never deleted.
 */
import { parseArgs } from "node:util";
import { KillSwitch } from "@ct/risk";
import { alerterFromEnv } from "@ct/telemetry";

const { values } = parseArgs({
  options: { reason: { type: "string", default: "manual emergency stop" }, release: { type: "boolean", default: false }, by: { type: "string", default: process.env.USER ?? "operator" } },
});
const ks = new KillSwitch();

if (values.release) {
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) {
    console.error("Refusing: the kill switch can only be released by a human operator.");
    process.exit(2);
  }
  ks.release(values.by as string);
  console.log(`Kill switch released by ${values.by}. Circuit breakers must still be reset individually by a human.`);
  process.exit(0);
}

const state = ks.engage(values.reason as string, values.by as string);
console.log(`KILL SWITCH ENGAGED at ${state.engagedAt}: ${state.reason}`);

const api = process.env.API_URL ?? "http://127.0.0.1:4100";
try {
  const res = await fetch(`${api}/api/kill`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.CONTROL_API_TOKEN ? { authorization: `Bearer ${process.env.CONTROL_API_TOKEN}` } : {}) },
    body: JSON.stringify({ reason: values.reason }),
    signal: AbortSignal.timeout(5000),
  });
  console.log(`API acknowledged: ${res.status} ${await res.text()}`);
} catch (err) {
  console.warn(`API not reachable (${(err as Error).message}); kill-switch file is in place and blocks all processes.`);
}
await alerterFromEnv().alert("kill_switch", "critical", `KILL SWITCH ENGAGED by ${values.by}: ${values.reason}`);
