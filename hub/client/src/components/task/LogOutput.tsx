import React, { useEffect, useRef } from 'react';
import type { LogLine } from '../../types.ts';

interface Props {
  lines: LogLine[];
  flags: string[];
}

const STEP_RE = /^\[(\d+)\/(\d+)\]\s+(.+)/;

function renderLine(line: LogLine, idx: number) {
  const text = line.text;
  if (!text && text !== '0') return null;

  const stepMatch = text.match(STEP_RE);
  if (stepMatch) {
    const [, n, total, rest] = stepMatch;
    return (
      <div key={idx} className="flex items-start gap-2 mt-2 mb-0.5">
        <span className="text-[#1D4ED8] shrink-0 text-[10px] mt-0.5">▶</span>
        <span>
          <span className="text-[#A39D94] font-mono text-[11px]">[{n}/{total}]</span>
          <span className="text-[#1C1A17] font-medium"> {rest}</span>
        </span>
      </div>
    );
  }

  if (line.type === 'stderr') {
    return (
      <div key={idx} className="text-[#DC2626] opacity-90">
        {text}
      </div>
    );
  }

  if (line.type === 'system') {
    return (
      <div key={idx} className="text-[#A39D94] italic">
        {text}
      </div>
    );
  }

  // Highlight common patterns
  if (text.includes('{FLG:')) {
    return (
      <div key={idx} className="text-[#B45309] font-semibold bg-[#FEF3C7] px-2 py-0.5 rounded">
        ◆ {text}
      </div>
    );
  }

  if (text.match(/✓|success|done|completed|found|ok/i)) {
    return (
      <div key={idx} className="text-[#15803D]">
        {text}
      </div>
    );
  }

  if (text.match(/error|fail|exception/i)) {
    return (
      <div key={idx} className="text-[#DC2626]">
        {text}
      </div>
    );
  }

  if (text.match(/warning|warn/i)) {
    return (
      <div key={idx} className="text-[#D97706]">
        {text}
      </div>
    );
  }

  return (
    <div key={idx} className="text-[#1C1A17]">
      {text}
    </div>
  );
}

export function LogOutput({ lines, flags }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [lines.length]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-5 font-mono text-[12px] leading-[1.6] bg-[#FAFAF8]"
    >
      {lines.length === 0 && flags.length === 0 && (
        <p className="text-[#CCC8BF] italic">No output yet. Press Run to execute the task.</p>
      )}
      <div className="space-y-[1px]">
        {lines.map((line, idx) => renderLine(line, idx))}
      </div>

      {flags.length > 0 && (
        <div className="mt-5 space-y-1.5">
          {flags.map((flag, idx) => (
            <div key={idx} className="flex items-center gap-2 text-[#B45309] bg-[#FEF3C7] px-3 py-2 rounded-md border border-[#FDE68A]">
              <span className="text-[11px]">◆</span>
              <span className="font-semibold tracking-wide">{flag}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
