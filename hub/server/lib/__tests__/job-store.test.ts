import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createJob, getJob, getRunningJobForTask, appendLog, finishJob, addWriter } from '../job-store.js';

describe('job-store', () => {
  it('createJob returns a running job with correct fields', () => {
    const job = createJob('j1', 'people');
    expect(job.jobId).toBe('j1');
    expect(job.taskId).toBe('people');
    expect(job.status).toBe('running');
    expect(job.log).toHaveLength(0);
    expect(job.flags).toHaveLength(0);
  });

  it('getJob retrieves a created job', () => {
    const job = createJob('j2', 'people');
    expect(getJob('j2')).toBe(job);
  });

  it('getJob returns undefined for unknown id', () => {
    expect(getJob('nonexistent')).toBeUndefined();
  });

  it('getRunningJobForTask finds a running job', () => {
    const job = createJob('j3', 'findhim');
    expect(getRunningJobForTask('findhim')).toBe(job);
  });

  it('getRunningJobForTask returns undefined after job finishes', () => {
    const job = createJob('j4', 'mcp');
    finishJob(job, 0);
    expect(getRunningJobForTask('mcp')).toBeUndefined();
  });

  it('appendLog adds lines and extracts flags', () => {
    const job = createJob('j5', 'categorize');
    appendLog(job, { type: 'stdout', text: 'Got flag {FLG:ABC123}', ts: Date.now() });
    expect(job.log).toHaveLength(1);
    expect(job.flags).toContain('{FLG:ABC123}');
  });

  it('appendLog deduplicates flags', () => {
    const job = createJob('j6', 'categorize');
    appendLog(job, { type: 'stdout', text: '{FLG:DUP}', ts: Date.now() });
    appendLog(job, { type: 'stdout', text: '{FLG:DUP}', ts: Date.now() });
    expect(job.flags).toHaveLength(1);
  });

  it('finishJob sets status=done on exit code 0', () => {
    const job = createJob('j7', 'sendit');
    finishJob(job, 0);
    expect(job.status).toBe('done');
    expect(job.exitCode).toBe(0);
  });

  it('finishJob sets status=error on non-zero exit code', () => {
    const job = createJob('j8', 'sendit');
    finishJob(job, 1);
    expect(job.status).toBe('error');
    expect(job.exitCode).toBe(1);
  });

  it('addWriter broadcasts log events to SSE writers', () => {
    const job = createJob('j9', 'people');
    const events: { event: string; data: string }[] = [];
    addWriter(job, (event, data) => events.push({ event, data }));

    appendLog(job, { type: 'stdout', text: 'hello', ts: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('log');
    const payload = JSON.parse(events[0].data);
    expect(payload.text).toBe('hello');
  });

  it('addWriter cleanup removes writer', () => {
    const job = createJob('j10', 'people');
    const events: unknown[] = [];
    const cleanup = addWriter(job, () => events.push(null));
    cleanup();
    appendLog(job, { type: 'stdout', text: 'after cleanup', ts: 0 });
    expect(events).toHaveLength(0);
  });
});
