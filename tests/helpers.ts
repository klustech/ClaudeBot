import { openDatabase, Repository, type DatabaseHandle } from "@ct/database";
import { generateSyntheticCandles, makeDataset, type Dataset } from "@ct/market-data";
import { CircuitBreakerBoard, KillSwitch, type RiskLimits, type RiskState, type TradeRequest } from "@ct/risk";
import { D, type Candle } from "@ct/shared";
import type { LockedPeriods, ValidationThresholds } from "@ct/validation";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const EDGE_SYMBOL = "TESTEDGEUSDT";
export const NOISE_SYMBOL = "TESTNOISEUSDT";

export const TEST_PERIODS: LockedPeriods = {
  [EDGE_SYMBOL]: { trainStart: "2023-01-01", trainEnd: "2023-09-01", validationEnd: "2023-11-01", testEnd: "2024-01-01" },
  [NOISE_SYMBOL]: { trainStart: "2023-01-01", trainEnd: "2023-09-01", validationEnd: "2023-11-01", testEnd: "2024-01-01" },
};

export const TEST_THRESHOLDS: ValidationThresholds = {
  minTrades: 100,
  preferredTrades: 500,
  minProfitFactor: 1.2,
  preferredProfitFactor: 1.4,
  maxDrawdown: 0.15,
  minOosExpectancyR: 0,
  minStabilityScore: 60,
  walkForward: { trainBars: 8000, testBars: 3000, stepBars: 3000, minProfitableFraction: 0.5, maxConfigsPerWindow: 6 },
  monteCarlo: { simulations: 2000, maxRuinProbability: 0.01, ruinDrawdown: 0.3, slippageSd: 0.002, missedTradeProbability: 0.03, feeMultiplierMax: 1.5, payoutVariation: 0.05 },
  minDeflatedSharpeProbability: 0.95,
  minConfidence: 80,
  maxStrategyCorrelation: 0.5,
  maxPortfolioStrategies: 5,
  paperGraduationTrades: [100, 250, 500, 1000],
  paperMinProfitFactor: 1.15,
  paperMaxDrawdown: 0.15,
  paperMaxDeviationFromOos: 0.5,
};

const START = Date.UTC(2023, 0, 1);
const BARS = 39_000; // ≈ 406 days of 15m bars

export function edgeDataset(): Dataset {
  return makeDataset(EDGE_SYMBOL, "15m", generateSyntheticCandles({ seed: 11, start: START, bars: BARS, timeframe: "15m", momentumEdge: 0.7, regimeLength: 2000 }), "synthetic-test");
}

export function noiseDataset(): Dataset {
  return makeDataset(NOISE_SYMBOL, "15m", generateSyntheticCandles({ seed: 12, start: START, bars: BARS, timeframe: "15m" }), "synthetic-test");
}

const cache = new Map<string, Dataset>();
export function testDatasetLoader(symbol: string): Dataset {
  if (!cache.has(symbol)) cache.set(symbol, symbol === EDGE_SYMBOL ? edgeDataset() : noiseDataset());
  return cache.get(symbol) as Dataset;
}

export async function memoryRepo(): Promise<{ h: DatabaseHandle; repo: Repository }> {
  const h = await openDatabase({ memory: true });
  return { h, repo: new Repository(h.db) };
}

export function tempKillSwitch(): KillSwitch {
  return new KillSwitch(join(mkdtempSync(join(tmpdir(), "ct-ks-")), "KILL_SWITCH"));
}

export const LIMITS: RiskLimits = {
  MAX_POSITION_PERCENT: 2,
  MAX_STRATEGY_EXPOSURE_PERCENT: 5,
  MAX_PORTFOLIO_EXPOSURE_PERCENT: 15,
  MAX_DAILY_LOSS_PERCENT: 3,
  MAX_WEEKLY_LOSS_PERCENT: 6,
  MAX_DRAWDOWN_PERCENT: 15,
  MAX_CONSECUTIVE_LOSSES: 8,
  MAX_OPEN_POSITIONS: 5,
  MAX_TRADES_PER_HOUR: 12,
  MIN_CONFIDENCE: 80,
  MIN_EDGE: 0.005,
  MAX_SLIPPAGE_BPS: 10,
  MAX_LATENCY_MS: 2000,
  MAX_DATA_STALENESS_MS: 120000,
  MAX_SIGNAL_AGE_MS: 60000,
  MIN_PAYOUT: 0.7,
  MAX_CLOCK_DRIFT_MS: 1000,
  LIVE_CAPITAL_STAGES: ["25", "50", "100", "250", "normal"],
};

export const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

export function baseRequest(over: Partial<TradeRequest> = {}): TradeRequest {
  return {
    idempotencyKey: "ETH-15M-20261006T120000-ETH-15M-MOMENTUM-001-v1",
    strategyVersionId: "ETH-15M-MOMENTUM-001-v1",
    strategyStage: "PAPER",
    liveEligible: false,
    market: "ETHUSDT",
    direction: "UP",
    stake: "10",
    mode: "PAPER",
    confidence: 85,
    edge: 0.02,
    signalTime: NOW - 1000,
    dataAgeMs: 2000,
    requestedBy: "executor",
    ...over,
  };
}

export function baseState(over: Partial<RiskState> = {}): RiskState {
  return {
    equity: D(1000),
    peakEquity: D(1000),
    startOfDayEquity: D(1000),
    startOfWeekEquity: D(1000),
    openPositions: [],
    consecutiveLosses: 0,
    recentTradeTimes: [],
    seenIdempotencyKeys: new Set(),
    stateKnown: true,
    ...over,
  };
}

export function ctx(over: Partial<{ tradingEnabled: boolean; liveTradingEnabled: boolean; killSwitchEngaged: boolean; breakers: CircuitBreakerBoard; now: number }> = {}) {
  return {
    tradingEnabled: true,
    liveTradingEnabled: false,
    killSwitchEngaged: false,
    breakers: new CircuitBreakerBoard(() => NOW),
    now: NOW,
    ...over,
  };
}

export function flatCandles(n: number, start = START, price = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ time: start + i * 900_000, open: price, high: price, low: price, close: price, volume: 1 }));
}
