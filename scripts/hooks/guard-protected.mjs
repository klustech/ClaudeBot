#!/usr/bin/env node
// Claude Code PreToolUse hook. Blocks autonomous modification of protected
// configuration, live-trading enablement, kill-switch release and hash re-pinning.
// Exit code 2 = block (stderr is shown to Claude).
import { readFileSync } from "node:fs";

const PROTECTED = ["validation/locked-periods.json", "config/risk-limits.json", "config/validation-thresholds.json", "config/live-permissions.json", "config/PROTECTED.sha256", ".claude/settings.json", "scripts/hooks/guard-protected.mjs"];

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const tool = input.tool_name ?? "";
const ti = input.tool_input ?? {};
const block = (why) => {
  process.stderr.write(`BLOCKED by trading safety policy: ${why}. Propose the change to a human instead (see CLAUDE.md).\n`);
  process.exit(2);
};

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const p = String(ti.file_path ?? ti.notebook_path ?? "");
  if (PROTECTED.some((f) => p.endsWith(f))) block(`${f(p)} is protected`);
}
if (tool === "Bash") {
  const cmd = String(ti.command ?? "");
  const mentionsProtected = PROTECTED.some((f) => cmd.includes(f));
  const writes = /(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bperl\s+-pi|\bpython3?\b.*open\(|writeFile)/.test(cmd);
  if (mentionsProtected && writes) block("shell command would modify protected configuration");
  if (/verify[:-]protected.*--update|verify-protected\.ts.*--update/.test(cmd)) block("re-pinning protected hashes is human-only");
  if (/trading[:-]kill.*--release|trading-kill\.ts.*--release/.test(cmd)) block("releasing the kill switch is human-only");
  if (/LIVE_TRADING_ENABLED\s*=\s*(true|1|yes|on)/i.test(cmd)) block("enabling live trading is human-only");
  if (/TRADING_MODE\s*=\s*live/i.test(cmd)) block("LIVE mode is human-only");
}
process.exit(0);
function f(p) {
  return p;
}
