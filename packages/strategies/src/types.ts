import type { Candle, ParamSet, ParamValue, Regime, Signal } from "@ct/shared";

export type ParamSpec =
  | { readonly type: "int"; readonly min: number; readonly max: number; readonly step: number }
  | { readonly type: "float"; readonly min: number; readonly max: number; readonly step: number }
  | { readonly type: "choice"; readonly values: readonly ParamValue[] };

export interface ExitRule {
  /** Maximum holding period in bars (fixed expiry for fixed-payout instruments). */
  readonly holdBars: number;
  /** Optional ATR-multiple stop loss (linear instruments only). */
  readonly stopAtr?: number;
  /** Optional ATR-multiple take profit (linear instruments only). */
  readonly takeAtr?: number;
}

export interface SignalContext {
  /** Seed for stochastic strategies (random benchmark). */
  readonly seed: number;
}

export interface SignalOutput {
  /** Entry intent evaluated at each bar's CLOSE; executed on the next bar's open. */
  readonly signals: readonly Signal[];
  readonly exit: ExitRule;
}

export interface StrategyTemplate {
  readonly key: string;
  readonly family: string;
  readonly name: string;
  readonly description: string;
  /** Default falsifiable hypothesis for this template family. */
  readonly hypothesis: string;
  readonly expectedRegimes: readonly Regime[];
  readonly params: Readonly<Record<string, ParamSpec>>;
  readonly defaults: ParamSet;
  readonly isBenchmark?: boolean;
  generate(candles: readonly Candle[], params: ParamSet, ctx: SignalContext): SignalOutput;
}

export function num(params: ParamSet, key: string): number {
  const v = params[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Parameter ${key} must be a finite number`);
  return v;
}

export function bool(params: ParamSet, key: string): boolean {
  const v = params[key];
  if (typeof v !== "boolean") throw new Error(`Parameter ${key} must be boolean`);
  return v;
}
