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
      <div key={idx} className="flex items-start gap-2 mt-1">
        <span className="text-[#89b4fa] shrink-0">▶</span>
        <span>
          <span className="text-[#6c7086]">[{n}/{total}]</span>
          <span className="text-[#cdd6f4]"> {rest}</span>
        </span>
      </div>
    );
  }

  if (line.type === 'stderr') {
    return (
      <div key={idx} className="text-[#f38ba8] opacity-80">
        {text}
      </div>
    );
  }

  if (line.type === 'system') {
    return (
      <div key={idx} className="text-[#6c7086] italic">
        {text}
      </div>
    );
  }

  // Highlight common patterns
  if (text.includes('{FLG:')) {
    return (
      <div key={idx} className="text-[#f9e2af] font-semibold">
        🏆 {text}
      </div>
    );
  }

  if (text.match(/✓|success|done|completed|found|ok/i)) {
    return (
      <div key={idx} className="text-[#a6e3a1]">
        {text}
      </div>
    );
  }

  if (text.match(/error|fail|exception/i)) {
    return (
      <div key={idx} className="text-[#f38ba8]">
        {text}
      </div>
    );
  }

  if (text.match(/warning|warn/i)) {
    return (
      <div key={idx} className="text-[#f9e2af]">
        {text}
      </div>
    );
  }

  return (
    <div key={idx} className="text-[#a6adc8]">
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
      className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 bg-[#11111b]"
    >
      {lines.length === 0 && (
        <p className="text-[#45475a] italic">No output yet. Press Run to execute the task.</p>
      )}
      <div className="space-y-0.5">
        {lines.map((line, idx) => renderLine(line, idx))}
      </div>

      {flags.length > 0 && (
        <div className="mt-4 space-y-1">
          {flags.map((flag, idx) => (
            <div key={idx} className="flex items-center gap-2 text-[#f9e2af]">
              <span>🏆</span>
              <span className="font-semibold tracking-wide">{flag}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
