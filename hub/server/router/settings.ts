import { Hono } from 'hono';
import { readSettings, writeSettings } from '../lib/settings-store.js';

const app = new Hono();

const maskKeys = (s: ReturnType<typeof readSettings>) => ({
  ...s,
  models: {
    ...s.models,
    anthropicApiKey: s.models.anthropicApiKey ? '***' : '',
    openRouterApiKey: s.models.openRouterApiKey ? '***' : '',
  },
});

app.get('/', (c) => c.json(maskKeys(readSettings())));

app.put('/', async (c) => {
  try {
    const body = await c.req.json();
    const updated = writeSettings(body);
    return c.json(maskKeys(updated));
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
