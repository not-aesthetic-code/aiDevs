import React, { useState } from 'react';
import type { TaskDef } from '../../types.ts';
import { TaskItem } from './TaskItem.tsx';

interface Props {
  week: number;
  tasks: TaskDef[];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
}

export function WeekGroup({ week, tasks, selectedTaskId, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  const hasSelected = tasks.some((t) => t.id === selectedTaskId);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full text-left flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em]
          ${hasSelected ? 'text-[#1D4ED8]' : 'text-[#A39D94]'} hover:text-[#1C1A17] transition-colors`}
      >
        <span className="opacity-60">{open ? '▾' : '▸'}</span>
        Week {week}
      </button>
      {open && (
        <div>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onClick={() => onSelect(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
