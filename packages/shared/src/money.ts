import Decimal from "decimal.js";

/**
 * All monetary values are represented with arbitrary-precision decimals.
 * Never use JS `number` for balances, stakes, fees or P&L.
 *
 * Statistical quantities (Sharpe, win-rate, correlations) are dimensionless
 * ratios and are allowed to use `number`.
 */
export const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 40,
});

export type Money = InstanceType<typeof MoneyDecimal>;
export type MoneyInput = Money | string | number;

export function D(value: MoneyInput): Money {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Non-finite monetary value: ${value}`);
  }
  return new MoneyDecimal(value);
}

export const ZERO: Money = D(0);
export const ONE: Money = D(1);

export function sumMoney(values: readonly Money[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(v), ZERO);
}

export function maxMoney(a: Money, b: Money): Money {
  return a.greaterThan(b) ? a : b;
}

export function minMoney(a: Money, b: Money): Money {
  return a.lessThan(b) ? a : b;
}

/** Fixed 8 dp string, suitable for persistence in NUMERIC columns. */
export function moneyToString(value: Money, dp = 8): string {
  return value.toFixed(dp);
}

/** Rounds a stake down to the venue's minimum increment. */
export function roundDownTo(value: Money, increment: MoneyInput): Money {
  const inc = D(increment);
  if (inc.lte(0)) return value;
  return value.div(inc).floor().times(inc);
}

/** Converts a monetary value to a number for statistics/plotting only. */
export function moneyToNumber(value: Money): number {
  return value.toNumber();
}
