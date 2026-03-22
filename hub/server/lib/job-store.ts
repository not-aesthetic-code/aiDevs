import type { JobState, LogLine, SSEWriter } from '../types.js';

const jobs = new Map<string, JobState>();

const MAX_LOG_LINES = 5000;
const JOB_TTL_MS = 30 * 60 * 1000;

export function createJob(jobId: string, taskId: string): JobState {
  const job: JobState = {
    jobId,
    taskId,
    status: 'running',
    log: [],
    flags: [],
    exitCode: null,
    startedAt: Date.now(),
    writers: new Set(),
    child: null,
  };
  jobs.set(jobId, job);
  cleanupOldJobs();
  return job;
}

export function getJob(jobId: string): JobState | undefined {
  return jobs.get(jobId);
}

export function getRunningJobForTask(taskId: string): JobState | undefined {
  for (const job of jobs.values()) {
    if (job.taskId === taskId && job.status === 'running') return job;
  }
  return undefined;
}

export function appendLog(job: JobState, line: LogLine): void {
  job.log.push(line);
  if (job.log.length > MAX_LOG_LINES) job.log.shift();

  broadcast(job, 'log', { type: line.type, text: line.text, ts: line.ts });

  const flagMatch = line.text.match(/\{FLG:[^}]+\}/g);
  if (flagMatch) {
    for (const flag of flagMatch) {
      if (!job.flags.includes(flag)) {
        job.flags.push(flag);
        broadcast(job, 'flag', { flag });
      }
    }
  }
}

export function finishJob(job: JobState, exitCode: number): void {
  job.status = exitCode === 0 ? 'done' : 'error';
  job.exitCode = exitCode;
  broadcast(job, 'done', { exitCode, elapsed: Date.now() - job.startedAt });
  job.writers.clear();
}

export function addWriter(job: JobState, writer: SSEWriter): () => void {
  job.writers.add(writer);
  return () => job.writers.delete(writer);
}

function broadcast(job: JobState, event: string, payload: object): void {
  const data = JSON.stringify(payload);
  for (const write of job.writers) {
    try {
      write(event, data);
    } catch {
      job.writers.delete(write);
    }
  }
}

function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.status !== 'running' && now - job.startedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}
