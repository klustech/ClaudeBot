import Link from "next/link";

const LINKS: [string, string][] = [
  ["/", "Overview"],
  ["/strategies", "Strategies"],
  ["/backtests", "Backtests"],
  ["/experiments", "Experiments"],
  ["/optimisation", "Optimisation"],
  ["/validation", "Validation"],
  ["/paper", "Paper Trading"],
  ["/portfolio", "Portfolio"],
  ["/live", "Live Trading"],
  ["/decisions", "Claude Decisions"],
  ["/journal", "Research Journal"],
  ["/risk", "Risk"],
  ["/system", "System Health"],
  ["/settings", "Settings"],
];

export function Nav() {
  return (
    <nav className="w-48 shrink-0 border-r border-[var(--border)] p-3">
      <div className="mb-4 text-xs font-bold tracking-widest">
        AI TRADING
        <br />
        MISSION CONTROL
      </div>
      <ul className="space-y-1">
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <Link className="block rounded px-2 py-1 hover:bg-[var(--panel)]" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
