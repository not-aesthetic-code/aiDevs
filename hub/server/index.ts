import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import tasksRouter from './router/tasks.js';
import runRouter from './router/run.js';
import streamRouter from './router/stream.js';
import settingsRouter from './router/settings.js';

const PORT = process.env.HUB_PORT ? parseInt(process.env.HUB_PORT) : 3001;
const IS_DEV = process.env.NODE_ENV !== 'production';

const app = new Hono();

app.use('*', cors());

app.route('/api/tasks', tasksRouter);
app.route('/api/run', runRouter);
app.route('/api/stream', streamRouter);
app.route('/api/settings', settingsRouter);

if (!IS_DEV) {
  app.use('*', serveStatic({ root: './client/dist' }));
  app.get('*', serveStatic({ path: './client/dist/index.html' }));
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hub server running on http://localhost:${PORT}`);
  if (IS_DEV) console.log(`Frontend dev server: http://localhost:3000`);
});
