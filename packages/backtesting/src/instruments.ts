import { D, type Money, type MoneyInput } from "@ct/shared";

/** Linear (spot/perp) instrument: P&L proportional to price change. */
export interface LinearInstrument {
  readonly kind: "linear";
  /** Fee per side as a fraction of notional, e.g. "0.00055". */
  readonly feeRate: string;
  /** Slippage per fill in basis points. */
  readonly slippageBps: number;
}

/**
 * Fixed-payout (binary/up-down) instrument. Stake S; win pays S×payout,
 * loss forfeits S×lossFraction. Fees are charged separately.
 */
export interface FixedPayoutInstrument {
  readonly kind: "fixed-payout";
  /** Profit per unit stake on a win (W/S), e.g. "0.8". */
  readonly payout: string;
  /** Loss per unit stake on a loss (L/S), normally "1". */
  readonly lossFraction: string;
  /** Flat fee per trade in account currency. */
  readonly feePerTrade: string;
}

export type InstrumentModel = LinearInstrument | FixedPayoutInstrument;

export interface FixedPayoutEconomics {
  win: Money;
  loss: Money;
  fee: Money;
}

export function fixedPayoutEconomics(stake: MoneyInput, inst: FixedPayoutInstrument): FixedPayoutEconomics {
  const s = D(stake);
  return { win: s.times(inst.payout), loss: s.times(inst.lossFraction), fee: D(inst.feePerTrade) };
}

/** EV = pW − (1−p)L − fee. */
export function fixedPayoutEV(p: number, win: MoneyInput, loss: MoneyInput, fee: MoneyInput = 0): Money {
  if (p < 0 || p > 1) throw new RangeError("probability must be in [0,1]");
  const pp = D(p);
  return pp.times(win).minus(D(1).minus(pp).times(loss)).minus(fee);
}

/** Break-even win probability p = (L + fee) / (W + L). With fee=0: p = L/(W+L). */
export function breakEvenWinRate(win: MoneyInput, loss: MoneyInput, fee: MoneyInput = 0): Money {
  const w = D(win);
  const l = D(loss);
  if (w.plus(l).lte(0)) throw new RangeError("W + L must be positive");
  return l.plus(fee).div(w.plus(l));
}

/** Round-trip cost of a linear trade as a fraction of notional (fees + slippage both sides). */
export function linearRoundTripCost(inst: LinearInstrument): Money {
  return D(inst.feeRate).times(2).plus(D(inst.slippageBps).div(10_000).times(2));
}
