import { ErrorBox, Json, PageTitle, Panel } from "@/components/ui";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { data, error } = await api<Record<string, unknown>>("/api/settings");
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <PageTitle sub="Read-only. Protected files are changed by a human, then re-pinned with pnpm verify:protected --update.">Settings</PageTitle>
      <Panel title="Runtime flags">
        <Json value={{ tradingMode: data.tradingMode, tradingEnabled: data.tradingEnabled, liveTradingEnabled: data.liveTradingEnabled, exchange: data.exchange, exchangeReadOnly: data.exchangeReadOnly, currency: data.currency }} />
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Risk limits">
          <Json value={data.riskLimits} />
        </Panel>
        <Panel title="Validation thresholds">
          <Json value={data.validationThresholds} />
        </Panel>
      </div>
    </div>
  );
}
