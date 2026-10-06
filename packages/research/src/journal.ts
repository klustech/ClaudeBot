import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repository } from "@ct/database";
import { repoRoot } from "@ct/shared";

export interface JournalEntry {
  experimentNumber?: number;
  title: string;
  hypothesis?: string;
  result: string;
  reason: string;
  observed?: string;
  next?: string;
  campaignId?: string | null;
  experimentId?: string | null;
}

export function formatJournalEntry(e: JournalEntry): string {
  const lines = [
    `## ${e.experimentNumber !== undefined ? `Experiment ${e.experimentNumber.toLocaleString("en-GB")} — ` : ""}${e.title}`,
    "",
    `*${new Date().toISOString()}*`,
    "",
  ];
  if (e.hypothesis) lines.push("**Hypothesis:**", e.hypothesis, "");
  lines.push("**Result:**", e.result, "", "**Reason:**", e.reason, "");
  if (e.observed) lines.push("**Observed:**", e.observed, "");
  if (e.next) lines.push("**Next:**", e.next, "");
  return lines.join("\n") + "\n";
}

/** Appends to reports/research/YYYY-MM-DD.md and the research_journal table. */
export async function writeJournal(repo: Repository | null, e: JournalEntry, root = repoRoot()): Promise<string> {
  const dir = join(root, "reports", "research");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}.md`);
  if (!existsSync(file)) writeFileSync(file, `# Research Journal — ${new Date().toISOString().slice(0, 10)}\n\n`);
  const body = formatJournalEntry(e);
  appendFileSync(file, body);
  await repo?.addJournal({ title: e.title, body, campaignId: e.campaignId ?? null, experimentId: e.experimentId ?? null });
  return file;
}
