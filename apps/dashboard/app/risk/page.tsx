import { ErrorBox, Json, PageTitle, Panel } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const { data, error } = await api<{
    limits: Record<string, unknown>;
    killSwitch: { engaged: boolean; reason?: string; engagedAt?: string; engagedBy?: string };
    breakers: { name: string; reason: string; at: number; scope: string }[] | null;
    executorReachable: boolean;
    events: { id: number; at: string; kind: string; code: string; message: string; strategyVersionId: string | null }[];
  }>("/api/risk");
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <PageTitle sub="The deterministic risk engine is the final authority. Claude can request; it can never bypass.">Risk</PageTitle>
      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Kill switch">
          <div className={data.killSwitch.engaged ? "bad text-lg" : "good text-lg"}>{data.killSwitch.engaged ? "ENGAGED" : "off"}</div>
          {data.killSwitch.engaged ? (
            <div className="muted">
              {data.killSwitch.reason} — {data.killSwitch.engagedBy} at {data.killSwitch.engagedAt}
            </div>
          ) : null}
          <div className="muted mt-2 text-[11px]">Engage: pnpm trading:kill. Release: human only (pnpm trading:kill --release --by NAME).</div>
        </Panel>
        <Panel title="Circuit breakers">
          {!data.executorReachable ? <div className="bad">executor unreachable — fail closed</div> : null}
          {(data.breakers ?? []).map((b) => (
            <div key={`${b.scope}:${b.name}`} className="bad">
              {b.name} <span className="muted">[{b.scope}] {b.reason}</span>
            </div>
          ))}
          {data.breakers && data.breakers.length === 0 ? <div className="good">all closed</div> : null}
        </Panel>
        <Panel title="Limits (protected)">
          <Json value={data.limits} />
        </Panel>
      </div>
      <Panel title="Risk events">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Code</th>
              <th>Strategy</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td>{fmtTime(e.at)}</td>
                <td>{e.kind}</td>
                <td>{e.code}</td>
                <td>{e.strategyVersionId}</td>
                <td className="muted">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
