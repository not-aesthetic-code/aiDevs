import React, { useState } from 'react';
import type { TaskDef } from '../../types.ts';
import { useTaskRunner } from '../../hooks/useTaskRunner.ts';
import { useJobStore } from '../../store/useJobStore.ts';
import { StepsPanel } from './StepsPanel.tsx';
import { LogOutput } from './LogOutput.tsx';
import { StatusBar } from './StatusBar.tsx';

interface Props {
  task: TaskDef;
}

export function TaskPanel({ task }: Props) {
  const [showServices, setShowServices] = useState(() => task.steps.some((s) => s.usesLLM));
  const [stepModels, setStepModels] = useState<Record<string, string>>({});
  const { run, stop, clear, currentJob } = useTaskRunner(task.id);

  const isRunning = currentJob?.status === 'running';
  const logLines = currentJob?.logLines ?? [];
  const flags = currentJob?.flags ?? [];

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#313244] bg-[#181825] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-[#cdd6f4]">
            <span className="text-[#6c7086] mr-2">{task.id}</span>
            {task.label}
          </h1>
          {task.type === 'server' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#cba6f7]/10 text-[#cba6f7] border border-[#cba6f7]/20">
              server
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowServices((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors
              ${showServices
                ? 'bg-[#cba6f7]/15 text-[#cba6f7] border-[#cba6f7]/40'
                : 'bg-[#313244] text-[#a6adc8] border-[#45475a] hover:border-[#6c7086]'
              }`}
          >
            <span>⚙</span>
            <span>Services</span>
          </button>

          <button
            onClick={clear}
            disabled={isRunning}
            className="px-3 py-1.5 rounded text-xs bg-[#313244] text-[#a6adc8] border border-[#45475a]
              hover:border-[#6c7086] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Clear
          </button>

          {isRunning ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium
                bg-[#f38ba8]/15 text-[#f38ba8] border border-[#f38ba8]/40 hover:bg-[#f38ba8]/25 transition-colors"
            >
              <span>⏹</span>
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => run(undefined, stepModels)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold
                bg-[#a6e3a1]/15 text-[#a6e3a1] border border-[#a6e3a1]/40 hover:bg-[#a6e3a1]/25 transition-colors"
            >
              <span>▶</span>
              <span>Run</span>
            </button>
          )}
        </div>
      </div>

      {/* Services panel (collapsible) */}
      {showServices && <StepsPanel task={task} stepModels={stepModels} onModelChange={(stepId, model) => setStepModels(prev => ({ ...prev, [stepId]: model }))} />}

      {/* Description (shown when no log output) */}
      {logLines.length === 0 && (
        <div className="px-4 py-3 border-b border-[#313244]/50 shrink-0">
          <p className="text-xs text-[#6c7086]">{task.description}</p>
        </div>
      )}

      {/* Log output */}
      <LogOutput lines={logLines} flags={flags} />

      {/* Status bar */}
      <StatusBar task={task} job={currentJob} />
    </div>
  );
}
