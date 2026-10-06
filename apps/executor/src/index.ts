import { assertProtectedFilesIntact } from "@ct/core";
import { openDatabase, Repository } from "@ct/database";
import { BybitExecutionAdapter } from "@ct/exchanges";
import { BridgeQueue, BrowserExecutionAdapter } from "@ct/execution";
import { BinanceKlineStream, ReplayStream, fetchBinanceKlines, type MarketStream } from "@ct/market-data";
import { loadInstrument, loadMarketDataset } from "@ct/research";
import { loadLivePermissions, loadRiskLimits, stageCeiling } from "@ct/risk";
import { TradingRuntime } from "@ct/runtime";
import { loadConfig, ManualClock, TIMEFRAME_MS, systemClock, type Clock } from "@ct/shared";
import { alerterFromEnv, createLogger } from "@ct/telemetry";
import { DataPartitioner, loadLockedPeriods, loadValidationThresholds } from "@ct/validation";
import { buildExecutorServer } from "./server";

const log = createLogger("executor");
const cfg = loadConfig();
assertProtectedFilesIntact();

if (!["PAPER", "TESTNET", "LIVE"].includes(cfg.TRADING_MODE)) {
  log.warn({ mode: cfg.TRADING_MODE }, "TRADING_MODE does not trade; executor will idle. Use TRADING_MODE=PAPER for paper trading.");
}

const h = await openDatabase();
const repo = new Repository(h.db);
const limits = loadRiskLimits();
const thresholds = loadValidationThresholds();
const livePerms = loadLivePermissions();
const instrument = loadInstrument(process.env.INSTRUMENT).model;
const alerter = alerterFromEnv();
const feed = process.env.PAPER_FEED ?? "binance";
const clock: Clock = feed === "replay" ? new ManualClock(Date.now()) : systemClock;
const bridge = cfg.BRIDGE_SIGNING_SECRET ? new BridgeQueue(cfg.BRIDGE_SIGNING_SECRET) : undefined;
const mode = cfg.TRADING_MODE === "TESTNET" || cfg.TRADING_MODE === "LIVE" ? cfg.TRADING_MODE : "PAPER";

const runtime = new TradingRuntime({
  repo,
  limits,
  thresholds,
  alerter,
  logger: log,
  instrument,
  mode,
  clock,
  startingBalance: cfg.PAPER_STARTING_BALANCE,
  currency: cfg.CURRENCY,
  flags: () => {
    const ceiling = stageCeiling(limits.LIVE_CAPITAL_STAGES, livePerms.currentCapitalStage);
    return {
      tradingEnabled: cfg.TRADING_ENABLED && ["PAPER", "TESTNET", "LIVE"].includes(cfg.TRADING_MODE),
      liveTradingEnabled: cfg.LIVE_TRADING_ENABLED,
      ...(ceiling ? { liveStakeCeiling: ceiling } : {}),
      livePermittedStrategies: livePerms.liveStrategies,
    };
  },
  ...(mode !== "PAPER"
    ? {
        adapterFactory: () => {
          if (cfg.EXCHANGE === "browser-bridge") {
            if (!bridge) throw new Error("BRIDGE_SIGNING_SECRET required for browser-bridge");
            return new BrowserExecutionAdapter(bridge, mode);
          }
          if (!cfg.EXCHANGE_API_KEY || !cfg.EXCHANGE_API_SECRET) throw new Error("Exchange credentials missing");
          return new BybitExecutionAdapter({
            apiKey: cfg.EXCHANGE_API_KEY,
            apiSecret: cfg.EXCHANGE_API_SECRET,
            mode: cfg.EXCHANGE_READ_ONLY ? "READ_ONLY" : mode,
            liveTradingEnabled: cfg.LIVE_TRADING_ENABLED,
          });
        },
      }
    : {}),
});

const sessionIds = process.env.PAPER_STRATEGIES ? process.env.PAPER_STRATEGIES.split(",") : undefined;
const reload = async (): Promise<void> => {
  const loaded = await runtime.loadStrategies(sessionIds);
  log.info({ strategies: loaded.map((s) => s.id) }, "strategies loaded");
};
await reload();

if (mode === "PAPER") {
  runtime.sessionId =
    process.env.PAPER_SESSION_ID ??
    (await repo.createPaperSession({
      name: `paper ${new Date().toISOString()}`,
      startingBalance: cfg.PAPER_STARTING_BALANCE,
      currency: cfg.CURRENCY,
      strategyVersionIds: runtime.activeStrategies().map((s) => s.id),
      config: { feed, instrument },
    }));
} else {
  runtime.sessionId = await repo.createLiveSession({
    mode,
    venue: cfg.EXCHANGE,
    capitalStage: livePerms.currentCapitalStage,
    strategyVersionIds: runtime.activeStrategies().map((s) => s.id),
    config: { instrument },
  });
}
await repo.systemEvent({ source: "executor", level: "info", kind: "system_restart", message: `executor started in ${mode} (feed=${feed})` });
await alerter.alert("system_restart", "info", `Executor started in ${mode}`);

const streams: MarketStream[] = [];
for (const { market, timeframe } of runtime.marketsNeeded()) {
  if (feed === "replay") {
    const ds = loadMarketDataset(market, timeframe);
    const part = new DataPartitioner(ds, loadLockedPeriods());
    const fwd = part.forward();
    const first = fwd[0];
    if (!first) {
      log.warn({ market }, "no FORWARD data after testEnd to replay");
      continue;
    }
    runtime.seedHistory(market, part.warmupBefore(first.time, 1500));
    const s = new ReplayStream(market, timeframe, fwd, clock as ManualClock);
    runtime.attachStream(market, s);
    streams.push(s);
  } else {
    try {
      const end = Date.now();
      runtime.seedHistory(market, await fetchBinanceKlines(market, timeframe, end - 1500 * TIMEFRAME_MS[timeframe], end));
    } catch (err) {
      log.error({ err, market }, "history fetch failed; strategies will warm up from the live stream");
    }
    const s = new BinanceKlineStream(market, timeframe);
    runtime.attachStream(market, s);
    streams.push(s);
  }
}

const server = buildExecutorServer(runtime, {
  ...(process.env.EXECUTOR_TOKEN ? { token: process.env.EXECUTOR_TOKEN } : {}),
  ...(process.env.HUMAN_API_TOKEN ? { humanToken: process.env.HUMAN_API_TOKEN } : {}),
  ...(bridge ? { bridge } : {}),
  onReload: reload,
});
const port = Number(process.env.EXECUTOR_PORT ?? 4200);
await server.listen({ host: process.env.EXECUTOR_HOST ?? "127.0.0.1", port });
log.info({ port }, "executor control server listening");

const timers: NodeJS.Timeout[] = [];
if (feed !== "replay") {
  timers.push(
    setInterval(() => {
      for (const s of streams) {
        const p = s.lastPrice();
        if (p !== null) runtime.onPrice(s.symbol, p);
      }
      void runtime.settle();
    }, 1000),
    setInterval(() => runtime.watchdog(), 15_000),
  );
}
timers.push(setInterval(() => void runtime.reconcileNow(), 60_000));

if (feed === "replay") {
  await Promise.all(streams.map((s) => s.start()));
  await runtime.settle();
  log.info(runtime.status(), "replay complete");
} else {
  for (const s of streams) void s.start();
}

const shutdown = async (sig: string): Promise<void> => {
  log.warn({ sig }, "shutting down: no new trades will be placed");
  for (const t of timers) clearInterval(t);
  for (const s of streams) await s.stop();
  await repo.systemEvent({ source: "executor", level: "warning", kind: "shutdown", message: `executor stopped (${sig})` });
  await server.close();
  await h.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
