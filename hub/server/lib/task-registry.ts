import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskDef, StepDef } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.resolve(__dirname, '../../tasks');
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

interface TaskMeta {
  label?: string;
  description?: string;
  type?: 'run-once' | 'server';
  steps?: StepDef[];
}

function toLabel(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Parses "01-people", "04b-railway", "05-categorize" etc.
function parseEntry(name: string): { episode: number; episodeSuffix: string; slug: string } | null {
  const match = name.match(/^(\d+)([a-z]?)-(.+)$/);
  if (!match) return null;
  return { episode: parseInt(match[1], 10), episodeSuffix: match[2], slug: match[3] };
}

function readMeta(metaPath: string): TaskMeta {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as TaskMeta;
  } catch {
    return {};
  }
}

export function discoverTasks(): TaskDef[] {
  const tasks: TaskDef[] = [];

  if (!fs.existsSync(TASKS_DIR)) return tasks;

  const weekDirs = fs
    .readdirSync(TASKS_DIR)
    .filter((d) => /^week-\d+$/.test(d))
    .sort();

  for (const weekDir of weekDirs) {
    const week = parseInt(weekDir.replace('week-', ''), 10);
    const weekPath = path.join(TASKS_DIR, weekDir);

    const entries = fs.readdirSync(weekPath).sort();

    for (const entry of entries) {
      const entryPath = path.join(weekPath, entry);
      const stat = fs.statSync(entryPath);
      const baseName = entry.replace(/\.ts$/, '');
      const parsed = parseEntry(baseName);
      if (!parsed) continue;

      const { episode, episodeSuffix, slug } = parsed;
      const epCode = `${String(episode).padStart(2, '0')}${episodeSuffix}`;
      const id = `S${String(week).padStart(2, '0')}E${epCode}`;

      let script: string;
      let meta: TaskMeta;

      if (stat.isDirectory()) {
        const indexPath = path.join(entryPath, 'index.ts');
        if (!fs.existsSync(indexPath)) continue;
        script = path.relative(PROJECT_ROOT, indexPath);
        meta = readMeta(path.join(entryPath, 'task.json'));
      } else if (entry.endsWith('.ts')) {
        script = path.relative(PROJECT_ROOT, entryPath);
        meta = readMeta(entryPath.replace(/\.ts$/, '.task.json'));
      } else {
        continue;
      }

      tasks.push({
        id,
        week,
        episode,
        label: meta.label ?? toLabel(slug),
        description: meta.description ?? '',
        script,
        type: meta.type ?? 'run-once',
        steps: meta.steps ?? [],
      });
    }
  }

  return tasks.sort((a, b) => a.week - b.week || a.episode - b.episode || a.id.localeCompare(b.id));
}

// Discovered once at startup
export const TASKS: TaskDef[] = discoverTasks();
