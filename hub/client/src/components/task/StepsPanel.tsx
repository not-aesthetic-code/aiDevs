import React from 'react';
import type { TaskDef } from '../../types.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';

// Models available for step overrides (OpenRouter)
const OR_MODELS = [
  // Vision-capable
  { label: 'GPT-4o ★ vision (recommended for grids)', value: 'openai/gpt-4o' },
  { label: 'GPT-4o mini (vision)', value: 'openai/gpt-4o-mini' },
  { label: 'Gemini 2.0 Flash (vision)', value: 'google/gemini-2.0-flash-001' },
  { label: 'Gemini 3 Flash (vision)', value: 'google/gemini-3-flash-preview' },
  { label: 'Gemini Flash 1.5 (vision)', value: 'google/gemini-flash-1.5' },
  { label: 'Claude Haiku 4.5 (vision)', value: 'anthropic/claude-haiku-4-5' },
  { label: 'Claude Sonnet 4.5 (vision)', value: 'anthropic/claude-sonnet-4-5' },
  // Text-only / agent
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5-20251001' },
  { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5-20251022' },
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4-6' },
];

interface Props {
  task: TaskDef;
  stepModels: Record<string, string>;
  onModelChange: (stepId: string, model: string) => void;
}

export function StepsPanel({ task, stepModels, onModelChange }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const defaultModel = settings?.models.openRouterDefault ?? settings?.models.default ?? 'claude-haiku-4-5-20251001';

  return (
    <div className="border-b border-[#313244]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#313244]">
        <span className="text-[10px] uppercase tracking-widest text-[#6c7086] font-semibold">
          Services &amp; Models
        </span>
        <span className="text-[10px] text-[#6c7086]">Override LLM model per step (OpenRouter)</span>
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
            <div className="shrink-0">
              {step.usesLLM ? (
                <select
                  value={stepModels[step.id] ?? ''}
                  onChange={(e) => onModelChange(step.id, e.target.value)}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#313244] text-[#89b4fa] border border-[#89b4fa]/20
                    focus:outline-none focus:border-[#89b4fa]/60 cursor-pointer"
                >
                  <option value="">Default ({defaultModel.split('/').pop()})</option>
                  {OR_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-[#45475a]">— no LLM —</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
