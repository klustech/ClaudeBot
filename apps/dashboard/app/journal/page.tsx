import { ErrorBox, PageTitle, Panel } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const { data, error } = await api<{ id: number; at: string; title: string; body: string }[]>("/api/journal");
  return (
    <div className="space-y-3">
      <PageTitle sub="Also written to reports/research/YYYY-MM-DD.md">AI Research Journal</PageTitle>
      <ErrorBox error={error} />
      {(data ?? []).map((j) => (
        <Panel key={j.id} title={fmtTime(j.at)}>
          <pre className="whitespace-pre-wrap">{j.body}</pre>
        </Panel>
      ))}
    </div>
  );
}
