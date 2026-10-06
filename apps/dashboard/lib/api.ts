const API_URL = process.env.API_URL ?? "http://127.0.0.1:4100";

export async function api<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { data: null, error: `${res.status} ${await res.text()}` };
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: `API unreachable at ${API_URL}: ${(err as Error).message}` };
  }
}

export const fmtPct = (x: number | null | undefined, dp = 1): string => (x === null || x === undefined || !Number.isFinite(x) ? "-" : `${(x * 100).toFixed(dp)}%`);
export const fmtNum = (x: number | string | null | undefined, dp = 2): string => {
  const n = typeof x === "string" ? Number(x) : x;
  return n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
export const fmtTime = (x: string | number | null | undefined): string => (x ? new Date(x).toISOString().replace("T", " ").slice(0, 19) : "-");

export type Row = Record<string, unknown>;
