import Link from "next/link";
import { ErrorBox, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtPct, fmtTime } from "@/lib/api";
import type { BacktestRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BacktestsPage() {
  const { data, error } = await api<BacktestRun[]>("/api/backtests?limit=300");
  return (
    <div className="space-y-3">
      <PageTitle sub="Every run records dataset version, code hash, parameters, fee model, seed and engine version.">Backtests</PageTitle>
      <ErrorBox error={error} />
      <Panel>
        <table className="data">
          <thead>
            <tr>
              <th>Run</th>
              <th>Strategy</th>
              <th>Partition</th>
              <th>Source</th>
              <th>Trades</th>
              <th>Win</th>
              <th>PF</th>
              <th>Sharpe</th>
              <th>DD</th>
              <th>Net</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="link" href={`/backtests/${r.id}`}>
                    {r.runHash.slice(0, 10)}
                  </Link>
                </td>
                <td>
                  <StrategyLink id={r.strategyVersionId} />
                </td>
                <td>{r.partition}</td>
                <td>{r.source}</td>
                <td>{r.tradeCount}</td>
                <td>{fmtPct(r.winRate)}</td>
                <td className={r.profitFactor >= 1 ? "good" : "bad"}>{r.profitFactor.toFixed(2)}</td>
                <td>{r.sharpe.toFixed(2)}</td>
                <td>{fmtPct(r.maxDrawdown)}</td>
                <td className={Number(r.netProfit) >= 0 ? "good" : "bad"}>{fmtNum(r.netProfit)}</td>
                <td>{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
