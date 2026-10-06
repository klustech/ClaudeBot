import Link from "next/link";
import { ErrorBox, PageTitle, Panel, StageBadge, StrategyLink } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { StrategyVersion } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGES = ["", "IDEA", "RESEARCH", "BACKTESTED", "VALIDATING", "INCUBATING", "PAPER", "APPROVED", "LIVE", "DEGRADED", "RETIRED"];

export default async function StrategiesPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage } = await searchParams;
  const { data, error } = await api<StrategyVersion[]>(`/api/strategies${stage ? `?stage=${stage}` : ""}`);
  return (
    <div className="space-y-3">
      <PageTitle sub="Every version is immutable. Changes create new versions; nothing is overwritten.">Strategies</PageTitle>
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Link key={s} href={s ? `/strategies?stage=${s}` : "/strategies"} className={`rounded border border-[var(--border)] px-2 py-0.5 ${stage === s || (!stage && !s) ? "bg-[var(--panel)]" : ""}`}>
            {s || "ALL"}
          </Link>
        ))}
      </div>
      <ErrorBox error={error} />
      <Panel>
        <table className="data">
          <thead>
            <tr>
              <th>Version</th>
              <th>Template</th>
              <th>Market</th>
              <th>TF</th>
              <th>Gen</th>
              <th>Stage</th>
              <th>Confidence</th>
              <th>Frozen</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <StrategyLink id={s.id} />
                </td>
                <td>{s.template}</td>
                <td>{s.market}</td>
                <td>{s.timeframe}</td>
                <td>{s.generation}</td>
                <td>
                  <StageBadge stage={s.stage} />
                </td>
                <td>{s.confidence?.toFixed(1) ?? "-"}</td>
                <td>{s.frozenAt ? "yes" : ""}</td>
                <td>{fmtTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
