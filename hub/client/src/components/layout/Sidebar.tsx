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
    <aside className="w-64 shrink-0 flex flex-col bg-[#181825] border-r border-[#313244] h-full">
      {/* Header */}
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6c7086]">Tasks</p>
      </div>

      {/* Task list */}
      <nav className="flex-1 overflow-y-auto py-1 space-y-1">
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
      <div className="border-t border-[#313244] py-2 space-y-0.5">
        <SidebarNavItem
          icon="🏆"
          label={`Flags ${allFlags.length > 0 ? `(${allFlags.length})` : ''}`}
          onClick={() => {}}
        />
        <SidebarNavItem
          icon="⚙️"
          label="Settings"
          onClick={onOpenSettings}
        />
        <SidebarNavItem
          icon="ℹ️"
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
      className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
