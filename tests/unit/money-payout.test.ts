import { breakEvenWinRate, fixedPayoutEV, linearRoundTripCost } from "@ct/backtesting";
import { D, roundDownTo, sumMoney } from "@ct/shared";
import { describe, expect, it } from "vitest";

describe("decimal money", () => {
  it("avoids floating point error", () => {
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(sumMoney([D("0.1"), D("0.2"), D("0.3")]).eq("0.6")).toBe(true);
  });
  it("rejects non-finite numbers", () => {
    expect(() => D(Number.NaN)).toThrow();
    expect(() => D(Infinity)).toThrow();
  });
  it("rounds stakes down to venue increments", () => {
    expect(roundDownTo(D("12.37"), "0.5").toString()).toBe("12");
  });
});

describe("fixed-payout economics", () => {
  it("computes break-even p = L/(W+L): stake 10, win 8, loss 10 → 55.56%", () => {
    expect(breakEvenWinRate("8", "10").toDecimalPlaces(4).toString()).toBe("0.5556");
  });
  it("EV = pW − (1−p)L", () => {
    expect(fixedPayoutEV(0.6, "8", "10").toString()).toBe("0.8");
    expect(fixedPayoutEV(10 / 18, "8", "10").abs().lt("1e-12")).toBe(true);
  });
  it("includes fees separately", () => {
    expect(fixedPayoutEV(0.6, "8", "10", "0.5").toString()).toBe("0.3");
    expect(breakEvenWinRate("8", "10", "0.5").gt(breakEvenWinRate("8", "10"))).toBe(true);
  });
  it("linear round-trip cost includes fees and slippage on both sides", () => {
    expect(linearRoundTripCost({ kind: "linear", feeRate: "0.0005", slippageBps: 2 }).toString()).toBe("0.0014");
  });
});
