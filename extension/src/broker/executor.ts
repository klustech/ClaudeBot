import type { SignedCommand } from "../security/permissions";
import { readBrokerState, readConfirmation, type BrokerState } from "./parser";
import { SELECTORS } from "./selectors";

export interface PreTradeCheck {
  ok: boolean;
  failures: string[];
}

/**
 * Pure pre-trade verification against the live broker UI state. Every
 * condition must hold or nothing is clicked.
 */
export function preTradeChecks(cmd: SignedCommand, state: BrokerState, now = Date.now()): PreTradeCheck {
  const p = cmd.payload as { market?: string; direction?: string; stake?: string; minPayout?: number; accountId?: string; expiresAt?: number };
  const f: string[] = [];
  const stake = Number(p.stake);
  if (cmd.type !== "place_trade") f.push("not a place_trade command");
  if (!p.market || !state.market || state.market.replace(/[^A-Z0-9]/gi, "").toUpperCase() !== p.market.replace(/[^A-Z0-9]/gi, "").toUpperCase()) f.push(`market mismatch (${state.market} vs ${p.market})`);
  if (p.direction !== "UP" && p.direction !== "DOWN") f.push("invalid direction");
  if (!(stake > 0)) f.push("invalid stake");
  if (state.payout === null || state.payout < (p.minPayout ?? 0.7)) f.push(`payout ${state.payout} below minimum ${p.minPayout ?? 0.7}`);
  if (state.balance === null || state.balance < stake) f.push("balance insufficient or unreadable");
  if (p.accountId && state.accountId !== p.accountId) f.push("account mismatch");
  if (now > cmd.expiresAt) f.push("trade window expired");
  return { ok: f.length === 0, failures: f };
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(sel: string, timeoutMs: number): Promise<Element | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const el = document.querySelector(sel);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Executes one verified command inside the broker page. */
export async function executeInPage(cmd: SignedCommand): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const state = readBrokerState();
  switch (cmd.type) {
    case "get_market":
      return { ok: true, data: { market: state.market, price: state.price, payout: state.payout } };
    case "get_balance":
      return { ok: true, data: { balance: state.balance, accountId: state.accountId } };
    case "get_open_contracts":
      return {
        ok: true,
        data: {
          contracts: [...document.querySelectorAll(SELECTORS.openContracts)].map((el) => ({
            tradeId: el.getAttribute("data-trade-id"),
            market: el.getAttribute("data-market"),
            direction: el.getAttribute("data-direction"),
            stake: el.getAttribute("data-stake"),
            entryPrice: el.getAttribute("data-entry-price"),
            expiresAt: el.getAttribute("data-expires-at"),
          })),
        },
      };
    case "place_trade": {
      const check = preTradeChecks(cmd, state);
      if (!check.ok) return { ok: false, data: { failures: check.failures }, error: check.failures.join("; ") };
      const p = cmd.payload as { direction: "UP" | "DOWN"; stake: string; market: string; idempotencyKey: string };
      const stakeInput = document.querySelector<HTMLInputElement>(SELECTORS.stakeInput);
      const button = document.querySelector<HTMLElement>(p.direction === "UP" ? SELECTORS.upButton : SELECTORS.downButton);
      if (!stakeInput || !button) return { ok: false, data: {}, error: "broker controls not found (selectors not configured?)" };
      setInputValue(stakeInput, p.stake);
      if (Number(stakeInput.value) !== Number(p.stake)) return { ok: false, data: {}, error: "stake did not apply" };
      button.click();
      const conf = await waitFor(SELECTORS.confirmation, 5_000);
      if (!conf) return { ok: false, data: { state: "unknown" }, error: "no confirmation — execution state unknown" };
      const c = readConfirmation();
      return {
        ok: Boolean(c.tradeId),
        data: { tradeId: c.tradeId, actualStake: c.actualStake, actualPayout: c.actualPayout, market: p.market, direction: p.direction, price: state.price, timestamp: Date.now(), idempotencyKey: p.idempotencyKey },
      };
    }
    case "cancel_trade":
      return { ok: false, data: {}, error: "fixed-payout contracts cannot be cancelled on this venue" };
    case "get_trade_result":
      return { ok: false, data: {}, error: "configure result parsing for this venue" };
    default:
      return { ok: false, data: {}, error: "unsupported" };
  }
}
