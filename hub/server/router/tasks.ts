import { Hono } from 'hono';
import { TASKS } from '../lib/task-registry.js';

const app = new Hono();

app.get('/', (c) => c.json({ tasks: TASKS }));

export default app;
