import React from 'react';
import type { TaskDef } from '../../types.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';

interface Props {
  task: TaskDef;
}

export function StepsPanel({ task }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const defaultModel = settings?.models.default ?? 'claude-haiku-4-5-20251001';

  return (
    <div className="border-b border-[#313244]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#313244]">
        <span className="text-[10px] uppercase tracking-widest text-[#6c7086] font-semibold">
          Services &amp; Models
        </span>
        <span className="text-[10px] text-[#6c7086]">Override LLM model per service</span>
      </div>
      <div>
        {task.steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#1e1e2e]/50 border-b border-[#313244]/50 last:border-0"
          >
            <span className="text-base w-6 text-center shrink-0">{step.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#cdd6f4] font-medium">{step.label}</p>
              <p className="text-[11px] text-[#6c7086] truncate">{step.detail}</p>
            </div>
            <div className="shrink-0 text-[11px]">
              {step.usesLLM ? (
                <span className="px-2 py-0.5 rounded bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20">
                  {defaultModel.split('-').slice(0, 2).join('-')}
                </span>
              ) : (
                <span className="text-[#45475a]">— no LLM —</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
