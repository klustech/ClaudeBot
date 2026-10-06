# Execution

## Interface

```ts
interface ExecutionAdapter {
  getBalance(): Promise<Balance>;
  getMarkets(): Promise<Market[]>;
  getQuote(request: QuoteRequest): Promise<Quote>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  getOrder(id: string): Promise<OrderStatus>;
  cancelOrder(id: string): Promise<void>;
  getPositions(): Promise<Position[]>;
}
```

Implemented: `PaperExecutionAdapter`, `BybitExecutionAdapter`, `BrowserExecutionAdapter`.
Planned (same interface, start READ_ONLY): Binance, OKX, Blofin, Toobit, WeeX.

## Flow

```
signal (bar close) ─► TradeRequest (idempotency key MARKET-TF-YYYYMMDDTHHMMSS-STRATEGY)
   ─► RiskEngine.evaluate ─► ledger.reserveKey ─► adapter.placeOrder (timeout)
   ─► verify fill == approval ─► ledger.recordOpen ─► persist order/position + latency trace
   ─► settlement ─► trade + equity point ─► degradation check
```

Latency is recorded per stage: signal → decision → risk_approved → execution_requested →
broker_accepted → broker_settled.

Fail-closed cases (all tested in `tests/failure`): broker timeout, disconnect, persistence failure,
fill that differs from the approved instruction, reconciliation mismatch or unreachable broker,
browser extension not answering. Each trips a breaker and marks state unknown.

## Paper trading

`PaperExecutionAdapter` simulates latency, missed entries, spread, slippage, fees, fixed payouts,
venue rejections and connection loss (seeded). Paper trades are stored exactly like live trades
(`orders`, `positions`, `trades`, `equity_points`).

Run: `TRADING_MODE=paper TRADING_ENABLED=true pnpm dev:executor`
- `PAPER_FEED=binance` (default): live public Binance kline stream + REST history warm-up.
- `PAPER_FEED=replay`: replays the dataset's FORWARD period (after `testEnd`) at full speed.

## Reconciliation

Every minute the executor compares ledger positions (and optionally balance) with the venue. Any
mismatch → `reconciliation_failed` / `balance_mismatch` breaker → trading halted until resolved.

## Exchange API (preferred)

Bybit v5 (`packages/exchanges/src/bybit.ts`): HMAC-signed REST; `orderLinkId` = idempotency key so
the venue also rejects duplicates.

1. `EXCHANGE=bybit EXCHANGE_READ_ONLY=true` — balances, markets, quotes, positions only; order
   endpoints throw `SafetyViolation`.
2. `TRADING_MODE=testnet EXCHANGE_READ_ONLY=false` — testnet host.
3. Tiny live: human sets `LIVE_TRADING_ENABLED=true`, adds the strategy to
   `config/live-permissions.json`, sets `currentCapitalStage=1` (£25), re-pins hashes, promotes the
   strategy to LIVE with the human token.

Use a dedicated sub-account with withdrawals disabled where the venue supports it.

## Browser extension fallback (fixed-payout venues without an API)

```
Claude → Local Trading API → Risk Engine (executor) → BridgeQueue → Chrome extension → Broker UI
```

- Build: `BROKER_DOMAINS="https://broker.example.com/*" pnpm --filter @ct/extension build`;
  `<all_urls>` and wildcards are refused. Load `extension/dist` unpacked.
- Pair: paste `BRIDGE_SIGNING_SECRET` (≥ 32 chars) in the popup. Run the executor with
  `EXCHANGE=browser-bridge`.
- The extension holds **no strategy logic**. It polls `/api/bridge/commands`, verifies the HMAC
  signature, allow-list (`get_market, get_balance, get_open_contracts, place_trade, cancel_trade,
  get_trade_result`) and expiry, then performs pre-trade checks against the live page (market,
  direction, stake, payout ≥ minimum, balance, account id, trade window). After clicking it extracts
  the confirmation (trade id, actual stake, payout, timestamp) and posts a signed result.
- Fill `extension/src/broker/selectors.ts` for the venue; placeholders match nothing, so an
  unconfigured extension cannot click anything.
- Claude has no browser authority: no withdraw, settings, leverage or credential commands exist.

## Secrets

`.env` only (see `.env.example`), read by the backend. Claude Code is denied `Read(.env)`; the MCP
server only receives `CONTROL_API_TOKEN`. Logs redact keys/secrets/signatures.
