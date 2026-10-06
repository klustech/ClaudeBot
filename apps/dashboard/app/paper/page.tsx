import Link from "next/link";
import { ErrorBox, PageTitle, Panel } from "@/components/ui";
import { api, fmtNum, fmtTime } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PaperPage() {
  const { data, error } = await api<{ id: string; name: string; status: string; startingBalance: string; currency: string; strategyVersionIds: string[]; startedAt: string; endedAt: string | null }[]>("/api/paper/sessions");
  return (
    <div className="space-y-3">
      <PageTitle sub="Simulated latency, missed entries, spread, slippage, fees, payouts, rejections and disconnects. Graduation by trade count: 100 → 250 → 500 → 1,000.">
        Paper Trading
      </PageTitle>
      <ErrorBox error={error} />
      <Panel>
        <table className="data">
          <thead>
            <tr>
              <th>Session</th>
              <th>Status</th>
              <th>Start balance</th>
              <th>Strategies</th>
              <th>Started</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <Link className="link" href={`/paper/${s.id}`}>
                    {s.id}
                  </Link>
                </td>
                <td>{s.status}</td>
                <td>
                  {fmtNum(s.startingBalance)} {s.currency}
                </td>
                <td>{s.strategyVersionIds.length}</td>
                <td>{fmtTime(s.startedAt)}</td>
                <td>{fmtTime(s.endedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
