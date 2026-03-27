import { useEffect, useRef } from 'react';
import { useJobStore } from '../store/useJobStore.ts';

export function useSSE(taskId: string | null, jobId: string | null) {
  const { appendLog, addFlag, setTokenCount, finishJob } = useJobStore();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId || !jobId) return;

    // Close any existing connection
    esRef.current?.close();

    const es = new EventSource(`/api/stream/${jobId}`);
    esRef.current = es;

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        appendLog(taskId, data);
      } catch { /* ignore */ }
    });

    es.addEventListener('flag', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        addFlag(taskId, data.flag);
      } catch { /* ignore */ }
    });

    es.addEventListener('token_count', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setTokenCount(taskId, data.count);
      } catch { /* ignore */ }
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        finishJob(taskId, data.exitCode ?? 1);
      } catch {
        finishJob(taskId, 1);
      }
      es.close();
    });

    es.onerror = () => {
      es.close();
      // Mark job as errored if SSE drops without a done event
      if (taskId) finishJob(taskId, 1);
    };

    return () => {
      es.close();
    };
  }, [jobId, taskId]);
}
