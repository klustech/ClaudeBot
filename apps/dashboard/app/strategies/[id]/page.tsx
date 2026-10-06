import { DrawdownChart, EquityChart, Histogram, SignedBars } from "@/components/charts";
import { Heatmap } from "@/components/heatmap";
import { ErrorBox, Json, PageTitle, Panel, PassBadge, StageBadge, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtPct, fmtTime } from "@/lib/api";
import type { BacktestRun, Check, Decision, Experiment, StrategyVersion, Trade, ValidationRun } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Detail {
  version: StrategyVersion;
  template: { key: string; name: string; description: string; params: Record<string, unknown> } | null;
  lineage: { id: string; version: number; parent: string | null; mutations: string[]; generation: number; stage: string; confidence: number | null }[];
  backtestRuns: BacktestRun[];
  validations: ValidationRun[];
  decisions: Decision[];
  experiments: Experiment[];
  forwardTrades: Trade[];
}

interface RunDetail {
  run: BacktestRun;
  equity: { time: string; equity: string; drawdown: number }[];
  trades: Trade[];
}

interface Report {
  train?: Record<string, number>;
  validation?: Record<string, number>;
  walkForward?: { windows: { index: number; testFrom: number; test: { expectancyR: number; netProfit: string; tradeCount: number } }[]; profitableWindows: number; averageTestExpectancyR: number; worstWindowExpectancyR: number; bestWindowExpectancyR: number; testExpectancyVariance: number };
  monteCarlo?: Record<string, number>;
  stability?: { score: number; positiveFraction: number; heatmap: { xParam: string; yParam: string; cells: { x: unknown; y: unknown; expectancyR: number }[] } | null };
  deflatedSharpe?: { deflatedSharpeProbability: number; expectedMaxSharpe: number; trials: number };
  regimes?: Record<string, { trades: number; winRate: number; expectancyR: number; profitFactor: number }>;
  benchmarks?: { beats: Record<string, boolean>; benchmarks: Record<string, { expectancyR: number; sharpe: number; netProfit: string }> };
  metrics?: Record<string, number>;
}

function monthly(trades: Trade[]): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const t of trades) {
    const k = new Date(t.exitTime).toISOString().slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + Number(t.pnl));
  }
  return [...m.entries()].sort().map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));
}

const METRIC_ROWS: [string, string, (v: number) => string][] = [
  ["tradeCount", "Trades", (v) => String(v)],
  ["winRate", "Win rate", (v) => fmtPct(v)],
  ["expectancyR", "E[R] / trade", (v) => v.toFixed(4)],
  ["profitFactor", "Profit factor", (v) => v.toFixed(2)],
  ["sharpe", "Sharpe", (v) => v.toFixed(2)],
  ["sortino", "Sortino", (v) => v.toFixed(2)],
  ["maxDrawdown", "Max DD", (v) => fmtPct(v)],
  ["netReturn", "Net return", (v) => fmtPct(v)],
  ["longestLosingStreak", "Longest losing streak", (v) => String(v)],
  ["valueAtRisk95", "VaR95 (R)", (v) => v.toFixed(3)],
  ["conditionalValueAtRisk95", "CVaR95 (R)", (v) => v.toFixed(3)],
];

export default async function InspectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await api<Detail>(`/api/strategies/${encodeURIComponent(id)}`);
  if (!data) return <ErrorBox error={error} />;
  const v = data.version;
  const valRun = data.backtestRuns.find((r) => r.partition === "validation") ?? data.backtestRuns[0];
  const runDetail = valRun ? (await api<RunDetail>(`/api/backtests/${valRun.id}`)).data : null;
  const validation = data.validations.find((x) => x.kind === "validation");
  const holdout = data.validations.find((x) => x.kind === "holdout");
  const report = (validation?.report ?? {}) as Report;
  const holdoutMetrics = (holdout?.report as Report | undefined)?.metrics;
  const trades = runDetail?.trades ?? [];
  const equity = (runDetail?.equity ?? []).map((p) => ({ time: p.time, equity: Number(p.equity), drawdown: p.drawdown }));

  return (
    <div className="space-y-3">
      <PageTitle sub={`${v.market} · ${v.timeframe} · ${v.template} · generation ${v.generation} · hash ${v.contentHash.slice(0, 12)}`}>
        {v.id} <StageBadge stage={v.stage} /> {v.confidence !== null ? <span className="muted">confidence {v.confidence.toFixed(1)}/100</span> : null}
      </PageTitle>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Hypothesis">
          <p>{v.hypothesis}</p>
          <p className="muted mt-2">Why an edge: {v.rationale}</p>
          <p className="muted mt-2">Invalidation: {v.invalidation}</p>
          <p className="muted mt-2">Expected regimes: {v.expectedRegimes.join(", ") || "-"}</p>
        </Panel>
        <Panel title="Strategy source & parameters">
          <div>
            Template <b>{data.template?.name ?? v.template}</b> <span className="muted">({v.template})</span>
          </div>
          <p className="muted">{data.template?.description}</p>
          <Json value={v.parameters} />
          <div className="muted text-[11px]">Frozen: {v.frozenAt ? fmtTime(v.frozenAt) : "no"} · Live eligible: {v.liveEligible ? "yes" : "no"}</div>
        </Panel>
        <Panel title="Genome / lineage">
          <ul className="space-y-1">
            {data.lineage
              .sort((a, b) => a.version - b.version)
              .map((l) => (
                <li key={l.id} style={{ paddingLeft: l.generation * 12 }}>
                  {l.id === v.id ? <b>{l.id}</b> : <StrategyLink id={l.id} />} <StageBadge stage={l.stage} />
                  {l.mutations.length ? <div className="muted text-[11px]">{l.mutations.join("; ")}</div> : null}
                </li>
              ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <Panel title={`Equity curve (${valRun?.partition ?? "-"} period)`}>
            <EquityChart data={equity} />
          </Panel>
          <Panel title="Drawdown">
            <DrawdownChart data={equity} />
          </Panel>
        </div>
        <Panel title="OOS comparison">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Train</th>
                <th>Validation</th>
                <th>Test (holdout)</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(([k, label, f]) => (
                <tr key={k}>
                  <td className="muted">{label}</td>
                  <td>{report.train?.[k] !== undefined ? f(report.train[k] as number) : "-"}</td>
                  <td>{report.validation?.[k] !== undefined ? f(report.validation[k] as number) : "-"}</td>
                  <td>{holdoutMetrics?.[k] !== undefined ? f(holdoutMetrics[k] as number) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Win/loss distribution (R per trade)">
          <Histogram values={trades.map((t) => t.returnOnStake)} />
        </Panel>
        <Panel title="Monthly P&L">
          <SignedBars data={monthly(trades)} />
        </Panel>
        <Panel title="Walk-forward (test E[R] by window)">
          <SignedBars data={(report.walkForward?.windows ?? []).map((w) => ({ label: `#${w.index}`, value: Number(w.test.expectancyR.toFixed(5)) }))} />
          {report.walkForward ? (
            <div className="muted text-[11px]">
              {report.walkForward.profitableWindows}/{report.walkForward.windows.length} profitable · avg {report.walkForward.averageTestExpectancyR.toFixed(4)} · worst {report.walkForward.worstWindowExpectancyR.toFixed(4)} · best {report.walkForward.bestWindowExpectancyR.toFixed(4)}
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title={`Parameter stability ${report.stability ? `(${report.stability.score.toFixed(0)}/100)` : ""}`}>
          {report.stability?.heatmap ? <Heatmap {...report.stability.heatmap} /> : <div className="muted">No heatmap.</div>}
        </Panel>
        <Panel title="Monte Carlo">
          {report.monteCarlo ? (
            <table className="data">
              <tbody>
                <tr><td className="muted">Simulations</td><td>{report.monteCarlo.simulations}</td></tr>
                <tr><td className="muted">Median return</td><td>{fmtPct(report.monteCarlo.medianReturn)}</td></tr>
                <tr><td className="muted">5th percentile</td><td>{fmtPct(report.monteCarlo.p05Return)}</td></tr>
                <tr><td className="muted">95th percentile</td><td>{fmtPct(report.monteCarlo.p95Return)}</td></tr>
                <tr><td className="muted">P(ruin)</td><td>{fmtPct(report.monteCarlo.probabilityOfRuin, 2)}</td></tr>
                <tr><td className="muted">E[max DD]</td><td>{fmtPct(report.monteCarlo.expectedMaxDrawdown)}</td></tr>
                <tr><td className="muted">E[losing streak]</td><td>{report.monteCarlo.expectedLongestLosingStreak?.toFixed(1)}</td></tr>
              </tbody>
            </table>
          ) : (
            <div className="muted">Not run.</div>
          )}
          {report.deflatedSharpe ? (
            <div className="mt-2 muted text-[11px]">
              Deflated Sharpe probability {report.deflatedSharpe.deflatedSharpeProbability.toFixed(3)} after {report.deflatedSharpe.trials} trials
            </div>
          ) : null}
        </Panel>
        <Panel title="Validation checks">
          {validation ? (
            <ul className="space-y-1">
              {(validation.checks as Check[]).map((c) => (
                <li key={c.name}>
                  <PassBadge passed={c.passed} /> {c.name} <span className="muted">— {c.detail}</span>
                </li>
              ))}
              {holdout
                ? (holdout.checks as Check[]).map((c) => (
                    <li key={c.name}>
                      <PassBadge passed={c.passed} /> {c.name} <span className="muted">— {c.detail}</span>
                    </li>
                  ))
                : null}
            </ul>
          ) : (
            <div className="muted">Not validated yet.</div>
          )}
        </Panel>
      </div>

      {report.regimes ? (
        <Panel title="Regime analysis (validation)">
          <table className="data">
            <thead>
              <tr>
                <th>Regime</th>
                <th>Trades</th>
                <th>Win rate</th>
                <th>E[R]</th>
                <th>PF</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.regimes).map(([k, r]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{r.trades}</td>
                  <td>{fmtPct(r.winRate)}</td>
                  <td className={r.expectancyR >= 0 ? "good" : "bad"}>{r.expectancyR.toFixed(4)}</td>
                  <td>{r.profitFactor.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Claude research notes & decisions">
          <ul className="space-y-2">
            {data.decisions.map((d) => (
              <li key={d.id}>
                <div>
                  <span className="muted">{fmtTime(d.timestamp)}</span> <b>{d.action}</b> → {d.outputDecision} <span className="muted">({d.actor}/{d.model})</span>
                </div>
                <div className="muted text-[11px]">{d.reason}</div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={`Trade history (${valRun?.partition ?? ""}, ${trades.length})`}>
          <div className="max-h-96 overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Dir</th>
                  <th>Entry px</th>
                  <th>Exit px</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(-300).reverse().map((t) => (
                  <tr key={t.id}>
                    <td>{fmtTime(t.entryTime)}</td>
                    <td>{t.direction}</td>
                    <td>{fmtNum(t.entryPrice, 2)}</td>
                    <td>{fmtNum(t.exitPrice, 2)}</td>
                    <td className={Number(t.pnl) >= 0 ? "good" : "bad"}>{fmtNum(t.pnl, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Experiments (reproducibility)">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Configs</th>
              <th>Dataset</th>
              <th>Code hash</th>
              <th>Engine</th>
              <th>Seed</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.experiments.map((e) => (
              <tr key={e.id}>
                <td>{e.number}</td>
                <td>{e.kind}</td>
                <td>{e.status}</td>
                <td>{e.configurationsTested}</td>
                <td>{e.datasetVersion}</td>
                <td>{e.codeHash}</td>
                <td>{e.engineVersion}</td>
                <td>{e.seed}</td>
                <td>{e.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
