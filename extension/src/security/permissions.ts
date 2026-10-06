import { stableStringify } from "./canonical";

/** The ONLY commands this extension will ever execute. */
export const ALLOWED_COMMANDS = ["get_market", "get_balance", "get_open_contracts", "place_trade", "cancel_trade", "get_trade_result"] as const;
export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

export interface SignedCommand {
  commandId: string;
  type: AllowedCommand;
  payload: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface SignedResult {
  commandId: string;
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  completedAt: number;
  signature: string;
}

const enc = new TextEncoder();

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Verifies signature, allow-list and expiry. Anything else is rejected. */
export async function verifyCommand(secret: string, cmd: SignedCommand, now = Date.now()): Promise<{ ok: boolean; reason?: string }> {
  if (!ALLOWED_COMMANDS.includes(cmd.type)) return { ok: false, reason: "command not allowed" };
  const { signature, ...unsigned } = cmd;
  const expected = await hmacHex(secret, stableStringify(unsigned));
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: "bad signature" };
  if (now > cmd.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

export async function signResult(secret: string, r: Omit<SignedResult, "signature">): Promise<SignedResult> {
  return { ...r, signature: await hmacHex(secret, stableStringify(r)) };
}

export function isAllowedBrokerUrl(url: string | undefined, hosts: readonly string[]): boolean {
  if (!url) return false;
  return hosts.some((pattern) => url.startsWith(pattern.replace(/\*$/, "")));
}
