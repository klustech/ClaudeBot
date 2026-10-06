export const LATENCY_STAGES = [
  "signal",
  "decision",
  "risk_approved",
  "execution_requested",
  "broker_accepted",
  "broker_settled",
] as const;
export type LatencyStage = (typeof LATENCY_STAGES)[number];

/**
 * Records a timestamp for every stage of the trade pipeline so latency per
 * stage can be measured and persisted with each order.
 */
export class LatencyTrace {
  private readonly marks = new Map<LatencyStage, number>();

  constructor(private readonly now: () => number = Date.now) {}

  mark(stage: LatencyStage, at: number = this.now()): this {
    this.marks.set(stage, at);
    return this;
  }

  get(stage: LatencyStage): number | undefined {
    return this.marks.get(stage);
  }

  /** Milliseconds between consecutive recorded stages. */
  breakdown(): Partial<Record<string, number>> {
    const out: Record<string, number> = {};
    let prev: { stage: LatencyStage; t: number } | undefined;
    for (const stage of LATENCY_STAGES) {
      const t = this.marks.get(stage);
      if (t === undefined) continue;
      if (prev) out[`${prev.stage}->${stage}`] = t - prev.t;
      prev = { stage, t };
    }
    const first = this.marks.get("signal");
    const last = prev?.t;
    if (first !== undefined && last !== undefined) out.total = last - first;
    return out;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.marks.entries());
  }
}
