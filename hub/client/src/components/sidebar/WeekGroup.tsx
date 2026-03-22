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
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium uppercase tracking-widest
          ${hasSelected ? 'text-[#89b4fa]' : 'text-[#6c7086]'} hover:text-[#a6adc8] transition-colors`}
      >
        <span className="text-[10px]">{open ? '▼' : '▶'}</span>
        WEEK-{week}
      </button>
      {open && (
        <div className="pl-1">
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
