import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { TASKS } from '../lib/task-registry.js';
import { createJob, getRunningJobForTask, getJob } from '../lib/job-store.js';
import { runTask, stopJob } from '../lib/runner.js';

const app = new Hono();

// POST /api/run/:taskId
app.post('/:taskId', async (c) => {
  const taskId = c.req.param('taskId');
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const existing = getRunningJobForTask(taskId);
  if (existing) return c.json({ error: 'Task already running', jobId: existing.jobId }, 409);

  const body = await c.req.json().catch(() => ({}));
  const jobId = randomUUID();
  const job = createJob(jobId, taskId);

  runTask(job, task.script, body?.modelOverride, body?.stepModels);

  return c.json({ jobId });
});

// POST /api/run/stop/:jobId
app.post('/stop/:jobId', (c) => {
  const job = getJob(c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (job.status !== 'running') return c.json({ error: 'Job not running' }, 400);

  stopJob(job);
  return c.json({ ok: true });
});

export default app;
