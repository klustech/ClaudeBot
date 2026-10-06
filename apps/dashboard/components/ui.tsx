import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel">
      {title ? (
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider muted">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="panel">
      <div className="text-[11px] uppercase tracking-wider muted">{label}</div>
      <div className={`mt-1 text-xl ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

const STAGE_TONE: Record<string, string> = {
  IDEA: "bg-slate-700",
  RESEARCH: "bg-slate-600",
  BACKTESTED: "bg-sky-800",
  VALIDATING: "bg-indigo-800",
  INCUBATING: "bg-violet-800",
  PAPER: "bg-amber-700",
  APPROVED: "bg-emerald-800",
  LIVE: "bg-emerald-600",
  DEGRADED: "bg-orange-700",
  RETIRED: "bg-zinc-800",
};

export function StageBadge({ stage }: { stage: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${STAGE_TONE[stage] ?? "bg-zinc-700"}`}>{stage}</span>;
}

export function PassBadge({ passed }: { passed: boolean }) {
  return <span className={passed ? "good" : "bad"}>{passed ? "PASS" : "FAIL"}</span>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="panel bad">{error}</div>;
}

export function StrategyLink({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="muted">-</span>;
  return (
    <Link className="link" href={`/strategies/${encodeURIComponent(id)}`}>
      {id}
    </Link>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg tracking-wide">{children}</h1>
      {sub ? <div className="muted text-xs">{sub}</div> : null}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[11px] muted">{JSON.stringify(value, null, 2)}</pre>;
}
