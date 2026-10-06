import { ErrorBox, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtPct } from "@/lib/api";
import type { ExecutorStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const { data, error } = await api<{
    executor: ExecutorStatus | null;
    executorError: string | null;
    selection: { ranked: { id: string; score: number; market?: string; family?: string }[]; selected: string[]; rejected: { id: string; reason: string }[] };
    openPositions: { id: string; strategyVersionId: string; market: string; direction: string; stake: string }[];
  }>("/api/portfolio");
  if (!data) return <ErrorBox error={error} />;
  const ex = data.executor;
  return (
    <div className="space-y-3">
      <PageTitle sub="Risk is allocated across strategies; selection rejects correlated return streams (max 5, |ρ| ≤ 0.5, one per family×market).">Portfolio</PageTitle>
      <ErrorBox error={data.executorError} />
      {ex ? (
        <Panel title="Book">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div>Equity: {fmtNum(ex.equity)} {ex.currency}</div>
            <div>Exposure: {fmtNum(ex.exposure)}</div>
            <div>Drawdown: {fmtPct(ex.drawdown)}</div>
            <div>Open positions: {ex.openPositions.length}</div>
            <div>Consecutive losses: {ex.consecutiveLosses}</div>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Diversified selection">
          <ul>
            {data.selection.selected.map((s) => (
              <li key={s}>
                <StrategyLink id={s} />
              </li>
            ))}
          </ul>
          {data.selection.rejected.length ? (
            <>
              <div className="muted mt-2 text-[11px] uppercase">Excluded</div>
              <ul>
                {data.selection.rejected.map((r) => (
                  <li key={r.id}>
                    <StrategyLink id={r.id} /> <span className="muted">— {r.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Panel>
        <Panel title="Leaderboard">
          <table className="data">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Family</th>
                <th>Market</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.selection.ranked
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      <StrategyLink id={r.id} />
                    </td>
                    <td>{r.family}</td>
                    <td>{r.market}</td>
                    <td>{r.score.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
