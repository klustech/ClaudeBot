import { pearson } from "@ct/shared";

export interface ReturnStream {
  id: string;
  /** Map of bucket (e.g. UTC day start ms) → summed return. */
  buckets: Map<number, number>;
}

const DAY = 86_400_000;

export function dailyReturnStream(id: string, trades: readonly { exitTime: number; returnOnStake: number }[]): ReturnStream {
  const buckets = new Map<number, number>();
  for (const t of trades) {
    const d = Math.floor(t.exitTime / DAY) * DAY;
    buckets.set(d, (buckets.get(d) ?? 0) + t.returnOnStake);
  }
  return { id, buckets };
}

export function streamCorrelation(a: ReturnStream, b: ReturnStream): number {
  const keys = [...new Set([...a.buckets.keys(), ...b.buckets.keys()])].sort((x, y) => x - y);
  if (keys.length < 5) return 0;
  return pearson(
    keys.map((k) => a.buckets.get(k) ?? 0),
    keys.map((k) => b.buckets.get(k) ?? 0),
  );
}

export function correlationMatrix(streams: readonly ReturnStream[]): { ids: string[]; matrix: number[][] } {
  const ids = streams.map((s) => s.id);
  const matrix = streams.map((a) => streams.map((b) => (a === b ? 1 : streamCorrelation(a, b))));
  return { ids, matrix };
}

export interface SelectionCandidate {
  id: string;
  score: number;
  stream: ReturnStream;
  market?: string;
  family?: string;
}

/**
 * Greedy diversified selection: take the best-scoring candidate, then the
 * next best whose correlation with every selected strategy is below maxCorr.
 */
export function selectDiversified(
  candidates: readonly SelectionCandidate[],
  opts: { maxStrategies: number; maxCorrelation: number; maxPerFamilyMarket?: number },
): { selected: SelectionCandidate[]; rejected: { id: string; reason: string }[] } {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  const selected: SelectionCandidate[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const perFm = new Map<string, number>();
  for (const c of sorted) {
    if (selected.length >= opts.maxStrategies) {
      rejected.push({ id: c.id, reason: "portfolio full" });
      continue;
    }
    const fm = `${c.family ?? "?"}|${c.market ?? "?"}`;
    if (opts.maxPerFamilyMarket !== undefined && (perFm.get(fm) ?? 0) >= opts.maxPerFamilyMarket) {
      rejected.push({ id: c.id, reason: `already holding ${fm}` });
      continue;
    }
    const tooCorrelated = selected.find((s) => Math.abs(streamCorrelation(s.stream, c.stream)) > opts.maxCorrelation);
    if (tooCorrelated) {
      rejected.push({ id: c.id, reason: `correlated with ${tooCorrelated.id}` });
      continue;
    }
    selected.push(c);
    perFm.set(fm, (perFm.get(fm) ?? 0) + 1);
  }
  return { selected, rejected };
}
