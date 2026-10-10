import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Long operations (usage scans, big deletes/moves) can outlive Cloudflare's
 * 100s proxy timeout. runOrDefer waits a while for the result; if the work is
 * still running it hands back a job id the client polls via /api/jobs.
 */

export interface Job {
  status: "running" | "done" | "error";
  progress: number;
  result?: unknown;
  error?: string;
  errorStatus?: number;
  at: number;
}

const g = globalThis as unknown as { __bfJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (g.__bfJobs ??= new Map());

const WAIT_MS = Number(process.env.JOB_WAIT_MS) || 20_000;
const KEEP_MS = 60 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.status !== "running" && now - j.at > KEEP_MS) jobs.delete(id);
}

export async function runOrDefer<T>(
  fn: (progress: (n: number) => void) => Promise<T>,
  statusOf: (e: unknown) => number,
): Promise<{ done: true; result: T } | { done: false; jobId: string }> {
  sweep();
  const id = randomUUID();
  const job: Job = { status: "running", progress: 0, at: Date.now() };
  jobs.set(id, job);
  const p = fn((n) => (job.progress = n)).then(
    (result) => {
      Object.assign(job, { status: "done", result, at: Date.now() });
      return result;
    },
    (e) => {
      Object.assign(job, {
        status: "error",
        error: (e as Error)?.message ?? String(e),
        errorStatus: statusOf(e),
        at: Date.now(),
      });
      throw e;
    },
  );
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), WAIT_MS));
  const first = await Promise.race([p, timeout]);
  if (first === "timeout") {
    p.catch(() => {}); // outcome is recorded on the job
    return { done: false, jobId: id };
  }
  jobs.delete(id);
  return { done: true, result: first as T };
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
