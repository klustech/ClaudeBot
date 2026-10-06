import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "@ct/shared";

export interface KillSwitchState {
  engaged: boolean;
  reason?: string;
  engagedAt?: string;
  engagedBy?: string;
}

/**
 * Global kill switch persisted to disk so every process (API, executor,
 * worker, MCP server) sees it. When the file exists, trading is halted.
 * Engaging is always allowed; releasing requires a named human.
 */
export class KillSwitch {
  readonly path: string;

  constructor(path?: string) {
    this.path = path ?? join(repoRoot(), process.env.RUNTIME_DIR ?? "runtime", "KILL_SWITCH");
  }

  state(): KillSwitchState {
    if (!existsSync(this.path)) return { engaged: false };
    try {
      return { engaged: true, ...(JSON.parse(readFileSync(this.path, "utf8")) as Omit<KillSwitchState, "engaged">) };
    } catch {
      // Unreadable file still means engaged: fail closed.
      return { engaged: true, reason: "unreadable kill switch file" };
    }
  }

  isEngaged(): boolean {
    return existsSync(this.path);
  }

  engage(reason: string, engagedBy = "system"): KillSwitchState {
    mkdirSync(dirname(this.path), { recursive: true });
    const s = { reason, engagedBy, engagedAt: new Date().toISOString() };
    writeFileSync(this.path, JSON.stringify(s, null, 2));
    return { engaged: true, ...s };
  }

  release(releasedBy: string): void {
    if (!releasedBy.trim() || releasedBy === "claude" || releasedBy === "system") {
      throw new Error("The kill switch can only be released by a named human operator");
    }
    rmSync(this.path, { force: true });
  }
}
