// Site search configuration
export interface SiteConfig {
  id: string;
  name: string;
  shortcut: string; // e.g. "s", "g"
  urlTemplate: string; // e.g. "https://example.com/search?q={query}"
  domains: string[]; // multiple domains for intranet + external
  pathPrefix?: string; // e.g. "/myorg" - only match URLs under this path
  color?: string; // theme color
  icon?: string; // favicon URL or data URL
}

// Browser history entry (from chrome.history)
export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  lastVisitTime: number;
  visitCount: number;
}

// Dictionary
export interface Dictionary {
  id: string;
  name: string;
  themeColor: string;
  format: ColumnMapping;
  entries: DictionaryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ColumnMapping {
  termColumn: number; // 0-indexed column index
  readingColumn?: number;
  descriptionColumn?: number;
  tagColumn?: number;
}

export interface DictionaryEntry {
  id: string;
  term: string;
  reading?: string;
  description?: string;
  tags?: string[];
}

// Search mode
export type SearchMode = 'site' | 'history' | 'dictionary';

// Bookmark entry
export interface BookmarkEntry {
  id: string;
  title: string;
  url: string;
}

// Search result
export type SearchResult =
  | { type: 'site'; site: SiteConfig; query: string }
  | { type: 'history'; entry: HistoryEntry }
  | { type: 'dictionary'; entry: DictionaryEntry; dictionary: Dictionary }
  | { type: 'bookmark'; entry: BookmarkEntry }
  | { type: 'google'; query: string };

// Settings
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  maxHistoryResults: number;
  maxSiteResults: number;
  historyShortcut: string; // shortcut prefix for history, e.g. "h"
  dictShortcut: string; // shortcut prefix for dictionary, e.g. "d"
}

// Messages
export type Message =
  | { action: 'TOGGLE_SEARCH' }
  | { action: 'HIDE_SEARCH' }
  | { action: 'SEARCH_HISTORY'; query: string }
  | { action: 'SEARCH_HISTORY_RESULT'; results: HistoryEntry[] };
