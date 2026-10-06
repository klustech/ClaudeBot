import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Locates the monorepo root (directory containing pnpm-workspace.yaml). */
export function repoRoot(start: string = process.env.REPO_ROOT ?? process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function fromRoot(...segments: string[]): string {
  return join(repoRoot(), ...segments);
}
