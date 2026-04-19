import React from 'react';
import type { TaskDef } from '../../types.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';

// Models available for step overrides
const STEP_MODELS = [
  // ── Anthropic native (direct API, no OpenRouter) ──────────────────────────
  { label: '── Anthropic (direct) ──', value: '', disabled: true },
  { label: 'Haiku 4.5 — fast & cheap', value: 'claude-haiku-4-5-20251001' },
  { label: 'Sonnet 4.6 — balanced', value: 'claude-sonnet-4-6' },
  { label: 'Opus 4.6 — most capable', value: 'claude-opus-4-6' },
  // ── OpenRouter ─────────────────────────────────────────────────────────────
  { label: '── OpenRouter ──', value: '', disabled: true },
  { label: 'GPT-4o ★ vision', value: 'openai/gpt-4o' },
  { label: 'GPT-4o mini (vision)', value: 'openai/gpt-4o-mini' },
  { label: 'Gemini 2.0 Flash (vision)', value: 'google/gemini-2.0-flash-001' },
  { label: 'Gemini 3 Flash (vision)', value: 'google/gemini-3-flash-preview' },
  { label: 'Gemini Flash 1.5 (vision)', value: 'google/gemini-flash-1.5' },
  { label: 'Claude Haiku 4.5 via OR', value: 'anthropic/claude-haiku-4-5' },
  { label: 'Claude Sonnet 4.5 via OR', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Claude Sonnet 4.6 via OR', value: 'anthropic/claude-sonnet-4-6' },
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
    <div className="border-b border-[#E5E1D8] bg-white">
      <div className="flex items-center justify-between px-5 py-2 border-b border-[#E5E1D8]">
        <span className="text-[10px] uppercase tracking-[0.15em] text-[#A39D94] font-semibold">
          Services &amp; Models
        </span>
        <span className="text-[11px] text-[#A39D94]">Override LLM model per step</span>
      </div>
      <div>
        {task.steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#F6F5F2] border-b border-[#E5E1D8]/60 last:border-0 transition-colors"
          >
            <span className="text-base w-6 text-center shrink-0">{step.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-[#1C1A17] font-medium">{step.label}</p>
              <p className="text-[11px] text-[#A39D94] truncate">{step.detail}</p>
            </div>
            <div className="shrink-0">
              {step.usesLLM ? (
                <select
                  value={stepModels[step.id] ?? ''}
                  onChange={(e) => onModelChange(step.id, e.target.value)}
                  className="text-[11px] px-2 py-1 rounded-md bg-[#F6F5F2] text-[#1D4ED8] border border-[#E5E1D8]
                    focus:outline-none focus:border-[#1D4ED8]/40 cursor-pointer"
                >
                  <option value="">Default ({defaultModel.split('/').pop()})</option>
                  {STEP_MODELS.map((m, i) => (
                    <option key={`${m.value}-${i}`} value={m.value} disabled={m.disabled}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-[#CCC8BF]">— no LLM —</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
