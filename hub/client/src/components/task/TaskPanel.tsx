import React, { useState } from 'react';
import type { TaskDef } from '../../types.ts';
import { useTaskRunner } from '../../hooks/useTaskRunner.ts';
import { useJobStore } from '../../store/useJobStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { StepsPanel } from './StepsPanel.tsx';
import { LogOutput } from './LogOutput.tsx';
import { StatusBar } from './StatusBar.tsx';

const ANTHROPIC_MODELS = [
  { label: 'Haiku 4.5 — fast & cheap', value: 'claude-haiku-4-5-20251001' },
  { label: 'Sonnet 4.6 — balanced', value: 'claude-sonnet-4-6' },
  { label: 'Opus 4.6 — most capable', value: 'claude-opus-4-6' },
];

interface Props {
  task: TaskDef;
}

export function TaskPanel({ task }: Props) {
  const [showServices, setShowServices] = useState(() => task.steps.some((s) => s.usesLLM));
  const [stepModels, setStepModels] = useState<Record<string, string>>({});
  const [globalModel, setGlobalModel] = useState('');
  const settings = useSettingsStore((s) => s.settings);
  const { run, stop, clear, currentJob } = useTaskRunner(task.id);

  const isRunning = currentJob?.status === 'running';
  const logLines = currentJob?.logLines ?? [];
  const flags = currentJob?.flags ?? [];

  return (
    <div className="flex flex-col h-full bg-[#F6F5F2]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E1D8] bg-white shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium text-[#1C1A17]">
            <span className="font-mono text-[11px] text-[#A39D94] mr-2">{task.id}</span>
            {task.label}
          </h1>
          {task.type === 'server' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] font-medium tracking-wide">
              server
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowServices((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border transition-colors
              ${showServices
                ? 'bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]'
                : 'bg-[#F6F5F2] text-[#6B665E] border-[#E5E1D8] hover:border-[#CCC8BF]'
              }`}
          >
            <span className="text-[10px]">◎</span>
            <span>Services</span>
          </button>

          <select
            value={globalModel}
            onChange={(e) => setGlobalModel(e.target.value)}
            disabled={isRunning}
            title="Global model override (MODEL_OVERRIDE)"
            className="text-[12px] px-2 py-1.5 rounded-md bg-[#F6F5F2] text-[#0369A1] border border-[#E5E1D8]
              focus:outline-none focus:border-[#0369A1]/40 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">
              {settings?.models.default
                ? settings.models.default.split('/').pop()
                : 'default model'}
            </option>
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          <button
            onClick={clear}
            disabled={isRunning}
            className="px-3 py-1.5 rounded-md text-[12px] bg-[#F6F5F2] text-[#6B665E] border border-[#E5E1D8]
              hover:border-[#CCC8BF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Clear
          </button>

          {isRunning ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[12px] font-medium
                bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5] hover:bg-[#FEE2E2]/80 transition-colors"
            >
              <span className="text-[9px]">■</span>
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => run(globalModel || undefined, stepModels)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[12px] font-medium
                bg-[#1D4ED8] text-white border border-[#1D4ED8] hover:bg-[#1E40AF] transition-colors shadow-sm"
            >
              <span className="text-[9px]">▶</span>
              <span>Run</span>
            </button>
          )}
        </div>
      </div>

      {/* Services panel (collapsible) */}
      {showServices && <StepsPanel task={task} stepModels={stepModels} onModelChange={(stepId, model) => setStepModels(prev => ({ ...prev, [stepId]: model }))} />}

      {/* Description (shown when no log output) */}
      {logLines.length === 0 && (
        <div className="px-5 py-3 border-b border-[#E5E1D8]/60 shrink-0">
          <p className="text-[13px] text-[#6B665E] leading-relaxed">{task.description}</p>
        </div>
      )}

      {/* Log output */}
      <LogOutput lines={logLines} flags={flags} />

      {/* Status bar */}
      <StatusBar task={task} job={currentJob} />
    </div>
  );
}
