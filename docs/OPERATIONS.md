# Operations

## Local development

```bash
corepack enable && pnpm install
cp .env.example .env               # edit tokens; leave TRADING_ENABLED/LIVE_TRADING_ENABLED false
pnpm verify:protected              # protected config must be intact
pnpm test && pnpm typecheck && pnpm build

# Without Docker: embedded PGlite (single process at a time — use Postgres to run api+executor+worker together)
pnpm dev:api                       # :4100
pnpm dev:dashboard                 # :3000 (API_URL=http://127.0.0.1:4100)

# With Postgres/Redis
docker compose up -d postgres redis
DATABASE_URL=postgres://trader:trader@127.0.0.1:5432/claude_trader pnpm db:migrate
pnpm dev:api & pnpm dev:worker & pnpm dev:executor & pnpm dev:dashboard
```

Claude Code: `cd claude-trader && claude` — `.mcp.json` registers `trading-control` (local) and
`trader-dev` (remote). `CLAUDE.md` is loaded automatically.

## Data

```bash
pnpm data:fetch --symbol BTCUSDT --timeframe 15m --from 2019-01-01 --to 2026-10-01
pnpm data:fetch --symbol ETHUSDT --timeframe 15m --from 2019-01-01 --to 2026-10-01
pnpm data:synthetic                # offline only
```

## Research

```bash
pnpm research:campaign --markets BTCUSDT,ETHUSDT --timeframe 15m --name "Campaign 001"
pnpm report:daily && pnpm report:weekly
pnpm strategies:export             # mirror lifecycle into strategies/<stage>/
```

or from Claude Code via the `trading-control` tools.

## Paper trading

```bash
TRADING_MODE=paper TRADING_ENABLED=true PAPER_FEED=binance pnpm dev:executor
```

The executor loads every strategy in PAPER/APPROVED/LIVE (or `PAPER_STRATEGIES=id1,id2`), warms up
from REST history, then trades closed candles. `POST /api/paper/reload` picks up new PAPER
strategies.

## VPS deployment (Ubuntu)

- Docker: `docker compose up -d --build` (set `EXECUTOR_TOKEN`, `CONTROL_API_TOKEN`,
  `HUMAN_API_TOKEN` in `.env`; the executor requires `EXECUTOR_TOKEN` when not on loopback).
- systemd: build with `pnpm build`, copy `deploy/systemd/*.service` to `/etc/systemd/system/`,
  `systemctl enable --now claude-trader-{api,worker,executor}`.
- nginx: `deploy/nginx.conf` exposes only the dashboard, behind TLS + basic auth. Keep the API and
  executor on loopback.
- Backups: `pg_dump claude_trader | gzip > backups/$(date +%F).sql.gz` daily (cron), plus
  `reports/` and `data/`. Restore with `psql`; migrations are idempotent (`pnpm db:migrate`).
- Watchdog: systemd `Restart=on-failure`; the executor's watchdog trips `market_feed_stale`, and
  reconciliation runs every minute. Restarts are recorded as `system_restart` events/alerts.

## Incident checklist

1. `pnpm trading:kill --reason "…"` (or `disable_trading` from Claude).
2. `pnpm trading:status`; inspect Mission Control → Risk / System Health.
3. Reconcile with the venue manually; fix the root cause.
4. Human: reset breakers (`POST /api/breakers/reset` with `HUMAN_API_TOKEN`), then
   `pnpm trading:kill --release --by "Name"`.

## Blueprint coverage

| Blueprint section | Implementation |
|---|---|
| 1-4 stack & monorepo | pnpm workspaces, TypeScript strict, Fastify, Next.js + Tailwind + Recharts + Lightweight Charts, Drizzle/PostgreSQL (PGlite fallback), BullMQ/Redis, Vitest, Docker |
| 5 Trader.dev MCP | `.mcp.json`, `docs/RESEARCH.md`, `import_trader_dev_backtest` |
| 6 CLAUDE.md modes | `CLAUDE.md`, `TRADING_MODE` (default PAPER for services; RESEARCH for Claude) |
| 7-8 lifecycle & records | `packages/core` lifecycle/gates/versions, `strategy_versions` |
| 9-10 research factory | `packages/strategies` (11 families), `runCampaign`, grids |
| 11-12 experiment DB & decisions | `packages/database` (all listed tables + campaigns/journal/alerts), append-only triggers |
| 13-14 dataset separation | `validation/locked-periods.json`, `DataPartitioner`, protected hashes |
| 15 metrics | `packages/backtesting/src/metrics.ts` |
| 16 fixed payout | `instruments.ts`, fixed-payout backtests and paper venue |
| 17-18 optimisation & stability | `packages/optimisation`, `parameterStability` |
| 19-21 WF / MC / multiple testing | `walk-forward.ts`, `monte-carlo.ts`, `deflated-sharpe.ts` |
| 22-25 scoring, thresholds, diversification, portfolio | `packages/scoring`, `config/validation-thresholds.json`, `selectDiversified`, `allocateRisk` |
| 26-27 sizing & Kelly | `packages/portfolio/src/sizing.ts` |
| 28-31 risk engine, breakers, kill switch | `packages/risk`, `pnpm trading:kill` |
| 32-34 paper engine & gate | `PaperExecutionAdapter`, `TradingRuntime`, `evaluatePaper` |
| 35-37 execution adapters | `packages/execution`, `packages/exchanges` (Bybit) |
| 38-44 browser extension | `extension/` |
| 45-48 local MCP & restrictions | `mcp/trading-control`, hooks + deny rules |
| 49-52 Mission Control | `apps/dashboard` (Overview, Strategies, Inspector, Backtests, Experiments, Optimisation, Validation, Paper, Portfolio, Live, Decisions, Journal, Risk, System, Settings) |
| 53-55 journal & genome | `writeJournal`, genome columns, failure diagnosis → next experiment |
| 56-57 regimes & adaptive portfolio | `classifyRegimes`, `regimeBreakdown`, `eligibleForRegime`, regime-switching template |
| 58-61 degradation, no live re-opt, live gating | `detectDegradation`, runtime auto-demotion, LIVE gate |
| 61-62 progressive capital | `progressive-capital.ts`, `LIVE_CAPITAL_STAGES`, `live-permissions.json` |
| 63-64 secrets | `.env.example`, deny `Read(.env)`, log redaction |
| 65-68 telemetry, alerts, reports | `LatencyTrace`, `Alerter`, daily/weekly reports (worker schedule) |
| 69-70 tests & failure injection | `tests/{unit,integration,backtest,paper,execution,safety,failure}` |
| 71-73 reconciliation, idempotency, reproducibility | `reconcile`, idempotency keys + unique index + `orderLinkId`, manifests |
| 74 benchmarks | `compareToBenchmarks` |

## Known limitations / next steps

- Real data and Trader.dev were not reachable from the build environment; integration tests use
  deterministic synthetic data and mocked HTTP. Run `pnpm data:fetch` and the Trader.dev workflow
  on your machine before Campaign 001.
- Additional venues (Binance, OKX, Blofin, Toobit, WeeX) are interface-ready but not implemented.
- The browser extension needs venue-specific selectors and result parsing before use.
- Docker images were authored but not built in this environment.
