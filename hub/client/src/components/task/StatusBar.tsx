import React, { useEffect, useState } from 'react';
import type { JobState, TaskDef } from '../../types.ts';

interface Props {
  task: TaskDef;
  job: JobState | undefined;
}

export function StatusBar({ task, job }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (job?.status !== 'running' || !job.startedAt) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - job.startedAt!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [job?.status, job?.startedAt]);

  const statusInfo = (() => {
    const s = job?.status ?? 'idle';
    if (s === 'idle') return { dot: 'bg-[#45475a]', label: 'Idle' };
    if (s === 'running') return { dot: 'bg-yellow-400 animate-pulse', label: `Running · ${elapsed}s` };
    if (s === 'done') return { dot: 'bg-[#a6e3a1]', label: 'Completed' };
    if (s === 'error') return { dot: 'bg-[#f38ba8]', label: 'Failed' };
    return { dot: 'bg-[#45475a]', label: s };
  })();

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-[#313244] bg-[#181825] text-[11px] text-[#6c7086]">
      <span className={`w-2 h-2 rounded-full shrink-0 ${statusInfo.dot}`} />
      <span>{statusInfo.label}</span>
      <span className="text-[#45475a]">·</span>
      <span className="text-[#45475a]">{task.label.toLowerCase()}</span>
      {job?.exitCode !== null && job?.exitCode !== undefined && (
        <>
          <span className="text-[#45475a]">·</span>
          <span className={job.exitCode === 0 ? 'text-[#a6e3a1]' : 'text-[#f38ba8]'}>
            exit {job.exitCode}
          </span>
        </>
      )}
    </div>
  );
}
