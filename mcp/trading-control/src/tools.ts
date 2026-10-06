import { z } from "zod";
import type { TradingApiClient } from "./client";

const STAGES = ["IDEA", "RESEARCH", "BACKTESTED", "VALIDATING", "INCUBATING", "PAPER", "APPROVED", "LIVE", "DEGRADED", "RETIRED"] as const;

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run: (api: TradingApiClient, args: Record<string, unknown>) => Promise<unknown>;
}

const q = (params: Record<string, unknown>): string => {
  const e = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? `?${new URLSearchParams(e.map(([k, v]) => [k, String(v)])).toString()}` : "";
};

/**
 * Tools exposed to Claude. Deliberately absent: any tool that sends an
 * arbitrary order, changes risk limits, edits locked periods, approves
 * strategies, enables live trading, or reveals credentials. request_trade
 * always passes through the executor's deterministic risk engine.
 */
export const TOOLS: ToolDef[] = [
  {
    name: "list_templates",
    description: "List strategy templates (hypothesis families) and benchmark templates with their parameter spaces.",
    input: {},
    run: (api) => api.request("GET", "/api/templates"),
  },
  {
    name: "research_strategy",
    description:
      "Register a NEW falsifiable strategy hypothesis (creates an immutable version) and backtest it on the TRAIN period only. State the hypothesis, why it could produce an edge, and its invalidation condition.",
    input: {
      market: z.string().describe("e.g. ETHUSDT"),
      timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).default("15m"),
      template: z.string().describe("template key from list_templates"),
      hypothesis: z.string().min(20),
      rationale: z.string().min(10),
      invalidation: z.string().min(10),
      parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      wait: z.boolean().default(true),
    },
    run: (api, a) => api.request("POST", "/api/research/strategies", a),
  },
  {
    name: "list_strategies",
    description: "List strategy versions, optionally filtered by lifecycle stage and market.",
    input: { stage: z.enum(STAGES).optional(), market: z.string().optional(), limit: z.number().int().max(500).default(100) },
    run: (api, a) => api.request("GET", `/api/strategies${q(a)}`),
  },
  {
    name: "get_strategy",
    description: "Full record of a strategy version: definition, lineage, backtests, validation reports, decisions, forward trades.",
    input: { id: z.string() },
    run: (api, a) => api.request("GET", `/api/strategies/${encodeURIComponent(String(a.id))}`),
  },
  {
    name: "optimise_strategy",
    description:
      "Cautiously optimise a BACKTESTED version on TRAIN only (composite objective, penalised for sensitivity and small samples). Produces a NEW immutable child version; the parent is retired as superseded.",
    input: { id: z.string(), wait: z.boolean().default(true) },
    run: (api, a) => api.request("POST", `/api/research/strategies/${encodeURIComponent(String(a.id))}/optimise`, { wait: a.wait }),
  },
  {
    name: "run_validation",
    description:
      "Run the validation laboratory on a BACKTESTED version: OOS, walk-forward, Monte Carlo (10k), parameter stability, deflated Sharpe (programme-wide trial count), benchmarks, regimes. Passing versions are frozen, tested once on the locked TEST period, and promoted to INCUBATING; others are retired.",
    input: { id: z.string(), wait: z.boolean().default(true) },
    run: (api, a) => api.request("POST", `/api/research/strategies/${encodeURIComponent(String(a.id))}/validate`, { wait: a.wait }),
  },
  {
    name: "start_campaign",
    description: "Start a research campaign across markets × hypothesis families (asynchronous). Returns a job id.",
    input: {
      name: z.string(),
      objective: z.string(),
      markets: z.array(z.string()).min(1),
      timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).default("15m"),
      templates: z.array(z.string()).optional(),
    },
    run: (api, a) => api.request("POST", "/api/research/campaigns", a),
  },
  {
    name: "get_job",
    description: "Status, progress and result of an asynchronous research job.",
    input: { id: z.string() },
    run: (api, a) => api.request("GET", `/api/jobs/${encodeURIComponent(String(a.id))}`),
  },
  {
    name: "rank_strategies",
    description: "Rank surviving strategies by confidence and select a diversified, correlation-capped set (max 5).",
    input: {},
    run: (api) => api.request("POST", "/api/research/rank", {}),
  },
  {
    name: "promote_strategy",
    description:
      "Request a one-step forward lifecycle promotion. Gates are evaluated server-side from stored evidence. Claude cannot promote to APPROVED or LIVE (human only).",
    input: { id: z.string(), to: z.enum(STAGES), reason: z.string().min(5) },
    run: (api, a) => api.request("POST", `/api/strategies/${encodeURIComponent(String(a.id))}/promote`, { to: a.to, reason: a.reason }),
  },
  {
    name: "demote_strategy",
    description: "Demote (DEGRADED / PAPER) or retire a strategy version. Safety actions are never blocked.",
    input: { id: z.string(), to: z.enum(["DEGRADED", "PAPER", "RETIRED"]), reason: z.string().min(5) },
    run: (api, a) => api.request("POST", `/api/strategies/${encodeURIComponent(String(a.id))}/demote`, { to: a.to, reason: a.reason }),
  },
  {
    name: "start_paper_session",
    description: "Ask the executor to (re)load all PAPER-stage strategies into the running paper session.",
    input: {},
    run: (api) => api.request("POST", "/api/paper/reload", {}),
  },
  {
    name: "get_paper_results",
    description: "Paper-trading results: a session (trades, equity, orders, evaluations) or one strategy's paper evaluation against its graduation tiers.",
    input: { sessionId: z.string().optional(), strategyVersionId: z.string().optional() },
    run: async (api, a) => {
      if (a.strategyVersionId) return api.request("GET", `/api/paper/evaluate/${encodeURIComponent(String(a.strategyVersionId))}`);
      if (a.sessionId) return api.request("GET", `/api/paper/sessions/${encodeURIComponent(String(a.sessionId))}`);
      return api.request("GET", "/api/paper/sessions");
    },
  },
  {
    name: "request_trade",
    description:
      "REQUEST (not place) a trade for an active strategy. The deterministic risk engine decides; it may reject for any reason. Requires an idempotency key (e.g. ETH-15M-20261006T120000-STRATEGY001). Stage, confidence and edge are taken from the database, not from you.",
    input: {
      strategyVersionId: z.string(),
      direction: z.enum(["UP", "DOWN"]),
      stake: z.string().regex(/^\d+(\.\d+)?$/),
      idempotencyKey: z.string().min(8),
      reason: z.string().min(3),
    },
    run: (api, a) => api.request("POST", "/api/trade/request", a),
  },
  {
    name: "get_portfolio",
    description: "Portfolio: equity, exposure, open positions, diversified selection.",
    input: {},
    run: (api) => api.request("GET", "/api/portfolio"),
  },
  {
    name: "get_risk_status",
    description: "Risk limits, open circuit breakers, kill-switch state and recent risk events.",
    input: {},
    run: (api) => api.request("GET", "/api/risk"),
  },
  {
    name: "disable_trading",
    description: "EMERGENCY: engage the global kill switch (blocks new positions, cancels pending orders, alerts). Releasing it requires a human.",
    input: { reason: z.string().min(3) },
    run: (api, a) => api.request("POST", "/api/kill", a),
  },
  {
    name: "record_decision",
    description: "Record an auditable decision (action, reason, evidence, input metrics, output). Every promotion/rejection rationale should be recorded.",
    input: {
      strategyId: z.string().nullable().default(null),
      action: z.string(),
      reason: z.string(),
      evidence: z.record(z.string(), z.unknown()).default({}),
      inputMetrics: z.record(z.string(), z.unknown()).default({}),
      outputDecision: z.string(),
    },
    run: (api, a) => api.request("POST", "/api/decisions", a),
  },
  {
    name: "write_journal",
    description: "Append an entry to the AI research journal (reports/research/YYYY-MM-DD.md).",
    input: {
      title: z.string(),
      hypothesis: z.string().optional(),
      result: z.string(),
      reason: z.string(),
      observed: z.string().optional(),
      next: z.string().optional(),
      experimentNumber: z.number().int().optional(),
    },
    run: (api, a) => api.request("POST", "/api/journal", a),
  },
  {
    name: "get_research_stats",
    description: "Programme-wide research statistics including the total trial count used for multiple-testing correction.",
    input: {},
    run: (api) => api.request("GET", "/api/research/stats"),
  },
  {
    name: "import_trader_dev_backtest",
    description:
      "Import a backtest produced via the Trader.dev MCP into the local experiment database. Map Trader.dev's actual output (inspect it first; do not guess fields) into the documented normalised format (see docs/RESEARCH.md).",
    input: { payload: z.record(z.string(), z.unknown()) },
    run: (api, a) => api.request("POST", "/api/research/import/trader-dev", a.payload),
  },
  {
    name: "generate_report",
    description: "Generate the daily research report or the weekly expectation-vs-reality review.",
    input: { kind: z.enum(["daily", "weekly"]) },
    run: (api, a) => api.request("POST", `/api/reports/${a.kind as string}`, {}),
  },
];

export const FORBIDDEN_TOOL_NAMES = ["send_arbitrary_order", "place_order", "set_risk_limits", "enable_live_trading", "modify_locked_periods", "withdraw", "get_credentials"];
