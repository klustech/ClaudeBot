import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { repoRoot } from "@ct/shared";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const local = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  // When bundled into an app's dist/, fall back to the repository copy.
  return existsSync(join(local, "meta", "_journal.json")) ? local : join(repoRoot(), "packages", "database", "migrations");
}

export const MIGRATIONS_DIR = migrationsDir();

/**
 * Opens the database. Uses PostgreSQL when DATABASE_URL is set; otherwise an
 * embedded PGlite database (PGLITE_DIR, or in-memory for tests) so the system
 * runs without Docker during development. Migrations are applied on open.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string; memory?: boolean } = {}): Promise<DatabaseHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url && !opts.memory) {
    const client = postgres(url, { max: 10, onnotice: () => undefined });
    const db = drizzlePg(client, { schema }) as unknown as Db;
    await migratePg(drizzlePg(client, { schema }), { migrationsFolder: MIGRATIONS_DIR });
    return { db, kind: "postgres", close: () => client.end() };
  }
  const dir = opts.memory ? undefined : (opts.pgliteDir ?? process.env.PGLITE_DIR ?? join(repoRoot(), ".pglite"));
  if (dir) mkdirSync(dir, { recursive: true });
  const client = dir ? new PGlite(dir) : new PGlite();
  const pg = drizzlePglite(client, { schema });
  await migratePglite(pg, { migrationsFolder: MIGRATIONS_DIR });
  return { db: pg as unknown as Db, kind: "pglite", close: () => client.close() };
}
