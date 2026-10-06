import { ErrorBox, Json, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { Decision } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const { data, error } = await api<Decision[]>("/api/decisions?limit=300");
  return (
    <div className="space-y-3">
      <PageTitle sub="Append-only audit trail (enforced by a database trigger).">Claude Decisions</PageTitle>
      <ErrorBox error={error} />
      {(data ?? []).map((d) => (
        <Panel key={d.id} title={`${fmtTime(d.timestamp)} · ${d.actor} · ${d.model} · session ${d.sessionId}`}>
          <div>
            <b>{d.action}</b> → <span className="good">{d.outputDecision}</span> {d.strategyId ? <StrategyLink id={d.strategyId} /> : null}
          </div>
          <div className="mt-1">{d.reason}</div>
          {Object.keys(d.evidence).length ? (
            <details className="mt-1">
              <summary className="muted cursor-pointer">evidence / input metrics</summary>
              <Json value={{ evidence: d.evidence, inputMetrics: d.inputMetrics }} />
            </details>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}
