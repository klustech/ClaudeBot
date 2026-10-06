# Architecture

```
                      CLAUDE CODE
                           │
            ┌──────────────┴───────────────┐
            │                              │
      Trader.dev MCP              trading-control MCP (mcp/trading-control)
      (research/backtests)                 │  HTTP + CONTROL_API_TOKEN
            │                              ▼
            │                     Local Trading API (apps/api, Fastify :4100)
            │                              │
            └── import_trader_dev ────────►│
                                           ▼
                 RESEARCH ORCHESTRATOR (packages/research)
                           │
              ┌────────────┼─────────────┐
              ▼            ▼             ▼
          Strategy      Experiment    Validation
           Store           DB           Engine
        (immutable    (PostgreSQL /   (packages/validation)
          versions)     Drizzle)
              └────────────┼─────────────┘
                           ▼
                    STRATEGY RANKER (packages/scoring, portfolio)
                           ▼
                    PORTFOLIO ENGINE (packages/portfolio)
                           ▼
       Executor (apps/executor :4200, loopback) ── TradingRuntime (packages/runtime)
                           ▼
                      RISK ENGINE (packages/risk)  ← kill switch file, circuit breakers
                           ▼
                  ExecutionService (packages/execution)
              ┌────────────┼─────────────┐
              ▼            ▼             ▼
            PAPER        TESTNET        LIVE
      PaperExecution   Bybit adapter   Bybit adapter / Browser bridge
         Adapter      (packages/exchanges)   (extension/)
```

All components persist to PostgreSQL (or embedded PGlite in development). Mission Control
(`apps/dashboard`) reads the API. Alerts fan out to console + webhook and are stored.

## Packages

| Package | Responsibility |
|---|---|
| `shared` | Decimal money, types, config (safe defaults), hashing, seeded RNG, statistics, ids |
| `telemetry` | pino logger (secret redaction), latency traces per stage, alerting |
| `core` | lifecycle state machine, immutable strategy versions + genome, promotion gates, protected-config hashing |
| `market-data` | dataset versioning, Binance klines downloader, live/replay streams, synthetic generator |
| `strategies` | indicators and 11 research templates + 5 benchmarks |
| `backtesting` | deterministic engine (next-bar fills, linear & fixed-payout), full metric set, reproducibility manifest, benchmarks |
| `optimisation` | parameter grids, composite objective with penalties, TRAIN-only optimiser |
| `validation` | locked periods + `DataPartitioner`, walk-forward, Monte Carlo, parameter stability, deflated Sharpe, regimes, full pipeline, holdout |
| `scoring` | research/backtest/validation/stability/risk/forward scores → confidence 0-100 |
| `portfolio` | correlation, diversified selection, sizing (fixed, % risk, vol-adjusted, fractional Kelly), risk allocation, regime selector |
| `risk` | protected limits, `RiskEngine`, circuit breakers, kill switch, degradation detection, progressive capital |
| `execution` | `ExecutionAdapter` interface, paper venue, ledger, `ExecutionService`, reconciliation, kill procedure, signed bridge commands, browser adapter |
| `exchanges` | Bybit v5 adapter (READ_ONLY → TESTNET → LIVE) |
| `database` | Drizzle schema, migrations with immutability triggers, repository |
| `research` | research orchestrator, strategy lifecycle service, campaigns, journal, reports, paper evaluation, Trader.dev importer |
| `runtime` | trading runtime: signals → risk → execution → settlement → persistence → degradation |

## Apps

| App | Port | Notes |
|---|---|---|
| `api` | 4100 | the *Local Trading API*; research jobs inline or via BullMQ; proxies trading to executor |
| `executor` | 4200 (loopback) | owns risk engine + venue adapter; paper/testnet/live; reconciliation every minute |
| `worker` | – | BullMQ research worker + daily/weekly report scheduler |
| `dashboard` | 3000 | Mission Control (14 pages) |
| `mcp/trading-control` | stdio | Claude's operator tool surface |
| `extension` | – | MV3 Chrome extension (fallback execution bridge) |

## Key invariants

1. No component reaches a venue except through `ExecutionService.requestTrade`, which always calls
   `RiskEngine.evaluate` first. The API has no order endpoint; the MCP has no order tool.
2. Uncertain state = no new trade: timeouts, disconnects, persistence failures, reconciliation
   mismatches and unexpected fills all trip breakers that only a named human can reset.
3. Strategy versions are immutable (hash + DB trigger); decisions/backtests/risk events are
   append-only (DB triggers).
4. TEST data is reachable only for frozen versions, once.
5. Protected configuration is hash-pinned; services refuse to start if it changes.
