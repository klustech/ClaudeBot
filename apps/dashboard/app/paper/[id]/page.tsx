import { AreaEquity, Histogram } from "@/components/charts";
import { ErrorBox, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtPct, fmtTime } from "@/lib/api";
import type { Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Evaluation {
  versionId: string;
  trades: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdown: number;
  deviationFromOos: number | null;
  tier: number;
  nextTierTrades: number | null;
  passed: boolean;
  degraded: boolean;
  reasons: string[];
}

export default async function PaperSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await api<{
    session: { id: string; status: string; startingBalance: string; currency: string };
    trades: Trade[];
    equity: { time: string; equity: string }[];
    orders: { id: string; idempotencyKey: string; state: string; reason: string | null; latency: Record<string, number> | null; createdAt: string }[];
    evaluations: Evaluation[];
  }>(`/api/paper/sessions/${id}`);
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <PageTitle sub={`${data.session.status} · start ${fmtNum(data.session.startingBalance)} ${data.session.currency}`}>Paper session {data.session.id}</PageTitle>
      <Panel title="Equity">
        <AreaEquity data={data.equity.map((p) => ({ time: p.time, equity: Number(p.equity) }))} />
      </Panel>
      <Panel title="Promotion gate evaluation">
        <table className="data">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Trades</th>
              <th>Tier</th>
              <th>E[R]</th>
              <th>PF</th>
              <th>DD</th>
              <th>Dev. from OOS</th>
              <th>Gate</th>
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {data.evaluations.map((e) => (
              <tr key={e.versionId}>
                <td>
                  <StrategyLink id={e.versionId} />
                </td>
                <td>{e.trades}</td>
                <td>
                  {e.tier} {e.nextTierTrades ? <span className="muted">(next {e.nextTierTrades})</span> : null}
                </td>
                <td>{e.expectancyR.toFixed(4)}</td>
                <td>{e.profitFactor.toFixed(2)}</td>
                <td>{fmtPct(e.maxDrawdown)}</td>
                <td>{e.deviationFromOos === null ? "-" : fmtPct(e.deviationFromOos, 0)}</td>
                <td className={e.passed ? "good" : "bad"}>{e.passed ? "PASS" : e.degraded ? "DEGRADED" : "pending"}</td>
                <td className="muted text-[11px]">{e.reasons.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Return distribution">
          <Histogram values={data.trades.map((t) => t.returnOnStake)} />
        </Panel>
        <Panel title="Orders (latency per stage)">
          <div className="max-h-80 overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Key</th>
                  <th>State</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{fmtTime(o.createdAt)}</td>
                    <td className="text-[11px]">{o.idempotencyKey}</td>
                    <td>{o.state}</td>
                    <td className="muted text-[11px]">{o.latency ? `${o.latency.total ?? "-"}ms` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title={`Trades (${data.trades.length})`}>
        <div className="max-h-96 overflow-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Closed</th>
                <th>Strategy</th>
                <th>Dir</th>
                <th>Stake</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => (
                <tr key={t.id}>
                  <td>{fmtTime(t.exitTime)}</td>
                  <td>
                    <StrategyLink id={t.strategyVersionId} />
                  </td>
                  <td>{t.direction}</td>
                  <td>{fmtNum(t.stake)}</td>
                  <td className={Number(t.pnl) >= 0 ? "good" : "bad"}>{fmtNum(t.pnl, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
