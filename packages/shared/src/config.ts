import { z } from "zod";
import { TRADING_MODES } from "./types";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  REDIS_URL: z.string().optional(),
  TRADING_MODE: z
    .string()
    .default("PAPER")
    .transform((v) => v.toUpperCase())
    .pipe(z.enum(TRADING_MODES)),
  TRADING_ENABLED: bool.default(false),
  LIVE_TRADING_ENABLED: bool.default(false),
  EXCHANGE: z.string().default("paper"),
  EXCHANGE_API_KEY: z.string().optional(),
  EXCHANGE_API_SECRET: z.string().optional(),
  EXCHANGE_READ_ONLY: bool.default(true),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().default(4100),
  API_URL: z.string().default("http://127.0.0.1:4100"),
  CONTROL_API_TOKEN: z.string().optional(),
  BRIDGE_SIGNING_SECRET: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().optional(),
  RUNTIME_DIR: z.string().default("runtime"),
  REPO_ROOT: z.string().optional(),
  PAPER_STARTING_BALANCE: z.string().default("1000"),
  CURRENCY: z.string().default("GBP"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Loads configuration from the environment. Safety defaults:
 *  - TRADING_MODE defaults to PAPER
 *  - TRADING_ENABLED defaults to false
 *  - LIVE_TRADING_ENABLED defaults to false
 *  - exchange adapters default to read-only
 * LIVE mode is rejected unless LIVE_TRADING_ENABLED is explicitly true.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cfg = EnvSchema.parse(env);
  if (cfg.TRADING_MODE === "LIVE" && !cfg.LIVE_TRADING_ENABLED) {
    throw new Error("TRADING_MODE=LIVE requires LIVE_TRADING_ENABLED=true. Refusing to start.");
  }
  return cfg;
}
