import { ErrorBox, PageTitle, Panel, PassBadge, StrategyLink } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { ValidationRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  const { data, error } = await api<ValidationRun[]>("/api/validation");
  return (
    <div className="space-y-3">
      <PageTitle sub="Locked TRAIN / VALIDATION / TEST periods. TEST is only evaluated once, after a version is frozen.">Validation Laboratory</PageTitle>
      <ErrorBox error={error} />
      <Panel>
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Strategy</th>
              <th>Kind</th>
              <th>Result</th>
              <th>Confidence</th>
              <th>Trials</th>
              <th>Failed checks</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((v) => (
              <tr key={v.id}>
                <td>{fmtTime(v.createdAt)}</td>
                <td>
                  <StrategyLink id={v.strategyVersionId} />
                </td>
                <td>{v.kind}</td>
                <td>
                  <PassBadge passed={v.passed} />
                </td>
                <td>{v.confidence?.toFixed(1) ?? "-"}</td>
                <td>{v.trials.toLocaleString("en-GB")}</td>
                <td className="muted text-[11px]">
                  {v.checks
                    .filter((c) => !c.passed)
                    .map((c) => `${c.name} (${c.detail})`)
                    .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
