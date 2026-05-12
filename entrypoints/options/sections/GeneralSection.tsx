import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';
import type { Settings } from '@/types';

export function GeneralSection() {
  const [settings, setSettings] = useState<Settings>({
    theme: 'system',
    maxHistoryResults: 20,
    maxSiteResults: 5,
    historyShortcut: 'h',
  });

  useEffect(() => {
    storage.getSettings().then(setSettings);
  }, []);

  const save = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await storage.saveSettings(next);
  };

  return (
    <div className="space-y-6">
      <Section title="Keyboard Shortcut">
        <p className="text-sm text-gray-400">
          Default: <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-xs">Alt+Shift+K</kbd>
          <br />
          Change in Chrome settings: chrome://extensions/shortcuts
        </p>
      </Section>

      <Section title="History Shortcut Prefix">
        <label className="text-sm text-gray-300">
          Prefix keyword for history-only search
        </label>
        <input
          type="text"
          value={settings.historyShortcut}
          onChange={e => save({ historyShortcut: e.target.value })}
          className="mt-1 bg-white/10 text-white rounded px-3 py-1.5 text-sm w-24 outline-none focus:ring-2 focus:ring-violet-500"
        />
      </Section>

      <Section title="Max Results">
        <div className="space-y-2">
          <label className="flex items-center gap-3 text-sm text-gray-300">
            History results
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxHistoryResults}
              onChange={e => save({ maxHistoryResults: Number(e.target.value) })}
              className="bg-white/10 text-white rounded px-2 py-1 text-sm w-20 outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-300">
            Site results
            <input
              type="number"
              min={1}
              max={20}
              value={settings.maxSiteResults}
              onChange={e => save({ maxSiteResults: Number(e.target.value) })}
              className="bg-white/10 text-white rounded px-2 py-1 text-sm w-20 outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h2>
      <div className="bg-white/5 rounded-lg p-4">{children}</div>
    </div>
  );
}
