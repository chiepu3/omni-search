import JSZip from 'jszip';
import type { SiteConfig, Dictionary, Settings } from '@/types';

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  maxHistoryResults: 20,
  maxSiteResults: 5,
  historyShortcut: 'h',
  dictShortcut: 'd',
};

const KEYS = {
  sites: 'omnisearch_sites',
  dictionaries: 'omnisearch_dicts',
  settings: 'omnisearch_settings',
  bookmarkShortcuts: 'omnisearch_bm_shortcuts',
} as const;

export const storage = {
  async getSites(): Promise<SiteConfig[]> {
    const data = await chrome.storage.local.get(KEYS.sites);
    return (data[KEYS.sites] as SiteConfig[]) ?? [];
  },

  async saveSites(sites: SiteConfig[]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.sites]: sites });
  },

  async getDictionaries(): Promise<Dictionary[]> {
    const data = await chrome.storage.local.get(KEYS.dictionaries);
    return (data[KEYS.dictionaries] as Dictionary[]) ?? [];
  },

  async saveDictionaries(dicts: Dictionary[]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.dictionaries]: dicts });
  },

  async getSettings(): Promise<Settings> {
    const data = await chrome.storage.local.get(KEYS.settings);
    return { ...DEFAULT_SETTINGS, ...(data[KEYS.settings] as Partial<Settings> ?? {}) };
  },

  async saveSettings(settings: Settings): Promise<void> {
    await chrome.storage.local.set({ [KEYS.settings]: settings });
  },

  async getBookmarkShortcuts(): Promise<Record<string, string>> {
    const data = await chrome.storage.local.get(KEYS.bookmarkShortcuts);
    return (data[KEYS.bookmarkShortcuts] as Record<string, string>) ?? {};
  },

  async saveBookmarkShortcuts(shortcuts: Record<string, string>): Promise<void> {
    await chrome.storage.local.set({ [KEYS.bookmarkShortcuts]: shortcuts });
  },

  async exportAll(): Promise<Blob> {
    const [sites, dicts, settings] = await Promise.all([
      this.getSites(),
      this.getDictionaries(),
      this.getSettings(),
    ]);
    const zip = new JSZip();
    zip.file('sites.json', JSON.stringify(sites, null, 2));
    zip.file('dicts.json', JSON.stringify(dicts, null, 2));
    zip.file('settings.json', JSON.stringify(settings, null, 2));
    return zip.generateAsync({ type: 'blob' });
  },

  async importAll(file: File): Promise<void> {
    const zip = await JSZip.loadAsync(file);
    const readJson = async (name: string) => {
      const f = zip.file(name);
      if (!f) return null;
      return JSON.parse(await f.async('string'));
    };
    const [sites, dicts, settings] = await Promise.all([
      readJson('sites.json'),
      readJson('dicts.json'),
      readJson('settings.json'),
    ]);
    await Promise.all([
      sites && this.saveSites(sites),
      dicts && this.saveDictionaries(dicts),
      settings && this.saveSettings({ ...DEFAULT_SETTINGS, ...settings }),
    ]);
  },
};
