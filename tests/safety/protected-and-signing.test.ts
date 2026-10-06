import { checkProtectedFiles, writeManifest, assertProtectedFilesIntact, PROTECTED_FILES } from "@ct/core";
import { BybitExecutionAdapter } from "@ct/exchanges";
import { signCommand, signResult, verifyCommand as verifyBackend, verifyResult } from "@ct/execution";
import { D, SafetyViolation } from "@ct/shared";
import { createHmac } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preTradeChecks } from "../../extension/src/broker/executor";
import { verifyCommand as verifyInExtension, signResult as signInExtension } from "../../extension/src/security/permissions";

describe("protected configuration", () => {
  it("repository files match pinned hashes", () => {
    expect(checkProtectedFiles().every((c) => c.ok)).toBe(true);
  });
  it("detects tampering with locked periods or risk limits (fail closed)", () => {
    const root = mkdtempSync(join(tmpdir(), "ct-prot-"));
    mkdirSync(join(root, "config"));
    mkdirSync(join(root, "validation"));
    for (const f of PROTECTED_FILES) cpSync(join(process.cwd(), f), join(root, f));
    writeManifest(root);
    expect(() => assertProtectedFilesIntact(root)).not.toThrow();
    writeFileSync(join(root, "config/risk-limits.json"), JSON.stringify({ MAX_POSITION_PERCENT: 100 }));
    expect(() => assertProtectedFilesIntact(root)).toThrow(/Protected configuration changed/);
  });
});

describe("signed bridge commands (backend ↔ extension)", () => {
  const secret = "s".repeat(40);
  it("a backend-signed command verifies in the extension; tampering and expiry are rejected", async () => {
    const cmd = signCommand(secret, "place_trade", { market: "ETH", direction: "UP", stake: "5" }, 5000);
    expect((await verifyInExtension(secret, cmd as never)).ok).toBe(true);
    expect((await verifyInExtension(secret, { ...cmd, payload: { ...cmd.payload, stake: "500" } } as never)).ok).toBe(false);
    expect((await verifyInExtension(secret, cmd as never, cmd.expiresAt + 1)).reason).toBe("expired");
    expect((await verifyInExtension("x".repeat(40), cmd as never)).ok).toBe(false);
    expect(verifyBackend(secret, { ...cmd, type: "withdraw" as never }).ok).toBe(false);
  });
  it("extension-signed results verify in the backend", async () => {
    const r = await signInExtension(secret, { commandId: "c1", ok: true, data: { tradeId: "T1" }, completedAt: 1 });
    expect(verifyResult(secret, r)).toBe(true);
    expect(verifyResult(secret, { ...r, data: { tradeId: "T2" } })).toBe(false);
    expect(verifyResult(secret, signResult(secret, { commandId: "c1", ok: true, data: {}, completedAt: 1 }))).toBe(true);
  });
  it("refuses short secrets", () => {
    expect(() => signCommand("short", "get_balance", {}, 1000)).toThrow();
  });
  it("extension pre-trade checks verify market, direction, stake, payout, balance, account and window", () => {
    const cmd = signCommand(secret, "place_trade", { market: "ETH/USD", direction: "UP", stake: "5", minPayout: 0.75, accountId: "ACC1" }, 5000);
    const good = { accountId: "ACC1", balance: 100, market: "ETHUSD", price: 2000, payout: 0.8 };
    expect(preTradeChecks(cmd as never, good).ok).toBe(true);
    expect(preTradeChecks(cmd as never, { ...good, market: "BTCUSD" }).failures.join()).toMatch(/market/);
    expect(preTradeChecks(cmd as never, { ...good, payout: 0.7 }).failures.join()).toMatch(/payout/);
    expect(preTradeChecks(cmd as never, { ...good, balance: 1 }).failures.join()).toMatch(/balance/);
    expect(preTradeChecks(cmd as never, { ...good, accountId: "OTHER" }).failures.join()).toMatch(/account/);
    expect(preTradeChecks(cmd as never, good, cmd.expiresAt + 1).failures.join()).toMatch(/window/);
  });
});

describe("Bybit adapter", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const result = url.includes("wallet-balance") ? { list: [{ totalEquity: "123.45", totalAvailableBalance: "100" }] } : { list: [] };
    return new Response(JSON.stringify({ retCode: 0, retMsg: "OK", result }), { status: 200 });
  }) as unknown as typeof fetch;

  it("signs requests per Bybit v5 (timestamp + key + recvWindow + payload)", async () => {
    const a = new BybitExecutionAdapter({ apiKey: "KEY", apiSecret: "SECRET", mode: "READ_ONLY", liveTradingEnabled: false, fetchImpl, now: () => 1700000000000 });
    const bal = await a.getBalance();
    expect(bal.total.toString()).toBe("123.45");
    const c = calls.at(-1)!;
    const headers = c.init.headers as Record<string, string>;
    const expected = createHmac("sha256", "SECRET").update(`1700000000000KEY5000accountType=UNIFIED`).digest("hex");
    expect(headers["X-BAPI-SIGN"]).toBe(expected);
    expect(c.url).toBe("https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED");
  });
  it("READ_ONLY cannot place or cancel orders", async () => {
    const a = new BybitExecutionAdapter({ apiKey: "KEY", apiSecret: "SECRET", mode: "READ_ONLY", liveTradingEnabled: false, fetchImpl });
    await expect(a.placeOrder({ idempotencyKey: "k-123456", strategyVersionId: "s", market: "ETHUSDT", direction: "UP", stake: D(10), kind: "linear" })).rejects.toThrow(SafetyViolation);
    await expect(a.cancelOrder("x")).rejects.toThrow(SafetyViolation);
  });
  it("LIVE requires LIVE_TRADING_ENABLED; TESTNET uses the testnet host", async () => {
    expect(() => new BybitExecutionAdapter({ apiKey: "K", apiSecret: "S", mode: "LIVE", liveTradingEnabled: false, fetchImpl })).toThrow(SafetyViolation);
    const t = new BybitExecutionAdapter({ apiKey: "K", apiSecret: "S", mode: "TESTNET", liveTradingEnabled: false, fetchImpl });
    await t.getPositions();
    expect(calls.at(-1)!.url.startsWith("https://api-testnet.bybit.com/")).toBe(true);
  });
});
