import { defineConfig } from "tsup";

// Workspace packages are bundled; third-party runtime deps (incl. PGlite's
// wasm assets and the Postgres driver) stay external and resolve from node_modules.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/^@ct\//],
  external: ["@electric-sql/pglite", "postgres", "drizzle-orm", "pino", "fastify", "@fastify/cors", "bullmq", "ioredis", "decimal.js", "zod"],
  clean: true,
  sourcemap: true,
});
