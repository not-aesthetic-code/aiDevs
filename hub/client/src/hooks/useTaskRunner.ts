import { useState } from 'react';
import { useJobStore } from '../store/useJobStore.ts';
import { useSSE } from './useSSE.ts';

export function useTaskRunner(taskId: string | null) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Reactive selectors — re-renders when job state changes
  const startJob = useJobStore((s) => s.startJob);
  const clearJob = useJobStore((s) => s.clearJob);
  const currentJob = useJobStore((s) => (taskId ? s.jobs[taskId] : undefined));

  useSSE(taskId, activeJobId);

  const run = async (modelOverride?: string) => {
    if (!taskId) return;

    const res = await fetch(`/api/run/${taskId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelOverride }),
    });

    if (res.status === 409) {
      const data = await res.json();
      setActiveJobId(data.jobId);
      return;
    }

    if (!res.ok) {
      console.error('Failed to start task:', await res.json());
      return;
    }

    const { jobId } = await res.json();
    startJob(taskId, jobId);
    setActiveJobId(jobId);
  };

  const stop = async () => {
    if (!activeJobId) return;
    await fetch(`/api/run/stop/${activeJobId}`, { method: 'POST' });
  };

  const clear = () => {
    if (!taskId || currentJob?.status === 'running') return;
    setActiveJobId(null);
    clearJob(taskId);
  };

  return { run, stop, clear, currentJob, activeJobId };
}
