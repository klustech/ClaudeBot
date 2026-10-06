import { newId } from "@ct/shared";

export type JobKind = "campaign" | "research_strategy" | "optimise" | "validate" | "daily_report" | "weekly_review";

export interface JobRecord {
  id: string;
  kind: JobKind;
  status: "queued" | "running" | "completed" | "failed";
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  progress: string[];
  createdAt: string;
  finishedAt?: string;
}

export interface JobRunner {
  submit(kind: JobKind, input: Record<string, unknown>): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  list(): Promise<JobRecord[]>;
}

export type JobHandler = (kind: JobKind, input: Record<string, unknown>, progress: (m: string) => void) => Promise<unknown>;

/**
 * In-process job runner (development / single node). Jobs run sequentially so
 * research never competes with itself for CPU. With REDIS_URL set, the API
 * uses BullMQ and apps/worker processes the jobs instead.
 */
export class InlineJobRunner implements JobRunner {
  private readonly jobs = new Map<string, JobRecord>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly handler: JobHandler) {}

  async submit(kind: JobKind, input: Record<string, unknown>): Promise<JobRecord> {
    const job: JobRecord = { id: newId(), kind, status: "queued", input, progress: [], createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    this.chain = this.chain.then(async () => {
      job.status = "running";
      try {
        job.result = await this.handler(kind, input, (m) => {
          job.progress.push(m);
          if (job.progress.length > 500) job.progress.shift();
        });
        job.status = "completed";
      } catch (err) {
        job.status = "failed";
        job.error = (err as Error).message;
      }
      job.finishedAt = new Date().toISOString();
    });
    return job;
  }

  async get(id: string): Promise<JobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async list(): Promise<JobRecord[]> {
    return [...this.jobs.values()].reverse().slice(0, 100);
  }
}

export const RESEARCH_QUEUE = "research";

export class BullJobRunner implements JobRunner {
  private constructor(private readonly queue: import("bullmq").Queue) {}

  static async create(redisUrl: string): Promise<BullJobRunner> {
    const { Queue } = await import("bullmq");
    const { Redis } = await import("ioredis");
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    return new BullJobRunner(new Queue(RESEARCH_QUEUE, { connection }));
  }

  private map(job: import("bullmq").Job, state: string): JobRecord {
    return {
      id: String(job.id),
      kind: job.name as JobKind,
      status: state === "completed" ? "completed" : state === "failed" ? "failed" : state === "active" ? "running" : "queued",
      input: job.data as Record<string, unknown>,
      result: job.returnvalue,
      ...(job.failedReason ? { error: job.failedReason } : {}),
      progress: Array.isArray(job.progress) ? (job.progress as string[]) : [],
      createdAt: new Date(job.timestamp).toISOString(),
      ...(job.finishedOn ? { finishedAt: new Date(job.finishedOn).toISOString() } : {}),
    };
  }

  async submit(kind: JobKind, input: Record<string, unknown>): Promise<JobRecord> {
    const job = await this.queue.add(kind, input, { removeOnComplete: 500, removeOnFail: 500 });
    return this.map(job, "waiting");
  }

  async get(id: string): Promise<JobRecord | null> {
    const job = await this.queue.getJob(id);
    return job ? this.map(job, await job.getState()) : null;
  }

  async list(): Promise<JobRecord[]> {
    const jobs = await this.queue.getJobs(["active", "waiting", "completed", "failed"], 0, 100);
    return Promise.all(jobs.map(async (j) => this.map(j, await j.getState())));
  }
}
