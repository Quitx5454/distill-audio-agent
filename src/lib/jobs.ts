// ── In-memory async job store ─────────────────────────────────────────────
// Distill Audio generation (topic research + TTS + optional ASMR) can exceed
// the platform's ~100s HTTP edge timeout. So /generate is ASYNC: the paid POST
// returns a task_id immediately (and payment settles on that response),
// generation runs in the background, and the caller polls a FREE status
// endpoint, then fetches the mp3 from a FREE result endpoint.
//
// Stateful + in-memory with a TTL. A server restart drops in-flight jobs, so
// clients MUST implement a polling timeout and not assume infinite retention.
// Mirrors the Pipeline agent's task_id + free status pattern.
import type { AsmrOption } from "./asmr.js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  // Echoed request context.
  sessionId: string;
  asmr: AsmrOption | null;
  // Populated on completion.
  mode?: string;
  voice?: string;
  asmrApplied?: boolean;
  bytes?: Uint8Array; // the rendered mp3
  error?: string;
}

// Generation + a generous poll window. Evicted lazily on access.
const TTL_MS = 15 * 60 * 1000;
const jobs = new Map<string, Job>();

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createJob(sessionId: string, asmr: AsmrOption | null): Job {
  sweep();
  const now = Date.now();
  const job: Job = {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    sessionId,
    asmr,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  sweep();
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  job.updatedAt = Date.now();
}
