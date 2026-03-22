import React from 'react';
import type { TaskDef } from '../../types.ts';
import { useJobStore } from '../../store/useJobStore.ts';

interface Props {
  task: TaskDef;
  isSelected: boolean;
  onClick: () => void;
}

export function TaskItem({ task, isSelected, onClick }: Props) {
  const job = useJobStore((s) => s.jobs[task.id]);
  const status = job?.status ?? 'idle';
  const hasFlag = (job?.flags ?? []).length > 0;

  const statusDot = () => {
    if (status === 'running') return <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />;
    if (status === 'done') return <span className="text-[#a6e3a1] text-xs leading-none">✓</span>;
    if (status === 'error') return <span className="text-[#f38ba8] text-xs leading-none">✗</span>;
    return <span className="w-2 h-2 rounded-full border border-[#45475a]" />;
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs rounded-sm transition-colors
        ${isSelected
          ? 'bg-[#313244] text-[#cdd6f4] border-l-2 border-[#89b4fa]'
          : 'text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#1e1e2e]'
        }`}
    >
      <span className="flex items-center justify-center w-4 shrink-0">{statusDot()}</span>
      <span className="truncate">
        <span className="text-[#6c7086] mr-1">{task.id}</span>
        {task.label}
      </span>
      {hasFlag && (
        <span className="ml-auto shrink-0 text-[10px] px-1 py-0.5 rounded bg-[#f9e2af]/10 text-[#f9e2af] border border-[#f9e2af]/20">
          FLG
        </span>
      )}
    </button>
  );
}
