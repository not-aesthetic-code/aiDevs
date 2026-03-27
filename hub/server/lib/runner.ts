import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog, finishJob } from './job-store.js';
import { readSettings } from './settings-store.js';
import type { JobState } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

export function runTask(job: JobState, scriptPath: string, modelOverride?: string, stepModels?: Record<string, string>): void {
  const settings = readSettings();

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
    ),
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };

  if (settings.models.anthropicApiKey) {
    env['ANTHROPIC_API_KEY'] = settings.models.anthropicApiKey;
  }

  if (settings.models.useOpenRouter) {
    env['USE_OPENROUTER'] = '1';
    env['OPENROUTER_MODEL'] = settings.models.openRouterDefault ?? 'anthropic/claude-haiku';
    // Prefer key from settings.json, fall back to process env
    const orKey = settings.models.openRouterApiKey || process.env.OPENROUTER_API_KEY;
    if (orKey) env['OPENROUTER_API_KEY'] = orKey;
  } else {
    env['USE_OPENROUTER'] = '0';
  }

  if (modelOverride) {
    env['MODEL_OVERRIDE'] = modelOverride;
  } else if (settings.models.default) {
    env['MODEL_OVERRIDE'] = settings.models.default;
  }

  if (stepModels) {
    for (const [stepId, model] of Object.entries(stepModels)) {
      if (model) env[`STEP_${stepId.toUpperCase()}_MODEL`] = model;
    }
  }

  const child = spawn('npx', ['tsx', scriptPath], {
    cwd: PROJECT_ROOT,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  job.child = child;

  // Line-buffer stdout
  let stdoutBuf = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      appendLog(job, { type: 'stdout', text: line, ts: Date.now() });
    }
  });

  // Line-buffer stderr
  let stderrBuf = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8');
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop() ?? '';
    for (const line of lines) {
      appendLog(job, { type: 'stderr', text: line, ts: Date.now() });
    }
  });

  child.on('close', (code) => {
    // Flush remaining buffers
    if (stdoutBuf.length > 0) appendLog(job, { type: 'stdout', text: stdoutBuf, ts: Date.now() });
    if (stderrBuf.length > 0) appendLog(job, { type: 'stderr', text: stderrBuf, ts: Date.now() });
    finishJob(job, code ?? 1);
  });

  child.on('error', (err) => {
    appendLog(job, { type: 'stderr', text: `Process error: ${err.message}`, ts: Date.now() });
    finishJob(job, 1);
  });
}

export function stopJob(job: JobState): void {
  if (job.child?.pid) {
    try {
      process.kill(-job.child.pid, 'SIGTERM');
    } catch {
      job.child.kill('SIGTERM');
    }
    setTimeout(() => {
      if (job.status === 'running') {
        try {
          process.kill(-job.child!.pid!, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }, 5000);
  }
}
