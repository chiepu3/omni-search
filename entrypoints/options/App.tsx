import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';
import { SitesSection } from './sections/SitesSection';
import { DictionarySection } from './sections/DictionarySection';
import { GeneralSection } from './sections/GeneralSection';

type Tab = 'general' | 'sites' | 'dictionary';

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
      alert('Settings imported. Please reload the extension.');
    };
    input.click();
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">OmniSearch Settings</h1>
        <div className="flex gap-2">
          <button
            onClick={handleImport}
            className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300"
          >
            Import
          </button>
          <button
            onClick={handleExport}
            className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300"
          >
            Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0">
        {(['general', 'sites', 'dictionary'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm capitalize rounded-t transition-colors ${
              activeTab === tab
                ? 'bg-violet-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab === 'general' ? 'General' : tab === 'sites' ? 'Site Search' : 'Dictionary'}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralSection />}
      {activeTab === 'sites' && <SitesSection />}
      {activeTab === 'dictionary' && <DictionarySection />}
    </div>
  );
}
