import type { Repository } from "@ct/database";
import type { ResearchService } from "@ct/research";
import type { KillSwitch, RiskLimits } from "@ct/risk";
import type { AppConfig } from "@ct/shared";
import type { ValidationThresholds } from "@ct/validation";
import type { JobRunner } from "./jobs";

export interface ExecutorClient {
  call<T = unknown>(method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T | null; error?: string }>;
}

export interface ApiContext {
  cfg: AppConfig;
  repo: Repository;
  research: ResearchService;
  jobs: JobRunner;
  killSwitch: KillSwitch;
  limits: RiskLimits;
  thresholds: ValidationThresholds;
  executor: ExecutorClient;
  dbKind: string;
}

export function httpExecutorClient(baseUrl: string, token?: string, fetchImpl: typeof fetch = fetch): ExecutorClient {
  return {
    async call(method, path, body, headers = {}) {
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        return { ok: false, status: 503, data: null, error: `executor unreachable: ${(err as Error).message}` };
      }
    },
  };
}
