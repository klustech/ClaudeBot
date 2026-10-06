import { createHmac, timingSafeEqual } from "node:crypto";
import { newId, stableStringify } from "@ct/shared";

/** The only commands the browser extension will execute. */
export const BRIDGE_COMMANDS = [
  "get_market",
  "get_balance",
  "get_open_contracts",
  "place_trade",
  "cancel_trade",
  "get_trade_result",
] as const;
export type BridgeCommandType = (typeof BRIDGE_COMMANDS)[number];

export interface BridgeCommand {
  commandId: string;
  type: BridgeCommandType;
  payload: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface BridgeResult {
  commandId: string;
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  completedAt: number;
  signature: string;
}

function hmac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signCommand(
  secret: string,
  type: BridgeCommandType,
  payload: Record<string, unknown>,
  ttlMs: number,
  now = Date.now(),
): BridgeCommand {
  if (!secret || secret.length < 32) throw new Error("Bridge signing secret must be at least 32 characters");
  const unsigned = { commandId: newId(), type, payload, issuedAt: now, expiresAt: now + ttlMs };
  return { ...unsigned, signature: hmac(secret, stableStringify(unsigned)) };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyCommand(secret: string, cmd: BridgeCommand, now = Date.now()): { ok: boolean; reason?: string } {
  const { signature, ...unsigned } = cmd;
  if (!BRIDGE_COMMANDS.includes(cmd.type)) return { ok: false, reason: "command not allowed" };
  if (!safeEqual(hmac(secret, stableStringify(unsigned)), signature)) return { ok: false, reason: "bad signature" };
  if (now > cmd.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function signResult(secret: string, r: Omit<BridgeResult, "signature">): BridgeResult {
  return { ...r, signature: hmac(secret, stableStringify(r)) };
}

export function verifyResult(secret: string, r: BridgeResult): boolean {
  const { signature, ...unsigned } = r;
  return safeEqual(hmac(secret, stableStringify(unsigned)), signature);
}
