import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.resolve(__dirname, '../../settings.json');

const DEFAULT_SETTINGS: Settings = {
  models: {
    default: 'claude-haiku-4-5-20251001',
    anthropicApiKey: '',
    openRouterApiKey: '',
    useOpenRouter: false,
    openRouterDefault: 'anthropic/claude-haiku',
  },
  taskOverrides: {},
};

export function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(partial: Partial<Settings>): Settings {
  const current = readSettings();
  const updated: Settings = {
    models: { ...current.models, ...(partial.models ?? {}) },
    taskOverrides: { ...current.taskOverrides, ...(partial.taskOverrides ?? {}) },
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}
