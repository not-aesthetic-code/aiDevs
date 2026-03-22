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

export type SSEWriter = (event: string, data: string) => void;

export interface JobState {
  jobId: string;
  taskId: string;
  status: 'running' | 'done' | 'error';
  log: LogLine[];
  flags: string[];
  exitCode: number | null;
  startedAt: number;
  writers: Set<SSEWriter>;
  child: import('child_process').ChildProcess | null;
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
