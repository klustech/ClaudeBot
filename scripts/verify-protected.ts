/**
 * Verifies protected configuration against config/PROTECTED.sha256.
 *
 *   pnpm verify:protected            # check (CI, startup)
 *   pnpm verify:protected --update   # HUMAN ONLY: re-pin after reviewing a change
 *
 * Claude Code is denied write access to these files via .claude/settings.json
 * and must never run --update.
 */
import { checkProtectedFiles, writeManifest } from "@ct/core";

if (process.argv.includes("--update")) {
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) {
    console.error("Refusing: protected hashes can only be re-pinned by a human operator, not by Claude Code.");
    process.exit(2);
  }
  process.stdout.write(writeManifest());
  process.exit(0);
}
const results = checkProtectedFiles();
for (const r of results) console.log(`${r.ok ? "OK " : "BAD"}  ${r.file}`);
if (results.some((r) => !r.ok)) {
  console.error("\nProtected configuration does not match pinned hashes. Trading and research are blocked until a human reviews and re-pins.");
  process.exit(1);
}
