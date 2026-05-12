import { useState } from 'react';
import { storage } from '@/lib/storage';
import { SitesSection } from './sections/SitesSection';
import { DictionarySection } from './sections/DictionarySection';
import { GeneralSection } from './sections/GeneralSection';
import { IconSettings, IconSearch, IconBook, IconUpload, IconDownload } from '@/components/icons';

type Tab = 'general' | 'sites' | 'dictionary';

const TAB_LABELS: Record<Tab, { label: string; icon: React.ReactNode }> = {
  general: { label: '一般設定', icon: <IconSettings size={18} /> },
  sites: { label: 'サイト検索', icon: <IconSearch size={18} /> },
  dictionary: { label: '辞書', icon: <IconBook size={18} /> },
};

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sites');

  const handleExport = async () => {
    const json = await storage.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omnisearch-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await storage.importAll(text);
      alert('設定をインポートしました。拡張機能を再読み込みしてください。');
    };
    input.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--border)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <IconSearch size={24} color="var(--accent)" />
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>OmniSearch 設定</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleImport} style={btnStyle}>
            <IconUpload size={16} />
            インポート
          </button>
          <button onClick={handleExport} style={btnStyle}>
            <IconDownload size={16} />
            エクスポート
          </button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <nav style={{ width: '200px', borderRight: '1px solid var(--border)', padding: '16px 8px' }}>
          {(Object.entries(TAB_LABELS) as [Tab, typeof TAB_LABELS[Tab]][]).map(([tab, { label, icon }]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                ...navBtnStyle,
                backgroundColor: activeTab === tab ? 'var(--accent)' : 'transparent',
                color: activeTab === tab ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {activeTab === 'general' && <GeneralSection />}
          {activeTab === 'sites' && <SitesSection />}
          {activeTab === 'dictionary' && <DictionarySection />}
        </main>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
  backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

const navBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  fontSize: '14px', cursor: 'pointer', border: 'none',
  textAlign: 'left', marginBottom: '2px', transition: 'background-color 0.15s',
};
