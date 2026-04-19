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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="w-[460px] rounded-xl bg-white border border-[#E5E1D8] shadow-xl shadow-black/8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E1D8]">
          <h2 className="text-[14px] font-semibold text-[#1C1A17]">Settings</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-[#A39D94] hover:text-[#1C1A17] text-lg leading-none transition-colors rounded hover:bg-[#F6F5F2]"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Default model */}
          <section>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-[#A39D94] mb-2 font-semibold">
              Default Model (Anthropic)
            </label>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full bg-[#F6F5F2] border border-[#E5E1D8] rounded-lg px-3 py-2 text-[13px] text-[#1C1A17]
                focus:outline-none focus:border-[#1D4ED8]/40 transition-colors"
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
                <label className="block text-[10px] uppercase tracking-[0.15em] text-[#A39D94] font-semibold">
                  OpenRouter
                </label>
                <p className="text-[12px] text-[#A39D94] mt-1 leading-relaxed">
                  Use OpenRouter for model access — key from <code className="font-mono text-[#6B665E] bg-[#F6F5F2] px-1 py-0.5 rounded text-[11px]">OPENROUTER_API_KEY</code>
                </p>
              </div>
              <button
                onClick={() => setUseOpenRouter((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${
                  useOpenRouter ? 'bg-[#1D4ED8]' : 'bg-[#E5E1D8]'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    useOpenRouter ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {useOpenRouter && (
              <select
                value={orModel}
                onChange={(e) => setOrModel(e.target.value)}
                className="w-full bg-[#F6F5F2] border border-[#E5E1D8] rounded-lg px-3 py-2 text-[13px] text-[#1C1A17]
                  focus:outline-none focus:border-[#1D4ED8]/40 transition-colors"
              >
                {OPENROUTER_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E5E1D8]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#6B665E] hover:text-[#1C1A17] hover:bg-[#F6F5F2] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#1D4ED8] text-white
              hover:bg-[#1E40AF] disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
