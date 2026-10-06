import { createHash } from "node:crypto";

/** Deterministic JSON serialisation with sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return sortValue((value as { toJSON: () => unknown }).toJSON());
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = sortValue(v);
  }
  return out;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}
