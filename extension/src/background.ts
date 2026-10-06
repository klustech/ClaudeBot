import { isAllowedBrokerUrl, signResult, verifyCommand, type SignedCommand } from "./security/permissions";

const API = "http://127.0.0.1:4100";
const HOSTS = __BROKER_HOSTS__;

async function secret(): Promise<string | null> {
  const s = await chrome.storage.local.get(["bridgeSecret"]);
  return typeof s.bridgeSecret === "string" && s.bridgeSecret.length >= 32 ? s.bridgeSecret : null;
}

async function report(sec: string, commandId: string, ok: boolean, data: Record<string, unknown>, error?: string): Promise<void> {
  const r = await signResult(sec, { commandId, ok, data, ...(error ? { error } : {}), completedAt: Date.now() });
  await fetch(`${API}/api/bridge/results`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) });
}

async function poll(): Promise<void> {
  const sec = await secret();
  if (!sec) return;
  let commands: SignedCommand[] = [];
  try {
    const res = await fetch(`${API}/api/bridge/commands`);
    if (!res.ok) return;
    commands = ((await res.json()) as { commands: SignedCommand[] }).commands ?? [];
  } catch {
    return;
  }
  for (const cmd of commands) {
    const v = await verifyCommand(sec, cmd);
    if (!v.ok) {
      // Never execute; report rejection only if the signature itself was valid.
      if (v.reason === "expired") await report(sec, cmd.commandId, false, {}, "expired");
      continue;
    }
    const tabs = (await chrome.tabs.query({ url: HOSTS })).filter((t) => isAllowedBrokerUrl(t.url, HOSTS));
    const tab = tabs[0];
    if (!tab?.id) {
      await report(sec, cmd.commandId, false, {}, "broker tab not open");
      continue;
    }
    try {
      const out = await chrome.tabs.sendMessage<{ ok: boolean; data: Record<string, unknown>; error?: string }>(tab.id, { kind: "ct-execute", command: cmd });
      await report(sec, cmd.commandId, out.ok, out.data, out.error);
    } catch (err) {
      await report(sec, cmd.commandId, false, { state: "unknown" }, `content script error: ${(err as Error).message}`);
    }
  }
}

chrome.alarms.create("ct-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => void poll());
setInterval(() => void poll(), 1000);
