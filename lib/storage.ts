import type { SiteConfig, Dictionary, Settings } from '@/types';

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  maxHistoryResults: 20,
  maxSiteResults: 5,
  historyShortcut: 'h',
};

const KEYS = {
  sites: 'omnisearch_sites',
  dictionaries: 'omnisearch_dicts',
  settings: 'omnisearch_settings',
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

  async exportAll(): Promise<string> {
    const [sites, dicts, settings] = await Promise.all([
      this.getSites(),
      this.getDictionaries(),
      this.getSettings(),
    ]);
    return JSON.stringify({ sites, dicts, settings }, null, 2);
  },

  async importAll(json: string): Promise<void> {
    const data = JSON.parse(json);
    await Promise.all([
      data.sites && this.saveSites(data.sites),
      data.dicts && this.saveDictionaries(data.dicts),
      data.settings && this.saveSettings({ ...DEFAULT_SETTINGS, ...data.settings }),
    ]);
  },
};
