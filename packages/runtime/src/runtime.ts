import type { InstrumentModel } from "@ct/backtesting";
import type { Repository, StrategyVersionRow } from "@ct/database";
import {
  ExecutionService,
  PaperExecutionAdapter,
  PortfolioLedger,
  reconcile,
  engageKillSwitch,
  type ExecutionAdapter,
  type ExecutionOutcome,
  type ReconciliationReport,
} from "@ct/execution";
import { dataStalenessMs, type MarketStream } from "@ct/market-data";
import { StrategyService, SYSTEM_ACTOR, evaluatePaper } from "@ct/research";
import {
  CircuitBreakerBoard,
  detectDegradation,
  KillSwitch,
  RiskEngine,
  type ExpectedDistribution,
  type RiskLimits,
  type TradeRequest,
} from "@ct/risk";
import { getTemplate } from "@ct/strategies";
import {
  buildIdempotencyKey,
  D,
  TIMEFRAME_MS,
  type Candle,
  type Clock,
  type Direction,
  type Money,
  systemClock,
  type Timeframe,
  type TradingMode,
} from "@ct/shared";
import type { Alerter, Logger } from "@ct/telemetry";
import type { ValidationThresholds } from "@ct/validation";

export interface RuntimeOptions {
  repo: Repository;
  limits: RiskLimits;
  thresholds: ValidationThresholds;
  alerter: Alerter;
  logger: Logger;
  instrument: InstrumentModel;
  mode: TradingMode;
  flags: () => { tradingEnabled: boolean; liveTradingEnabled: boolean; liveStakeCeiling?: Money; livePermittedStrategies?: readonly string[] };
  killSwitch?: KillSwitch;
  clock?: Clock;
  /** Factory for the venue adapter; paper by default. */
  adapterFactory?: (priceSource: (market: string) => number | null, clock: Clock) => ExecutionAdapter;
  startingBalance: string;
  currency: string;
  seed?: number;
  /** Stake per trade as percent of equity (fixed fractional), capped by risk limits. */
  stakePercent?: number;
  historyBars?: number;
}

interface StrategySlot {
  version: StrategyVersionRow;
  expected: ExpectedDistribution | null;
}

interface MarketBuffer {
  timeframe: Timeframe;
  candles: Candle[];
  stream: MarketStream | null;
}

/**
 * Trading runtime: owns the risk engine, ledger, execution service and
 * the venue adapter. Converts closed candles into strategy signals for
 * strategies in PAPER/APPROVED/LIVE, routes them through the risk engine,
 * settles positions, persists everything, reconciles and demotes on
 * degradation. This is the only place orders originate.
 */
export class TradingRuntime {
  readonly breakers: CircuitBreakerBoard;
  readonly killSwitch: KillSwitch;
  readonly ledger: PortfolioLedger;
  readonly adapter: ExecutionAdapter;
  readonly execution: ExecutionService;
  readonly risk: RiskEngine;
  private readonly clock: Clock;
  private readonly strategies = new Map<string, StrategySlot>();
  private readonly markets = new Map<string, MarketBuffer>();
  private readonly lastPrice = new Map<string, number>();
  private readonly lastMarketUpdate = new Map<string, number>();
  private readonly entryFees = new Map<string, Money>();
  private readonly orderMeta = new Map<string, { sessionId: string | null; strategyVersionId: string; market: string; direction: Direction; entryTime: number; entryPrice: number; stake: Money }>();
  private readonly lifecycle: StrategyService;
  sessionId: string | null = null;
  lastReconciliation: ReconciliationReport | null = null;

  constructor(private readonly o: RuntimeOptions) {
    this.clock = o.clock ?? systemClock;
    this.breakers = new CircuitBreakerBoard(() => this.clock.now());
    this.killSwitch = o.killSwitch ?? new KillSwitch();
    this.ledger = new PortfolioLedger(o.startingBalance, this.clock.now());
    this.risk = new RiskEngine(o.limits);
    const priceSource = (m: string): number | null => this.lastPrice.get(m) ?? null;
    this.adapter =
      o.adapterFactory?.(priceSource, this.clock) ??
      new PaperExecutionAdapter({
        startingBalance: o.startingBalance,
        currency: o.currency,
        seed: o.seed ?? 7,
        priceSource,
        clock: this.clock,
        latencyMeanMs: 150,
        latencySdMs: 50,
        missedEntryProbability: 0.01,
        rejectProbability: 0.005,
        spreadBps: 2,
        slippageBpsSd: 1.5,
        ...(o.instrument.kind === "linear" ? { feeRate: o.instrument.feeRate, kind: "linear" as const } : { feePerTrade: o.instrument.feePerTrade, payout: Number(o.instrument.payout), kind: "fixed-payout" as const }),
      });
    this.lifecycle = new StrategyService(o.repo, o.thresholds);
    this.execution = new ExecutionService({
      adapter: this.adapter,
      risk: this.risk,
      breakers: this.breakers,
      killSwitch: this.killSwitch,
      ledger: this.ledger,
      alerter: o.alerter,
      flags: o.flags,
      clock: this.clock,
      onOutcome: (req, out) => this.persistOutcome(req, out),
    });
    this.breakers.onTrip((t) => {
      void o.repo.riskEvent({ kind: "breaker", code: t.name, message: t.reason, strategyVersionId: t.scope === "global" ? null : t.scope });
      void o.alerter.alert("circuit_breaker", "critical", `${t.name}: ${t.reason}`);
    });
    o.alerter.onAlert((a) => void o.repo.insertAlert({ type: a.type, severity: a.severity, message: a.message, ...(a.data ? { data: a.data } : {}) }).catch(() => undefined));
  }

  /** Loads strategies eligible to trade in the current mode. */
  async loadStrategies(versionIds?: string[]): Promise<StrategyVersionRow[]> {
    const stages = this.o.mode === "LIVE" ? ["LIVE" as const] : this.o.mode === "TESTNET" ? ["APPROVED" as const, "LIVE" as const] : ["PAPER" as const, "APPROVED" as const, "LIVE" as const];
    const rows = await this.o.repo.listVersions({ stage: stages });
    const selected = versionIds ? rows.filter((r) => versionIds.includes(r.id)) : rows;
    this.strategies.clear();
    for (const v of selected) {
      this.strategies.set(v.id, { version: v, expected: (v.evidence as { expected?: ExpectedDistribution }).expected ?? null });
      if (!this.markets.has(v.market)) this.markets.set(v.market, { timeframe: v.timeframe as Timeframe, candles: [], stream: null });
    }
    return selected;
  }

  activeStrategies(): StrategyVersionRow[] {
    return [...this.strategies.values()].map((s) => s.version);
  }

  marketsNeeded(): { market: string; timeframe: Timeframe }[] {
    return [...this.markets.entries()].map(([market, b]) => ({ market, timeframe: b.timeframe }));
  }

  seedHistory(market: string, candles: readonly Candle[]): void {
    const b = this.markets.get(market);
    if (!b) return;
    b.candles = candles.slice(-(this.o.historyBars ?? 1500));
    const last = b.candles[b.candles.length - 1];
    if (last) this.lastPrice.set(market, last.close);
  }

  attachStream(market: string, stream: MarketStream): void {
    const b = this.markets.get(market);
    if (!b) throw new Error(`Market ${market} not used by any active strategy`);
    b.stream = stream;
    stream.onCandle(async (c) => {
      await this.onCandle(market, c);
    });
  }

  /** Feed a live price tick (for settlement and quotes). */
  onPrice(market: string, price: number): void {
    this.lastPrice.set(market, price);
    this.lastMarketUpdate.set(market, this.clock.now());
  }

  async onCandle(market: string, candle: Candle): Promise<ExecutionOutcome[]> {
    const b = this.markets.get(market);
    if (!b) return [];
    const last = b.candles[b.candles.length - 1];
    if (last && candle.time <= last.time) return [];
    b.candles.push(candle);
    if (b.candles.length > (this.o.historyBars ?? 1500)) b.candles.shift();
    this.onPrice(market, candle.close);
    await this.settle();
    const outcomes: ExecutionOutcome[] = [];
    for (const slot of this.strategies.values()) {
      if (slot.version.market !== market) continue;
      const out = await this.evaluateSignal(slot, b);
      if (out) outcomes.push(out);
    }
    return outcomes;
  }

  private dataAge(market: string): number {
    const b = this.markets.get(market);
    if (b?.stream) return dataStalenessMs(b.stream, this.clock);
    const t = this.lastMarketUpdate.get(market);
    return t === undefined ? Number.POSITIVE_INFINITY : this.clock.now() - t;
  }

  private stakeFor(): Money {
    const pct = Math.min(this.o.stakePercent ?? 1, this.o.limits.MAX_POSITION_PERCENT);
    return this.ledger.currentEquity().times(pct).div(100).toDecimalPlaces(2, 1);
  }

  private async evaluateSignal(slot: StrategySlot, b: MarketBuffer): Promise<ExecutionOutcome | null> {
    const v = slot.version;
    const template = getTemplate(v.template);
    const { signals, exit } = template.generate(b.candles, v.parameters, { seed: 1 });
    const sig = signals[signals.length - 1];
    if (!sig) return null;
    const bar = b.candles[b.candles.length - 1] as Candle;
    const tfMs = TIMEFRAME_MS[v.timeframe as Timeframe];
    const signalTime = bar.time + tfMs; // bar close
    const direction: Direction = sig === 1 ? "UP" : "DOWN";
    const req: TradeRequest = {
      idempotencyKey: buildIdempotencyKey({ market: v.market, timeframe: v.timeframe, signalTime, strategyId: v.id }),
      strategyVersionId: v.id,
      strategyStage: v.stage as TradeRequest["strategyStage"],
      liveEligible: v.liveEligible,
      market: v.market,
      direction,
      stake: this.stakeFor().toFixed(2),
      mode: this.o.mode,
      confidence: v.confidence ?? 0,
      edge: slot.expected?.expectancyR ?? 0,
      signalTime,
      dataAgeMs: this.dataAge(v.market),
      requestedBy: "executor",
      ...(this.o.instrument.kind === "fixed-payout"
        ? { payout: Number(this.o.instrument.payout), expectedPayout: Number(this.o.instrument.payout) }
        : { expectedSlippageBps: this.o.instrument.slippageBps }),
    };
    const holdMs = Math.max(1, exit.holdBars) * tfMs;
    return this.execution.requestTrade(req, {
      kind: this.o.instrument.kind,
      ...(this.o.instrument.kind === "fixed-payout" ? { expiryMs: holdMs } : { maxHoldMs: holdMs }),
    });
  }

  /** Requests from Claude (via API/MCP) use the exact same path as executor signals. */
  async requestTrade(req: TradeRequest): Promise<ExecutionOutcome> {
    const slot = this.strategies.get(req.strategyVersionId);
    if (!slot) {
      return {
        status: "rejected_by_risk",
        decision: { approved: false, stake: D(0), violations: [{ code: "NOT_ACTIVE", message: "Strategy not active in this runtime" }], evaluatedAt: this.clock.now() },
        order: null,
        latency: {},
      };
    }
    const v = slot.version;
    // Stage, eligibility, confidence and edge always come from the database, never from the caller.
    const trusted: TradeRequest = {
      ...req,
      strategyStage: v.stage as TradeRequest["strategyStage"],
      liveEligible: v.liveEligible,
      market: v.market,
      mode: this.o.mode,
      confidence: v.confidence ?? 0,
      edge: slot.expected?.expectancyR ?? 0,
      dataAgeMs: this.dataAge(v.market),
    };
    const tfMs = TIMEFRAME_MS[v.timeframe as Timeframe];
    const exit = getTemplate(v.template).generate([], v.parameters, { seed: 1 }).exit;
    const holdMs = Math.max(1, exit.holdBars) * tfMs;
    return this.execution.requestTrade(trusted, {
      kind: this.o.instrument.kind,
      ...(this.o.instrument.kind === "fixed-payout" ? { expiryMs: holdMs } : { maxHoldMs: holdMs }),
    });
  }

  private async persistOutcome(req: TradeRequest, out: ExecutionOutcome): Promise<void> {
    const repo = this.o.repo;
    const sessionKind = this.o.mode === "PAPER" ? "paper" : this.o.mode === "TESTNET" ? "testnet" : "live";
    if (out.status === "rejected_by_risk" || out.status === "duplicate") {
      await repo.riskEvent({
        kind: "rejection",
        code: out.decision?.violations.map((v) => v.code).join(",") ?? "UNKNOWN",
        message: out.decision?.violations.map((v) => v.message).join("; ") ?? "",
        strategyVersionId: req.strategyVersionId,
        data: { idempotencyKey: req.idempotencyKey, requestedBy: req.requestedBy },
      });
      return;
    }
    const order = out.order;
    if (await repo.orderExists(req.idempotencyKey)) return;
    await repo.insertOrder({
      id: order?.orderId ?? `unknown-${req.idempotencyKey}`,
      idempotencyKey: req.idempotencyKey,
      sessionId: this.sessionId,
      sessionKind,
      strategyVersionId: req.strategyVersionId,
      venue: this.adapter.name,
      venueOrderId: order?.orderId ?? null,
      market: req.market,
      direction: req.direction,
      requestedStake: req.stake,
      filledStake: order ? order.filledStake.toFixed(8) : null,
      fillPrice: order?.fillPrice !== null && order?.fillPrice !== undefined ? String(order.fillPrice) : null,
      fees: order ? order.fees.toFixed(8) : null,
      state: out.status === "unknown" ? "unknown" : (order?.state ?? "rejected"),
      reason: order?.reason ?? out.error ?? null,
      riskDecision: out.decision ? { approved: out.decision.approved, stake: out.decision.stake.toFixed(8), violations: out.decision.violations } : null,
      latency: out.latency as Record<string, unknown>,
      requestedBy: req.requestedBy,
    });
    if (out.status === "accepted" && order && order.fillPrice !== null) {
      this.entryFees.set(order.orderId, order.fees);
      this.orderMeta.set(order.orderId, {
        sessionId: this.sessionId,
        strategyVersionId: req.strategyVersionId,
        market: req.market,
        direction: req.direction,
        entryTime: order.acceptedAt,
        entryPrice: order.fillPrice,
        stake: order.filledStake,
      });
      await repo.insertPosition({
        id: order.orderId,
        sessionId: this.sessionId,
        sessionKind,
        orderId: order.orderId,
        strategyVersionId: req.strategyVersionId,
        market: req.market,
        direction: req.direction,
        stake: order.filledStake.toFixed(8),
        entryPrice: String(order.fillPrice),
        openedAt: new Date(order.acceptedAt),
        expiresAt: null,
      });
    }
  }

  /** Settles expired paper positions and persists trades/equity. */
  async settle(): Promise<number> {
    if (!(this.adapter instanceof PaperExecutionAdapter)) return 0;
    const settled = this.adapter.settleExpired();
    for (const s of settled) {
      const meta = this.orderMeta.get(s.orderId);
      const entryFees = this.entryFees.get(s.orderId) ?? s.fees;
      this.execution.settle(s.orderId, s.pnl ?? D(0), entryFees);
      this.entryFees.delete(s.orderId);
      if (!meta || s.pnl === null) continue;
      await this.o.repo.closePosition(s.orderId, { exitPrice: s.exitPrice ?? 0, pnl: s.pnl.toFixed(8), closedAt: new Date(s.settledAt ?? this.clock.now()) });
      await this.o.repo.updateOrder(s.orderId, { state: "settled" });
      await this.o.repo.insertTrade({
        sessionKind: this.o.mode === "PAPER" ? "paper" : this.o.mode === "TESTNET" ? "testnet" : "live",
        sessionId: meta.sessionId,
        orderId: s.orderId,
        strategyVersionId: meta.strategyVersionId,
        market: meta.market,
        direction: meta.direction,
        entryTime: meta.entryTime,
        exitTime: s.settledAt ?? this.clock.now(),
        entryPrice: meta.entryPrice,
        exitPrice: s.exitPrice ?? 0,
        stake: meta.stake.toFixed(8),
        fees: s.fees.toFixed(8),
        pnl: s.pnl.toFixed(8),
        returnOnStake: s.pnl.div(meta.stake).toNumber(),
        exitReason: "expiry",
        win: s.pnl.gt(0),
      });
      this.orderMeta.delete(s.orderId);
      await this.o.alerter.alert("trade_closed", "info", `${meta.strategyVersionId} ${meta.direction} ${meta.market} P&L ${s.pnl.toFixed(2)}`);
      const lossPct = s.pnl.neg().div(this.ledger.currentEquity()).times(100).toNumber();
      if (lossPct >= this.o.limits.MAX_POSITION_PERCENT) {
        await this.o.alerter.alert("large_loss", "warning", `Large loss ${s.pnl.toFixed(2)} on ${meta.strategyVersionId}`);
      }
      await this.checkDegradation(meta.strategyVersionId);
    }
    if (settled.length && this.sessionId) {
      await this.o.repo.insertEquityPoint({
        sessionId: this.sessionId,
        time: this.clock.now(),
        equity: this.ledger.currentEquity().toFixed(8),
        drawdown: this.ledger.drawdown(),
      });
    }
    this.checkLossBreakers();
    return settled.length;
  }

  private checkLossBreakers(): void {
    const st = this.ledger.snapshot(this.clock.now());
    const L = this.o.limits;
    const loss = (from: Money): number => (from.gt(0) ? from.minus(st.equity).div(from).times(100).toNumber() : 0);
    if (loss(st.startOfDayEquity) >= L.MAX_DAILY_LOSS_PERCENT) {
      this.breakers.trip("max_daily_loss", `Daily loss ${loss(st.startOfDayEquity).toFixed(2)}%`);
      void this.o.alerter.alert("daily_stop_reached", "critical", "Maximum daily loss reached; trading halted");
    }
    if (loss(st.startOfWeekEquity) >= L.MAX_WEEKLY_LOSS_PERCENT) this.breakers.trip("max_weekly_loss", `Weekly loss ${loss(st.startOfWeekEquity).toFixed(2)}%`);
    if (loss(st.peakEquity) >= L.MAX_DRAWDOWN_PERCENT) this.breakers.trip("drawdown_threshold", `Drawdown ${loss(st.peakEquity).toFixed(2)}%`);
  }

  /** Automatic demotion on statistically significant degradation. Never re-optimises. */
  async checkDegradation(versionId: string): Promise<boolean> {
    const slot = this.strategies.get(versionId);
    if (!slot?.expected) return false;
    const res = detectDegradation(this.ledger.returnsFor(versionId), slot.expected);
    if (!res.degraded) return false;
    this.breakers.trip("strategy_degradation", res.reasons.join("; "), versionId);
    const stage = slot.version.stage;
    if (stage === "LIVE" || stage === "PAPER" || stage === "APPROVED") {
      try {
        await this.lifecycle.transition(versionId, "DEGRADED", { reason: `Automatic degradation: ${res.reasons.join("; ")}`, metrics: { ...res }, actor: SYSTEM_ACTOR });
        if (stage === "LIVE") {
          await this.lifecycle.transition(versionId, "PAPER", { reason: "Automatic demotion LIVE → DEGRADED → PAPER; strategy frozen, a new version must be validated", actor: SYSTEM_ACTOR });
        }
      } catch (err) {
        this.o.logger.error({ err }, "degradation transition failed");
      }
    }
    this.strategies.delete(versionId);
    await this.o.alerter.alert("strategy_degraded", "warning", `${versionId} degraded: ${res.reasons.join("; ")}`);
    return true;
  }

  async reconcileNow(): Promise<ReconciliationReport> {
    const r = await reconcile({ adapter: this.adapter, ledger: this.ledger, breakers: this.breakers, alerter: this.o.alerter, now: this.clock.now() });
    this.lastReconciliation = r;
    if (r.ok) this.ledger.markKnown();
    return r;
  }

  /** Watchdog: halts on stale market data. */
  watchdog(): void {
    for (const { market } of this.marketsNeeded()) {
      const age = this.dataAge(market);
      if (age > this.o.limits.MAX_DATA_STALENESS_MS && this.strategies.size > 0) {
        this.breakers.trip("market_feed_stale", `${market} data ${Number.isFinite(age) ? `${Math.round(age / 1000)}s` : "never"} old`);
      }
    }
  }

  async kill(reason: string, by: string): Promise<void> {
    await engageKillSwitch({
      killSwitch: this.killSwitch,
      reason,
      by,
      adapters: [this.adapter],
      pendingOrderIds: this.execution.pendingKeys(),
      alerter: this.o.alerter,
    });
    await this.o.repo.riskEvent({ kind: "kill", code: "KILL_SWITCH", message: reason, data: { by } });
  }

  async paperEvaluation(versionId: string) {
    return evaluatePaper(this.o.repo, versionId, this.o.thresholds);
  }

  status() {
    const now = this.clock.now();
    const snap = this.ledger.snapshot(now);
    return {
      mode: this.o.mode,
      sessionId: this.sessionId,
      venue: this.adapter.name,
      flags: { ...this.o.flags(), liveStakeCeiling: this.o.flags().liveStakeCeiling?.toFixed(2) ?? null },
      killSwitch: this.killSwitch.state(),
      breakers: this.breakers.openBreakers(),
      equity: snap.equity.toFixed(2),
      startingBalance: this.o.startingBalance,
      currency: this.o.currency,
      peakEquity: snap.peakEquity.toFixed(2),
      drawdown: this.ledger.drawdown(),
      exposure: this.ledger.exposure().toFixed(2),
      openPositions: snap.openPositions.map((p) => ({ ...p, stake: p.stake.toFixed(2) })),
      consecutiveLosses: snap.consecutiveLosses,
      stateKnown: snap.stateKnown,
      strategies: this.activeStrategies().map((v) => ({ id: v.id, market: v.market, stage: v.stage, confidence: v.confidence })),
      markets: this.marketsNeeded().map((m) => ({ ...m, dataAgeMs: Number.isFinite(this.dataAge(m.market)) ? this.dataAge(m.market) : null, lastPrice: this.lastPrice.get(m.market) ?? null })),
      lastReconciliation: this.lastReconciliation,
      now,
    };
  }
}
