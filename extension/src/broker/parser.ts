import { SELECTORS } from "./selectors";

export interface BrokerState {
  accountId: string | null;
  balance: number | null;
  market: string | null;
  price: number | null;
  payout: number | null;
}

function text(root: ParentNode, sel: string): string | null {
  const el = root.querySelector(sel);
  return el?.textContent?.trim() ?? null;
}

export function parseNumber(s: string | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Payout shown as "80%" → 0.8, or "0.8" → 0.8. */
export function parsePayout(s: string | null): number | null {
  const n = parseNumber(s);
  if (n === null) return null;
  return s?.includes("%") || n > 1 ? n / 100 : n;
}

export function readBrokerState(root: ParentNode = document): BrokerState {
  return {
    accountId: text(root, SELECTORS.accountId),
    balance: parseNumber(text(root, SELECTORS.balance)),
    market: text(root, SELECTORS.marketName),
    price: parseNumber(text(root, SELECTORS.price)),
    payout: parsePayout(text(root, SELECTORS.payout)),
  };
}

export function readConfirmation(root: ParentNode = document): { tradeId: string | null; actualStake: number | null; actualPayout: number | null } {
  return {
    tradeId: text(root, SELECTORS.confirmationTradeId),
    actualStake: parseNumber(text(root, SELECTORS.confirmationStake)),
    actualPayout: parsePayout(text(root, SELECTORS.confirmationPayout)),
  };
}
