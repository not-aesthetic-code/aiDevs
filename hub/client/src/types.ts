export interface StepDef {
  id: string;
  label: string;
  detail: string;
  usesLLM: boolean;
  icon: string;
}

export interface TaskDef {
  id: string;
  week: number;
  episode: number;
  label: string;
  description: string;
  script: string;
  type: 'run-once' | 'server';
  steps: StepDef[];
}

export interface LogLine {
  type: 'stdout' | 'stderr' | 'system';
  text: string;
  ts: number;
}

export interface JobState {
  jobId: string;
  taskId: string;
  status: 'idle' | 'running' | 'done' | 'error';
  logLines: LogLine[];
  flags: string[];
  exitCode: number | null;
  startedAt: number | null;
}

export interface Settings {
  models: {
    default: string;
    anthropicApiKey: string;
    openRouterApiKey: string;
    useOpenRouter: boolean;
    openRouterDefault: string;
  };
  taskOverrides: Record<string, { llm?: string }>;
}
