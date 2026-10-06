# Risk

The risk engine (`packages/risk/src/engine.ts`) sits between every requester (Claude, executor,
human) and every venue. It can only reject; it never increases a stake. Missing information is a
rejection.

## Limits (`config/risk-limits.json`, protected)

| Limit | Default |
|---|---|
| MAX_POSITION_PERCENT | 2 % of equity |
| MAX_STRATEGY_EXPOSURE_PERCENT | 5 % |
| MAX_PORTFOLIO_EXPOSURE_PERCENT | 15 % |
| MAX_DAILY_LOSS_PERCENT | 3 % |
| MAX_WEEKLY_LOSS_PERCENT | 6 % |
| MAX_DRAWDOWN_PERCENT | 15 % |
| MAX_CONSECUTIVE_LOSSES | 8 |
| MAX_OPEN_POSITIONS | 5 |
| MAX_TRADES_PER_HOUR | 12 |
| MIN_CONFIDENCE | 80 |
| MIN_EDGE | 0.005 (EV per unit stake) |
| MAX_SLIPPAGE_BPS | 10 |
| MAX_LATENCY_MS | 2000 |
| MAX_DATA_STALENESS_MS | 120000 |
| MAX_SIGNAL_AGE_MS | 60000 |
| MIN_PAYOUT | 0.70 |
| MAX_CLOCK_DRIFT_MS | 1000 |
| LIVE_CAPITAL_STAGES | 25, 50, 100, 250, normal |

Additional checks: trading enabled, kill switch, open breakers (global or per strategy), known
reconciled state, mode/stage compatibility (`PAPER` needs PAPER+, `LIVE` needs LIVE stage,
`liveEligible`, listing in `config/live-permissions.json`, `LIVE_TRADING_ENABLED` and a capital-stage
ceiling), idempotency key present and unseen, valid decimal stake, expected-vs-offered payout.

## Circuit breakers

`api_disconnected, market_feed_stale, unexpected_payout, spread_explosion, execution_mismatch,
balance_mismatch, max_daily_loss, max_weekly_loss, drawdown_threshold, strategy_degradation,
broker_inconsistent, clock_drift, execution_unknown_state, reconciliation_failed,
protected_config_tampered`.

Breakers trip automatically and **stay open** until a named human resets them
(`POST /api/breakers/reset` with `HUMAN_API_TOKEN`). Every trip is a risk event + critical alert.

## Kill switch

- `TRADING_ENABLED=false` (default) and `LIVE_TRADING_ENABLED=false` (default).
- `pnpm trading:kill` writes `runtime/KILL_SWITCH` (seen by every process), notifies the API →
  executor which cancels pending orders, records a risk event and sends a critical alert. Logs are
  never deleted. Works even if the API is down.
- Claude can engage it (`disable_trading`) but never release it. Release:
  `pnpm trading:kill --release --by "Your Name"` (human only).

## Position sizing

Fixed stake, percentage risk, volatility-adjusted and fractional Kelly
(`f* = (bp − q)/b`, effective = Kelly × multiplier (default **0.1**, max 0.5) × confidence discount
× regime discount, capped by MAX_POSITION_PERCENT). Full Kelly is refused. Portfolio risk budgets
are allocated by inverse volatility × confidence with a per-strategy cap.

## Degradation

`detectDegradation` compares rolling paper/live returns with the strategy's OOS distribution
(one-sided z-tests on expectancy and win rate at α = 0.01, minimum 30 trades, drawdown > 1.5×
expected). On degradation the runtime trips a strategy-scoped breaker and moves
`LIVE/PAPER/APPROVED → DEGRADED` (→ `PAPER` for live). It never re-optimises a live strategy.

## Paper promotion gate

Graduation is by trade count (100 → 250 → 500 → 1,000), requiring positive expectancy,
PF ≥ 1.15, DD ≤ 15 %, deviation from OOS expectancy ≤ 50 %, no infrastructure breaker events and no
degradation. `APPROVED` and `LIVE` require a human operator token; evidence is computed server-side.

## Progressive live capital

Stage 0 paper → £25 → £50 → £100 → £250 → normal (`config/live-permissions.json`
`currentCapitalStage`). Promotion is performance-based (`evaluateCapitalPromotion`), one stage at a
time, and is a human edit of a protected file. Use a dedicated sub-account with withdrawals disabled.

## Protected configuration

`validation/locked-periods.json`, `config/risk-limits.json`, `config/validation-thresholds.json`,
`config/live-permissions.json` are pinned in `config/PROTECTED.sha256`. API, worker, executor and
the campaign CLI refuse to start if any differs. A human reviews a change, then runs
`pnpm verify:protected --update`. Claude Code is blocked from editing them by
`.claude/settings.json` deny rules and the `scripts/hooks/guard-protected.mjs` PreToolUse hook;
CODEOWNERS requires review.
