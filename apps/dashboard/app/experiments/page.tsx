import { ErrorBox, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { Experiment } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const [{ data, error }, stats, campaigns] = await Promise.all([
    api<Experiment[]>("/api/experiments?limit=500"),
    api<{ strategies: number; strategyVersions: number; experiments: number; parameterConfigurations: number; byStage: Record<string, number>; totalTrials: number }>("/api/research/stats"),
    api<{ id: string; name: string; status: string; markets: string[]; timeframe: string; createdAt: string }[]>("/api/campaigns"),
  ]);
  const s = stats.data;
  return (
    <div className="space-y-3">
      <PageTitle sub="Failed experiments are never hidden. The total trial count feeds multiple-testing correction.">Experiments & Research</PageTitle>
      <ErrorBox error={error} />
      {s ? (
        <Panel title="Research dashboard">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div>Strategies tested: {s.strategies.toLocaleString("en-GB")}</div>
            <div>Parameter configurations: {s.parameterConfigurations.toLocaleString("en-GB")}</div>
            <div>Rejected: {s.byStage.RETIRED ?? 0}</div>
            <div>Incubating: {s.byStage.INCUBATING ?? 0}</div>
            <div>Paper: {s.byStage.PAPER ?? 0}</div>
            <div>Approved: {s.byStage.APPROVED ?? 0}</div>
          </div>
        </Panel>
      ) : null}
      <Panel title="Campaigns">
        <table className="data">
          <thead>
            <tr>
              <th>Id</th>
              <th>Name</th>
              <th>Markets</th>
              <th>TF</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(campaigns.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.name}</td>
                <td>{c.markets.join(", ")}</td>
                <td>{c.timeframe}</td>
                <td>{c.status}</td>
                <td>{fmtTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Experiments">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Strategy</th>
              <th>Market</th>
              <th>Configs</th>
              <th>Status</th>
              <th>Verdict</th>
              <th>Dataset</th>
              <th>Source</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.number}</td>
                <td>{e.kind}</td>
                <td>
                  <StrategyLink id={e.strategyVersionId} />
                </td>
                <td>{e.market}</td>
                <td>{e.configurationsTested}</td>
                <td className={e.status === "passed" ? "good" : e.status === "rejected" || e.status === "failed" ? "bad" : ""}>{e.status}</td>
                <td>{e.verdict}</td>
                <td>{e.datasetVersion}</td>
                <td>{e.source}</td>
                <td>{fmtTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
