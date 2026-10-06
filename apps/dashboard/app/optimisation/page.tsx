import { ErrorBox, Json, PageTitle, Panel, StrategyLink } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";
import type { Experiment } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Top {
  params: Record<string, unknown>;
  score: number;
  penalties: string[];
  expectancyR: number;
  trades: number;
  pf: number;
}

export default async function OptimisationPage() {
  const { data, error } = await api<Experiment[]>("/api/experiments?limit=500");
  const opts = (data ?? []).filter((e) => e.kind === "optimisation");
  return (
    <div className="space-y-3">
      <PageTitle sub="Composite objective on TRAIN only: 0.25·expectancy + 0.20·PF + 0.15·Sharpe + 0.15·OOS + 0.10·stability + 0.10·drawdown + 0.05·sample, with penalties.">
        Optimisation
      </PageTitle>
      <ErrorBox error={error} />
      {opts.map((e) => {
        const top = ((e.resultSummary?.top as Top[] | undefined) ?? []).slice(0, 8);
        return (
          <Panel key={e.id} title={`#${e.number} · ${e.template} · ${e.market} · ${e.configurationsTested} configs · ${fmtTime(e.createdAt)}`} right={<StrategyLink id={e.strategyVersionId} />}>
            <table className="data">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Trades</th>
                  <th>E[R]</th>
                  <th>PF</th>
                  <th>Penalties</th>
                  <th>Params</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t, i) => (
                  <tr key={i}>
                    <td>{t.score.toFixed(1)}</td>
                    <td>{t.trades}</td>
                    <td className={t.expectancyR > 0 ? "good" : "bad"}>{t.expectancyR.toFixed(4)}</td>
                    <td>{t.pf.toFixed(2)}</td>
                    <td className="muted">{t.penalties.join("; ")}</td>
                    <td>
                      <Json value={t.params} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        );
      })}
      {opts.length === 0 ? <div className="muted">No optimisation runs yet.</div> : null}
    </div>
  );
}
