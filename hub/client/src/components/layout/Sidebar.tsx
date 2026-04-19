import React from 'react';
import { useTaskStore } from '../../store/useTaskStore.ts';
import { useJobStore } from '../../store/useJobStore.ts';
import { WeekGroup } from '../sidebar/WeekGroup.tsx';

interface Props {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: Props) {
  const { tasks, selectedTaskId, setSelected } = useTaskStore();
  const jobs = useJobStore((s) => s.jobs);

  const weeks = [...new Set(tasks.map((t) => t.week))].sort();
  const allFlags = Object.values(jobs).flatMap((j) => j.flags);

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-white border-r border-[#E5E1D8] h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#A39D94]">Tasks</p>
      </div>

      {/* Task list */}
      <nav className="flex-1 overflow-y-auto pb-2">
        {weeks.map((week) => (
          <WeekGroup
            key={week}
            week={week}
            tasks={tasks.filter((t) => t.week === week)}
            selectedTaskId={selectedTaskId}
            onSelect={setSelected}
          />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="border-t border-[#E5E1D8] py-1.5">
        <SidebarNavItem
          icon="◆"
          label={`Flags${allFlags.length > 0 ? ` (${allFlags.length})` : ''}`}
          onClick={() => {}}
        />
        <SidebarNavItem
          icon="◎"
          label="Settings"
          onClick={onOpenSettings}
        />
        <SidebarNavItem
          icon="○"
          label="About"
          onClick={() => {}}
        />
      </div>
    </aside>
  );
}

function SidebarNavItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-2.5 px-4 py-2 text-[13px] text-[#A39D94] hover:text-[#1C1A17] hover:bg-[#F6F5F2] transition-colors"
    >
      <span className="text-[10px]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
