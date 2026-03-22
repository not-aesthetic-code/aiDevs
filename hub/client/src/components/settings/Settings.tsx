import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import type { Settings } from '../../types.ts';

interface Props {
  onClose: () => void;
}

const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-3-5',
];

const OPENROUTER_MODELS = [
  'anthropic/claude-haiku',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.1-70b-instruct',
  'mistralai/mistral-large',
  'deepseek/deepseek-chat',
];

export function Settings({ onClose }: Props) {
  const { settings, saveSettings } = useSettingsStore();

  const [defaultModel, setDefaultModel] = useState(settings?.models.default ?? 'claude-haiku-4-5-20251001');
  const [useOpenRouter, setUseOpenRouter] = useState(settings?.models.useOpenRouter ?? false);
  const [orModel, setOrModel] = useState(settings?.models.openRouterDefault ?? 'anthropic/claude-haiku');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDefaultModel(settings.models.default);
      setUseOpenRouter(settings.models.useOpenRouter);
      setOrModel(settings.models.openRouterDefault);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        models: {
          default: defaultModel,
          useOpenRouter,
          openRouterDefault: orModel,
        } as Settings['models'],
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-lg bg-[#181825] border border-[#313244] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#313244]">
          <h2 className="text-sm font-semibold text-[#cdd6f4]">⚙️ Settings</h2>
          <button
            onClick={onClose}
            className="text-[#6c7086] hover:text-[#cdd6f4] text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Default model */}
          <section>
            <label className="block text-[10px] uppercase tracking-widest text-[#6c7086] mb-2 font-semibold">
              Default Model (Anthropic)
            </label>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full bg-[#11111b] border border-[#313244] rounded px-3 py-2 text-xs text-[#cdd6f4]
                focus:outline-none focus:border-[#89b4fa] transition-colors"
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </section>

          {/* OpenRouter toggle */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#6c7086] font-semibold">
                  OpenRouter
                </label>
                <p className="text-[11px] text-[#45475a] mt-0.5">
                  Use OpenRouter for model access — key read from <code className="text-[#6c7086]">OPENROUTER_API_KEY</code> in .env
                </p>
              </div>
              <button
                onClick={() => setUseOpenRouter((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${
                  useOpenRouter ? 'bg-[#a6e3a1]' : 'bg-[#313244]'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    useOpenRouter ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {useOpenRouter && (
              <select
                value={orModel}
                onChange={(e) => setOrModel(e.target.value)}
                className="w-full bg-[#11111b] border border-[#313244] rounded px-3 py-2 text-xs text-[#cdd6f4]
                  focus:outline-none focus:border-[#89b4fa] transition-colors"
              >
                {OPENROUTER_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#313244]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-xs text-[#a6adc8] hover:text-[#cdd6f4] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded text-xs font-medium bg-[#89b4fa]/15 text-[#89b4fa]
              border border-[#89b4fa]/40 hover:bg-[#89b4fa]/25 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
