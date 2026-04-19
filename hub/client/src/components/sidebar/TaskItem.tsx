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
    if (status === 'running') return <span className="w-1.5 h-1.5 rounded-full bg-[#0369A1] animate-pulse" />;
    if (status === 'done') return <span className="text-[#15803D] text-[11px] leading-none">✓</span>;
    if (status === 'error') return <span className="text-[#DC2626] text-[11px] leading-none">✗</span>;
    return <span className="w-1.5 h-1.5 rounded-full border border-[#CCC8BF]" />;
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-4 py-1.5 text-[13px] transition-colors
        ${isSelected
          ? 'bg-[#EBF2FF] text-[#1C1A17] border-l-2 border-[#1D4ED8]'
          : 'text-[#6B665E] hover:text-[#1C1A17] hover:bg-[#F6F5F2] border-l-2 border-transparent'
        }`}
    >
      <span className="flex items-center justify-center w-3.5 shrink-0">{statusDot()}</span>
      <span className="truncate">
        <span className={`mr-1.5 text-[11px] font-mono ${isSelected ? 'text-[#6B665E]' : 'text-[#A39D94]'}`}>{task.id}</span>
        {task.label}
      </span>
      {hasFlag && (
        <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A] font-medium">
          FLG
        </span>
      )}
    </button>
  );
}
