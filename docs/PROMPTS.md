# Prompts

## Master research prompt

The operating objective in `CLAUDE.md` ("Master research objective") is the master prompt. Paste it
at the start of a research session if needed.

## Implementation prompt (for continuing development with Claude Code)

```
You are the principal engineer responsible for implementing the Claude AI Trading Platform described
in this repository. Read CLAUDE.md, README.md, docs/ARCHITECTURE.md, docs/RESEARCH.md, docs/RISK.md
and docs/EXECUTION.md before modifying code. Implement incrementally while preserving the
architecture: TypeScript strict; decimal money; every trading action through the risk engine;
default PAPER; LIVE_TRADING_ENABLED false; immutable strategy versions; reproducible experiments;
auditable promotions; locked datasets untouchable by agents; idempotency keys; mandatory
reconciliation; unknown execution state halts trading. Use Trader.dev MCP for research where
appropriate — inspect its tools first; do not invent tool names or schemas. After every phase run
pnpm typecheck, pnpm test, pnpm build, fix every failure, update docs and commit. Do not begin or
enable live trading. Do not use real capital.
```

## Research Campaign 001

```
We are beginning Research Campaign 001.

Market: BTCUSDT and ETHUSDT. Primary timeframe: 15 minutes.

Objective: investigate whether short-horizon directional strategies can produce statistically
significant positive expectancy after realistic costs.

Create multiple independent hypothesis families. Do not optimise against the full dataset. Use the
locked train, validation and test periods. Run broad research but track every hypothesis tested.
Require robust parameter neighbourhoods. Perform walk-forward analysis. Use Monte Carlo on
finalists. Reject anything with insufficient evidence. Select no more than five mutually diversified
strategies for PAPER incubation. Do not enable live trading.

Generate a complete research report explaining: hypotheses tested, experiments performed, rejected
strategies, surviving strategies, statistical evidence, weaknesses, expected regimes, failure
conditions, and the recommended paper-testing plan.
```

Suggested tool sequence: `get_research_stats` → `list_templates` → for each family
`research_strategy` (state hypothesis/rationale/invalidation) → `optimise_strategy` →
`run_validation` → `record_decision` + `write_journal` → `rank_strategies` → `promote_strategy`
(INCUBATING → PAPER for the selected set) → `start_paper_session` → `generate_report`. Or start the
whole funnel with `start_campaign` and monitor with `get_job`.

## Final goal prompt

"Begin a new ETH 15-minute directional research campaign." — Claude researches hypotheses, creates
and versions strategies, backtests, analyses failures, generates variants, optimises cautiously,
validates on unseen data, runs walk-forward and Monte Carlo, ranks, stores everything, writes
reports, selects paper candidates, starts approved PAPER strategies, monitors performance and
degradation — while the system remains technically incapable of risking real money unless the
separate execution and risk controls explicitly permit it.
