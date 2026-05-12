import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';
import type { Settings } from '@/types';

export function GeneralSection() {
  const [settings, setSettings] = useState<Settings>({
    theme: 'system',
    maxHistoryResults: 20,
    maxSiteResults: 5,
    historyShortcut: 'h',
    dictShortcut: 'd',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Section title="カラーテーマ">
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['dark', 'light', 'system'] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                save({ theme: t });
                document.documentElement.setAttribute('data-theme', t);
              }}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                backgroundColor: settings.theme === t ? 'var(--accent)' : 'var(--surface-hover)',
                color: settings.theme === t ? '#fff' : 'var(--text)',
              }}
            >
              {t === 'dark' ? 'ダーク' : t === 'light' ? 'ライト' : 'システム'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="キーボードショートカット">
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          デフォルト：<kbd style={{ backgroundColor: 'var(--surface)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>Alt+Shift+K</kbd>
          <br />
          Chrome設定で変更：chrome://extensions/shortcuts
        </p>
      </Section>

      <Section title="履歴検索プレフィックス">
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
          履歴検索専用のショートカットキーワード
        </label>
        <input
          type="text"
          value={settings.historyShortcut}
          onChange={e => save({ historyShortcut: e.target.value })}
          style={{ ...inputStyle, width: '96px' }}
        />
      </Section>

      <Section title="辞書検索プレフィックス">
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
          辞書専用検索のショートカットキーワード
        </label>
        <input
          type="text"
          value={settings.dictShortcut}
          onChange={e => save({ dictShortcut: e.target.value })}
          style={{ ...inputStyle, width: '96px' }}
        />
      </Section>

      <Section title="最大表示件数">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            履歴の件数
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxHistoryResults}
              onChange={e => save({ maxHistoryResults: Number(e.target.value) })}
              style={{ ...inputStyle, width: '80px' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            サイトの件数
            <input
              type="number"
              min={1}
              max={20}
              value={settings.maxSiteResults}
              onChange={e => save({ maxSiteResults: Number(e.target.value) })}
              style={{ ...inputStyle, width: '80px' }}
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
      <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{title}</h2>
      <div style={{ backgroundColor: 'var(--surface)', borderRadius: '8px', padding: '16px' }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-hover)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '13px',
  outline: 'none',
};
