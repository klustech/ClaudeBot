import { ErrorBox, PageTitle, Panel, StageBadge, Stat, StrategyLink } from "@/components/ui";
import { api, fmtNum, fmtPct, fmtTime } from "@/lib/api";
import type { ExecutorStatus, StrategyVersion, Trade } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Overview {
  mode: string;
  tradingEnabled: boolean;
  liveTradingEnabled: boolean;
  killSwitch: { engaged: boolean; reason?: string };
  executor: ExecutorStatus | null;
  research: { strategies: number; strategyVersions: number; experiments: number; parameterConfigurations: number; byStage: Record<string, number> };
  activeStrategies: StrategyVersion[];
  candidates: StrategyVersion[];
  openPositions: { id: string; strategyVersionId: string; market: string; direction: string; stake: string; entryPrice: string; openedAt: string }[];
  recentTrades: Trade[];
  researchQueue: { id: string; kind: string; status: string; progress: string[] }[];
}

export default async function OverviewPage() {
  const { data, error } = await api<Overview>("/api/overview");
  if (!data) return <ErrorBox error={error} />;
  const ex = data.executor;
  const start = Number(ex?.startingBalance ?? 0);
  const equity = Number(ex?.equity ?? 0);
  const pnl = start > 0 ? equity / start - 1 : 0;
  const ccy = ex?.currency === "GBP" ? "£" : ex?.currency === "USD" ? "$" : "";
  return (
    <div className="space-y-4">
      <PageTitle sub={`Kill switch: ${data.killSwitch.engaged ? `ENGAGED (${data.killSwitch.reason ?? ""})` : "off"} · Trading ${data.tradingEnabled ? "enabled" : "disabled"} · Live ${data.liveTradingEnabled ? "ENABLED" : "disabled"}`}>
        AI TRADING MISSION CONTROL
      </PageTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Mode" value={data.mode} tone={data.mode === "LIVE" ? "warn" : undefined} />
        <Stat label="Balance" value={ex ? `${ccy}${fmtNum(start)}` : "executor down"} tone={ex ? undefined : "bad"} />
        <Stat label="Equity" value={ex ? `${ccy}${fmtNum(equity)}` : "-"} />
        <Stat label="P&L" value={ex ? fmtPct(pnl) : "-"} tone={pnl >= 0 ? "good" : "bad"} />
        <Stat label="DD" value={ex ? fmtPct(-ex.drawdown) : "-"} tone={ex && ex.drawdown > 0.05 ? "bad" : undefined} />
        <Stat label="Breakers" value={ex ? ex.breakers.length : "-"} tone={ex && ex.breakers.length ? "bad" : "good"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Active strategies">
          <table className="data">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Market</th>
                <th>Stage</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {data.activeStrategies.map((s) => (
                <tr key={s.id}>
                  <td>
                    <StrategyLink id={s.id} />
                    <div className="muted text-[11px]">{s.name}</div>
                  </td>
                  <td>{s.market}</td>
                  <td>
                    <StageBadge stage={s.stage} />
                  </td>
                  <td>{s.confidence !== null ? `${s.confidence.toFixed(0)}/100` : "-"}</td>
                </tr>
              ))}
              {data.activeStrategies.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No strategies in PAPER/APPROVED/LIVE.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {data.candidates.length ? (
            <div className="mt-3">
              <div className="muted mb-1 text-[11px] uppercase">Incubating candidates</div>
              {data.candidates.map((c) => (
                <div key={c.id}>
                  <StrategyLink id={c.id} /> <span className="muted">{c.confidence?.toFixed(0)}/100</span>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
        <Panel title="Research">
          <div className="grid grid-cols-2 gap-2">
            <div>Strategies tested: {data.research.strategies.toLocaleString("en-GB")}</div>
            <div>Versions: {data.research.strategyVersions.toLocaleString("en-GB")}</div>
            <div>Parameter configurations: {data.research.parameterConfigurations.toLocaleString("en-GB")}</div>
            <div>Experiments: {data.research.experiments.toLocaleString("en-GB")}</div>
            <div>Rejected: {data.research.byStage.RETIRED ?? 0}</div>
            <div>Incubating: {data.research.byStage.INCUBATING ?? 0}</div>
            <div>Paper: {data.research.byStage.PAPER ?? 0}</div>
            <div>Approved: {data.research.byStage.APPROVED ?? 0}</div>
            <div>Live: {data.research.byStage.LIVE ?? 0}</div>
          </div>
          <div className="mt-3 muted text-[11px] uppercase">Research queue</div>
          {data.researchQueue.length === 0 ? <div className="muted">idle</div> : null}
          {data.researchQueue.map((j) => (
            <div key={j.id}>
              {j.kind} — {j.status} <span className="muted">{j.progress.at(-1) ?? ""}</span>
            </div>
          ))}
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Open trades">
          <table className="data">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Dir</th>
                <th>Stake</th>
                <th>Entry</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {data.openPositions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <StrategyLink id={p.strategyVersionId} />
                  </td>
                  <td>{p.direction}</td>
                  <td>{fmtNum(p.stake)}</td>
                  <td>{fmtNum(p.entryPrice, 4)}</td>
                  <td>{fmtTime(p.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.openPositions.length === 0 ? <div className="muted">none</div> : null}
        </Panel>
        <Panel title="Recent trades">
          <table className="data">
            <thead>
              <tr>
                <th>Closed</th>
                <th>Strategy</th>
                <th>Dir</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTrades.map((t) => (
                <tr key={t.id}>
                  <td>{fmtTime(t.exitTime)}</td>
                  <td>
                    <StrategyLink id={t.strategyVersionId} />
                  </td>
                  <td>{t.direction}</td>
                  <td className={Number(t.pnl) >= 0 ? "good" : "bad"}>{fmtNum(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recentTrades.length === 0 ? <div className="muted">none</div> : null}
        </Panel>
      </div>
    </div>
  );
}
