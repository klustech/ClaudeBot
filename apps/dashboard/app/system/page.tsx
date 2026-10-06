import { ErrorBox, PageTitle, Panel } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { ExecutorStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const { data, error } = await api<{
    db: string;
    executor: string;
    executorError: string | null;
    executorStatus: ExecutorStatus | null;
    protectedFiles: { file: string; ok: boolean }[];
    alerts: { id: number; at: string; type: string; severity: string; message: string }[];
    systemEvents: { id: number; at: string; source: string; level: string; message: string }[];
    jobs: { id: string; kind: string; status: string; createdAt: string; error?: string }[];
  }>("/api/system");
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <PageTitle>System Health</PageTitle>
      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Services">
          <div>Database: {data.db}</div>
          <div className={data.executor === "up" ? "good" : "bad"}>Executor: {data.executor}</div>
          {data.executorError ? <div className="muted">{data.executorError}</div> : null}
          {data.executorStatus ? (
            <div className="mt-2">
              <div>Venue: {data.executorStatus.venue}</div>
              <div>State known: {String(data.executorStatus.stateKnown)}</div>
              {data.executorStatus.markets.map((m) => (
                <div key={m.market} className={m.dataAgeMs !== null && m.dataAgeMs < 120_000 ? "good" : "warn"}>
                  {m.market} {m.timeframe} feed age {m.dataAgeMs === null ? "never" : `${Math.round(m.dataAgeMs / 1000)}s`}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
        <Panel title="Protected configuration">
          {data.protectedFiles.map((p) => (
            <div key={p.file} className={p.ok ? "good" : "bad"}>
              {p.ok ? "OK " : "TAMPERED "} {p.file}
            </div>
          ))}
        </Panel>
        <Panel title="Jobs">
          {data.jobs.slice(0, 15).map((j) => (
            <div key={j.id}>
              {j.kind} <span className={j.status === "failed" ? "bad" : "muted"}>{j.status}</span> {j.error ? <span className="bad">{j.error}</span> : null}
            </div>
          ))}
        </Panel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Alerts">
          {data.alerts.map((a) => (
            <div key={a.id} className={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : ""}>
              <span className="muted">{fmtTime(a.at)}</span> {a.type}: {a.message}
            </div>
          ))}
        </Panel>
        <Panel title="System events">
          {data.systemEvents.map((e) => (
            <div key={e.id}>
              <span className="muted">{fmtTime(e.at)}</span> [{e.level}] {e.source}: {e.message}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
