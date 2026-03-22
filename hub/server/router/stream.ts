import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getJob, addWriter } from '../lib/job-store.js';

const app = new Hono();

// GET /api/stream/:jobId
app.get('/:jobId', (c) => {
  const job = getJob(c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);

  return streamSSE(c, async (stream) => {
    // Replay existing log
    for (const line of job.log) {
      await stream.writeSSE({
        event: 'log',
        data: JSON.stringify({ type: line.type, text: line.text, ts: line.ts }),
      });
    }
    for (const flag of job.flags) {
      await stream.writeSSE({ event: 'flag', data: JSON.stringify({ flag }) });
    }

    // If already finished, send done and close
    if (job.status !== 'running') {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ exitCode: job.exitCode, elapsed: Date.now() - job.startedAt }),
      });
      return;
    }

    // Subscribe to live events
    await new Promise<void>((resolve) => {
      const unsubscribe = addWriter(job, (event, data) => {
        stream.writeSSE({ event, data }).catch(() => {
          unsubscribe();
          resolve();
        });
        if (event === 'done') {
          unsubscribe();
          resolve();
        }
      });

      // Keepalive ping every 15s
      const keepalive = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {
          clearInterval(keepalive);
          unsubscribe();
          resolve();
        });
      }, 15_000);

      stream.onAbort(() => {
        clearInterval(keepalive);
        unsubscribe();
        resolve();
      });
    });
  });
});

export default app;
