import { DrawdownChart, EquityChart, Histogram } from "@/components/charts";
import { ErrorBox, Json, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtTime } from "@/lib/api";
import type { BacktestRun, Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BacktestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await api<{ run: BacktestRun & { manifest: Record<string, unknown> }; equity: { time: string; equity: string; drawdown: number }[]; trades: Trade[] }>(`/api/backtests/${id}`);
  if (!data) return <ErrorBox error={error} />;
  const eq = data.equity.map((p) => ({ time: p.time, equity: Number(p.equity), drawdown: p.drawdown }));
  return (
    <div className="space-y-3">
      <PageTitle sub={`${data.run.template} · ${data.run.market} ${data.run.timeframe} · ${data.run.partition}`}>
        Backtest {data.run.runHash.slice(0, 12)} — <StrategyLink id={data.run.strategyVersionId} />
      </PageTitle>
      <Panel title="Equity">
        <EquityChart data={eq} />
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Drawdown">
          <DrawdownChart data={eq} />
        </Panel>
        <Panel title="Return distribution">
          <Histogram values={data.trades.map((t) => t.returnOnStake)} />
        </Panel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Metrics">
          <Json value={data.run.metrics} />
        </Panel>
        <Panel title="Reproducibility manifest">
          <Json value={data.run.manifest} />
        </Panel>
      </div>
      <Panel title={`Trades (${data.trades.length})`}>
        <div className="max-h-96 overflow-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Exit</th>
                <th>Dir</th>
                <th>P&L</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => (
                <tr key={t.id}>
                  <td>{fmtTime(t.entryTime)}</td>
                  <td>{fmtTime(t.exitTime)}</td>
                  <td>{t.direction}</td>
                  <td className={Number(t.pnl) >= 0 ? "good" : "bad"}>{fmtNum(t.pnl, 4)}</td>
                  <td>{t.exitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
