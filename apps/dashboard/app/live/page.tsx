import { ErrorBox, PageTitle, Panel, StageBadge, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtTime } from "@/lib/api";
import type { StrategyVersion, Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const { data, error } = await api<{
    liveTradingEnabled: boolean;
    sessions: { id: string; mode: string; venue: string; status: string; capitalStage: number; startedAt: string }[];
    liveStrategies: StrategyVersion[];
    trades: Trade[];
  }>("/api/live");
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <PageTitle sub="Progressive capital: Stage 0 paper → £25 → £50 → £100 → £250 → normal. Promotion is performance-based and human-approved.">Live Trading</PageTitle>
      <Panel>
        <div className={data.liveTradingEnabled ? "warn" : "good"}>
          LIVE_TRADING_ENABLED = {String(data.liveTradingEnabled)}
          {data.liveTradingEnabled ? "" : " — the system is technically incapable of placing live orders."}
        </div>
      </Panel>
      <Panel title="Approved / live strategies">
        {data.liveStrategies.map((s) => (
          <div key={s.id}>
            <StrategyLink id={s.id} /> <StageBadge stage={s.stage} /> {s.liveEligible ? <span className="good">LIVE_ELIGIBLE</span> : <span className="muted">not eligible</span>}
          </div>
        ))}
        {data.liveStrategies.length === 0 ? <div className="muted">none</div> : null}
      </Panel>
      <Panel title="Sessions">
        <table className="data">
          <thead>
            <tr>
              <th>Id</th>
              <th>Mode</th>
              <th>Venue</th>
              <th>Capital stage</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{s.mode}</td>
                <td>{s.venue}</td>
                <td>{s.capitalStage}</td>
                <td>{s.status}</td>
                <td>{fmtTime(s.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Live trades">
        <table className="data">
          <tbody>
            {data.trades.map((t) => (
              <tr key={t.id}>
                <td>{fmtTime(t.exitTime)}</td>
                <td>{t.strategyVersionId}</td>
                <td>{t.direction}</td>
                <td className={Number(t.pnl) >= 0 ? "good" : "bad"}>{fmtNum(t.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.trades.length === 0 ? <div className="muted">none</div> : null}
      </Panel>
    </div>
  );
}
