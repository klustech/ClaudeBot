import { checkProtectedFiles } from "@ct/core";
import { KillSwitch } from "@ct/risk";
import { loadConfig } from "@ct/shared";

const cfg = loadConfig();
console.log("Mode:                 ", cfg.TRADING_MODE);
console.log("TRADING_ENABLED:      ", cfg.TRADING_ENABLED);
console.log("LIVE_TRADING_ENABLED: ", cfg.LIVE_TRADING_ENABLED);
console.log("Kill switch:          ", JSON.stringify(new KillSwitch().state()));
for (const p of checkProtectedFiles()) console.log(`Protected ${p.ok ? "OK " : "BAD"}        `, p.file);
try {
  const res = await fetch(`${cfg.API_URL}/api/risk`, { signal: AbortSignal.timeout(3000) });
  const risk = (await res.json()) as { breakers: unknown; executorReachable: boolean };
  console.log("Executor reachable:   ", risk.executorReachable);
  console.log("Breakers:             ", JSON.stringify(risk.breakers));
} catch {
  console.log("API:                   unreachable");
}
