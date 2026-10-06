# Research & Validation

## Dataset separation (locked periods)

`validation/locked-periods.json` (protected, hash-pinned):

```
2019 ─────────────────────── 2026
TRAIN        2019-2023   optimisation allowed
VALIDATION   2024        model comparison only
TEST         2025        frozen versions only, evaluated once
FORWARD      2026+       paper trading
```

`DataPartitioner` enforces this and logs every partition access. `test()` throws
`LockedPeriodViolation` unless the strategy version has `frozenAt` set.

## Pipeline

1. **Hypothesis** – `StrategyService.create` registers an immutable `v1` (`IDEA`).
2. **TRAIN backtest** – `ResearchService.researchAndBacktest` (→ `RESEARCH` → `BACKTESTED`).
3. **Optimisation** – `optimiseVersion`: grid/seeded-random search on TRAIN with the composite
   objective; the best parameter set becomes a new child version (genome: parent + mutations +
   generation); the parent is retired as superseded. Every configuration counts toward the
   programme-wide trial total.
4. **Validation laboratory** – `validate`:
   - TRAIN minimum requirements gate (trades ≥ 300, PF ≥ 1.2, DD ≤ 15 %, positive expectancy)
   - VALIDATION (OOS) backtest with indicator warm-up and no look-ahead
   - parameter stability (neighbourhood ±2 steps, heatmap) → score 0-100
   - walk-forward (12 m train / 3 m test / 3 m step at 15 m; re-optimised per window)
   - Monte Carlo (10,000 bootstrap paths; trade order, slippage, fees, latency, missed trades,
     payout variation) → median / 5th / 95th percentile, P(ruin), E[max DD], E[losing streak]
   - deflated Sharpe ratio using the **programme-wide** number of configurations tested
   - benchmarks: random, buy-and-hold (Sharpe), SMA cross, simple momentum, no-trade
   - regime breakdown (TREND_UP/DOWN, RANGE, HIGH/LOW_VOLATILITY, TRANSITION); fails if the edge is
     confined to one regime
5. **Freeze → holdout** – passing versions are frozen and evaluated once on TEST.
6. **Scoring** – research, backtest, validation, stability, risk, forward → confidence (approval
   threshold 80; without forward evidence confidence is capped below the threshold).
7. **Promotion** – `INCUBATING` if everything passes; otherwise `RETIRED` with reasons, journal
   entry and suggested next experiment.
8. **Selection** – `rankAndSelect` picks ≤ 5 strategies with pairwise |ρ| ≤ 0.5 on daily return
   streams and at most one per family × market.

All thresholds live in `config/validation-thresholds.json` (protected).

## Composite objective

```
score = 0.25·expectancy + 0.20·profit_factor + 0.15·sharpe + 0.15·OOS
      + 0.10·stability + 0.10·drawdown + 0.05·sample_size
```

Penalties: small sample (multiplicative), drawdown above limit (−30), stability < 50 (−20),
train/OOS divergence (−20), losing streak > 15 (−10), non-positive expectancy (−25).

## Fixed-payout markets

For stake S, win profit W, loss L: `EV = pW − (1−p)L` and break-even `p = L/(W+L)`
(e.g. W = 8, L = 10 → 55.56 %). Fees are separate. Configure the venue's payout in
`config/instruments.json` (`fixed-payout-80`). Ties settle as losses (conservative).

## Reproducibility

Every backtest stores a manifest: engine version, code hash (template source + engine), dataset
version (content hash), parameters, instrument/fee model, stake, capital, seed, date range and a
run hash. Same manifest ⇒ identical result (tested).

## Trader.dev integration

Install once:

```
claude mcp add --transport http --scope user trader-dev https://mcp.trader.dev/mcp
claude mcp list
```

(also declared in `.mcp.json`). Authenticate with the Trader.dev API key through Claude Code — the
key is never given to this backend.

Do not guess Trader.dev tool names: list them, run one, inspect its output, then map results into
this normalised format and call `import_trader_dev_backtest` (MCP) or
`POST /api/research/import/trader-dev`:

```json
{
  "strategyVersionId": null,
  "externalStrategyId": "…",
  "externalBacktestId": "…",
  "market": "ETHUSDT",
  "timeframe": "15m",
  "template": "trader-dev",
  "parameters": { "rsi": 14 },
  "period": { "from": "2019-01-01", "to": "2023-12-31" },
  "partition": "train",
  "feeModel": { "takerFee": 0.00055 },
  "metrics": { "netProfit": "123.4", "tradeCount": 812, "winRate": 0.54, "profitFactor": 1.31, "sharpe": 1.1, "maxDrawdown": 0.08 },
  "trades": [{ "entryTime": "…", "exitTime": "…", "direction": "LONG", "entryPrice": 1, "exitPrice": 1.01, "stake": "10", "pnl": "0.1", "fees": "0.01" }],
  "equity": [{ "time": "…", "equity": 1000.5 }],
  "rawToolName": "<the Trader.dev tool you called>"
}
```

Imported runs count toward the trial total and appear in Mission Control. Trader.dev results must
respect the same locked periods: only TRAIN/VALIDATION windows may be requested from Trader.dev
during research.

## Data

- Real: `pnpm data:fetch --symbol ETHUSDT --timeframe 15m --from 2019-01-01` (Binance public API).
- Synthetic (`SYNTH*` symbols) is generated deterministically for offline development and tests and
  must never justify paper or live deployment.

## Research journal & reports

- `reports/research/YYYY-MM-DD.md` — per-experiment entries (hypothesis, result, reason, observed,
  next). Also stored in `research_journal`.
- `reports/campaigns/*.md` — campaign reports (hypotheses, rejections, survivors, evidence,
  weaknesses, regimes, failure conditions, paper plan).
- `reports/daily/*.md`, `reports/weekly/*.md` — scheduled by the worker.
