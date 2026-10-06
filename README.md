# Claude AI Trading System

An AI-assisted trading **research and execution platform**. Claude Code is the research/operator
intelligence; deterministic software owns data, backtesting, validation, ranking, risk, execution,
kill switches and auditing. Claude can *request* — it can never bypass the risk engine, change
validation rules or enable live trading.

```
research → mass backtest → validation → ranking → paper trading → guarded live execution → monitoring
```

**Safety defaults:** `TRADING_MODE=paper`, `TRADING_ENABLED=false`, `LIVE_TRADING_ENABLED=false`,
exchange adapters `READ_ONLY`. No real capital is used anywhere in development.

## Quick start

```bash
corepack enable && pnpm install
cp .env.example .env
pnpm verify:protected
pnpm test                 # 134 tests: unit, integration, backtest, paper, execution, safety, failure injection
pnpm typecheck && pnpm build

pnpm dev:api              # Local Trading API on :4100 (embedded PGlite if DATABASE_URL is unset)
pnpm dev:dashboard        # Mission Control on :3000
claude                    # Claude Code picks up CLAUDE.md and .mcp.json (trading-control + trader-dev)
```

Run a campaign from the CLI (real data first: `pnpm data:fetch --symbol ETHUSDT --timeframe 15m`):

```bash
pnpm research:campaign --markets BTCUSDT,ETHUSDT --timeframe 15m --name "Campaign 001"
```

Paper trading: `TRADING_MODE=paper TRADING_ENABLED=true pnpm dev:executor`.
Emergency stop: `pnpm trading:kill`.

## Repository

```
apps/        api (Fastify) · dashboard (Next.js) · worker (BullMQ) · executor (trading runtime host)
packages/    shared · core · database · strategies · backtesting · validation · optimisation · scoring
             risk · portfolio · execution · exchanges · market-data · telemetry · research · runtime
mcp/         trading-control (Claude's operator tools; no arbitrary-order tool)
extension/   Chrome MV3 execution bridge (fallback for fixed-payout venues without an API)
strategies/  lifecycle mirror (pnpm strategies:export)    experiments/  reports/
config/      risk limits, validation thresholds, live permissions, instruments (protected + hash-pinned)
validation/  locked TRAIN/VALIDATION/TEST periods (protected)
tests/       unit · integration · backtest · paper · execution · safety · failure
```

## What makes it more rigorous than "AI picks trades"

- Immutable, hash-verified strategy versions with genome lineage (DB triggers forbid edits)
- Locked TRAIN / VALIDATION / TEST / FORWARD periods; TEST only after freezing, exactly once
- TRAIN-only optimisation with a composite, penalised objective
- Parameter-stability score and heatmaps, rolling walk-forward, 10k-path Monte Carlo
- Deflated Sharpe ratio using the programme-wide number of configurations tested
- Benchmarks (random, buy-and-hold, SMA, momentum, no-trade) and regime analysis
- Confidence scoring, correlation-capped diversified selection, portfolio risk allocation
- Deterministic risk engine, circuit breakers, file-based global kill switch
- Idempotency keys end-to-end, minute-by-minute reconciliation, fail-closed on unknown state
- Realistic paper venue (latency, misses, spread, slippage, fees, payouts, rejects, disconnects)
- Degradation detection with automatic demotion; no live re-optimisation
- Progressive live capital stages, human-only approval and live activation
- Append-only audit trail of every Claude decision; research journal and daily/weekly reports

## Documentation

[CLAUDE.md](CLAUDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Research](docs/RESEARCH.md) ·
[Risk](docs/RISK.md) · [Execution](docs/EXECUTION.md) · [Operations](docs/OPERATIONS.md) ·
[Prompts](docs/PROMPTS.md)

> Trading involves substantial risk of loss. Historical or simulated performance does not imply
> future results. This software is a research tool; live trading is disabled by default and must
> only ever be enabled deliberately, with capital you have designated as experimental.
