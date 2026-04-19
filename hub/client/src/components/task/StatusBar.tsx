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
    if (s === 'idle') return { dot: 'bg-[#CCC8BF]', label: 'Idle' };
    if (s === 'running') return { dot: 'bg-[#0369A1] animate-pulse', label: `Running · ${elapsed}s` };
    if (s === 'done') return { dot: 'bg-[#15803D]', label: 'Completed' };
    if (s === 'error') return { dot: 'bg-[#DC2626]', label: 'Failed' };
    return { dot: 'bg-[#CCC8BF]', label: s };
  })();

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-t border-[#E5E1D8] bg-white text-[11px] text-[#A39D94]">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dot}`} />
      <span className="text-[#6B665E]">{statusInfo.label}</span>
      <span className="text-[#E5E1D8]">·</span>
      <span className="font-mono">{task.label.toLowerCase()}</span>
      {job?.exitCode !== null && job?.exitCode !== undefined && (
        <>
          <span className="text-[#E5E1D8]">·</span>
          <span className={`font-mono ${job.exitCode === 0 ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
            exit {job.exitCode}
          </span>
        </>
      )}
      {job?.tokenCount !== null && job?.tokenCount !== undefined && (
        <>
          <span className="text-[#E5E1D8]">·</span>
          <span className={`font-mono ${job.tokenCount <= 1500 ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
            {job.tokenCount} / 1500 tokens
          </span>
        </>
      )}
    </div>
  );
}
