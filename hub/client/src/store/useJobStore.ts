import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JobState, LogLine } from '../types.ts';

interface JobStore {
  jobs: Record<string, JobState>;
  startJob: (taskId: string, jobId: string) => void;
  appendLog: (taskId: string, line: LogLine) => void;
  addFlag: (taskId: string, flag: string) => void;
  setTokenCount: (taskId: string, count: number) => void;
  finishJob: (taskId: string, exitCode: number) => void;
  clearJob: (taskId: string) => void;
}

const defaultJob = (taskId: string): JobState => ({
  jobId: '',
  taskId,
  status: 'idle',
  logLines: [],
  flags: [],
  exitCode: null,
  startedAt: null,
  tokenCount: null,
});

export const useJobStore = create<JobStore>()(
  persist(
    (set) => ({
      jobs: {},

      startJob: (taskId, jobId) =>
        set((s) => ({
          jobs: {
            ...s.jobs,
            [taskId]: {
              jobId,
              taskId,
              status: 'running',
              logLines: [],
              flags: [],
              exitCode: null,
              startedAt: Date.now(),
              tokenCount: null,
            },
          },
        })),

      appendLog: (taskId, line) =>
        set((s) => {
          const job = s.jobs[taskId] ?? defaultJob(taskId);
          const logLines = [...job.logLines, line].slice(-3000);
          return { jobs: { ...s.jobs, [taskId]: { ...job, logLines } } };
        }),

      addFlag: (taskId, flag) =>
        set((s) => {
          const job = s.jobs[taskId] ?? defaultJob(taskId);
          if (job.flags.includes(flag)) return s;
          return { jobs: { ...s.jobs, [taskId]: { ...job, flags: [...job.flags, flag] } } };
        }),

      setTokenCount: (taskId, count) =>
        set((s) => {
          const job = s.jobs[taskId] ?? defaultJob(taskId);
          return { jobs: { ...s.jobs, [taskId]: { ...job, tokenCount: count } } };
        }),

      finishJob: (taskId, exitCode) =>
        set((s) => {
          const job = s.jobs[taskId];
          if (!job) return s;
          return {
            jobs: {
              ...s.jobs,
              [taskId]: { ...job, status: exitCode === 0 ? 'done' : 'error', exitCode },
            },
          };
        }),

      clearJob: (taskId) =>
        set((s) => ({
          jobs: { ...s.jobs, [taskId]: defaultJob(taskId) },
        })),
    }),
    {
      name: 'aidevs-hub-jobs',
      // Persist only flags, status and exitCode — drop log lines (stale after reload)
      partialize: (state) => ({
        jobs: Object.fromEntries(
          Object.entries(state.jobs).map(([taskId, job]) => [
            taskId,
            {
              ...defaultJob(taskId),
              flags: job.flags,
              exitCode: job.exitCode,
              // 'running' can't survive a page reload — reset to done/error/idle
              status: job.status === 'running' ? 'idle' : job.status,
            },
          ])
        ),
      }),
    }
  )
);
