import { useState, useEffect, useRef, useCallback } from 'react';
import Fuse from 'fuse.js';
import type { SearchResult, SiteConfig, HistoryEntry, Dictionary, DictionaryEntry } from '@/types';
import { storage } from '@/lib/storage';
import { matchSiteShortcut, buildUrl } from '@/lib/sites';
import { searchDictionary } from '@/lib/dictionary';
import { ResultList } from './ResultList';
import { DictionaryModal } from './DictionaryModal';
import { IconSearch, IconClose } from './icons';

interface Props {
  onClose: () => void;
}

export function SearchModal({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [settings, setSettings] = useState({ historyShortcut: 'h', maxHistoryResults: 20, maxSiteResults: 5 });
  const [activeSite, setActiveSite] = useState<SiteConfig | null>(null);
  const [dictEntry, setDictEntry] = useState<{ entry: DictionaryEntry; dict: Dictionary } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([storage.getSites(), storage.getDictionaries(), storage.getSettings()]).then(
      ([s, d, cfg]) => {
        setSites(s);
        setDicts(d);
        setSettings(cfg as any);
        setTheme((cfg as any).theme || 'dark');
      }
    );
    inputRef.current?.focus();
  }, []);

  const handleQuery = useCallback(async (q: string) => {
    setQuery(q);
    setSelectedIndex(0);

    if (!q.trim()) {
      setResults([]);
      setActiveSite(null);
      return;
    }

    const newResults: SearchResult[] = [];

    // Check if query starts with history shortcut
    const histPrefix = settings.historyShortcut + ' ';
    const isHistorySearch = q.startsWith(histPrefix) || q === settings.historyShortcut;
    const historyQuery = isHistorySearch ? q.slice(histPrefix.length) : q;

    // Site search
    const siteMatch = matchSiteShortcut(q, sites);
    if (siteMatch) {
      setActiveSite(siteMatch.site);
      newResults.push({ type: 'site', site: siteMatch.site, query: siteMatch.query });
    } else {
      setActiveSite(null);
      // Show all matching sites by shortcut prefix
      for (const site of sites) {
        if (site.shortcut.startsWith(q.trim())) {
          newResults.push({ type: 'site', site, query: '' });
          if (newResults.length >= settings.maxSiteResults) break;
        }
      }
    }

    // History search
    const histSearchQuery = siteMatch ? siteMatch.query : historyQuery;
    if (histSearchQuery.trim()) {
      try {
        const histResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_HISTORY',
          query: histSearchQuery,
        }) as HistoryEntry[];

        if (histResults?.length) {
          // サイトマッチ時はそのサイトのドメインに絞り込む
          const domainFiltered = siteMatch
            ? histResults.filter(e =>
                siteMatch.site.domains.some(d => d.trim() && e.url.includes(d.trim()))
              )
            : histResults;

          const fuse = new Fuse(domainFiltered, {
            keys: ['title', 'url'],
            threshold: 0.4,
          });
          const fuzzy = histSearchQuery.trim()
            ? fuse.search(histSearchQuery).map(r => r.item)
            : domainFiltered;

          fuzzy.slice(0, settings.maxHistoryResults).forEach(entry => {
            newResults.push({ type: 'history', entry });
          });
        }
      } catch {
        // ignore
      }
    }

    // Dictionary search
    const dictQuery = q.trim();
    if (dictQuery) {
      for (const dict of dicts) {
        const entries = searchDictionary(dict, dictQuery);
        entries.slice(0, 3).forEach(entry => {
          newResults.push({ type: 'dictionary', entry, dictionary: dict });
        });
      }
    }

    setResults(newResults);
  }, [sites, dicts, settings]);

  const open = useCallback((result: SearchResult, target: 'tab' | 'window' | 'current') => {
    if (result.type === 'dictionary') {
      setDictEntry({ entry: result.entry, dict: result.dictionary });
      return;
    }

    let url: string;
    if (result.type === 'site') {
      url = buildUrl(result.site, result.query);
    } else {
      url = result.entry.url;
    }

    if (target === 'tab') {
      chrome.runtime.sendMessage({ action: 'OPEN_URL', url, target: 'tab' });
    } else if (target === 'window') {
      chrome.runtime.sendMessage({ action: 'OPEN_URL', url, target: 'window' });
    } else {
      chrome.runtime.sendMessage({ action: 'OPEN_URL', url, target: 'current' });
    }
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (dictEntry) {
        setDictEntry(null);
        return;
      }
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
      return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[selectedIndex];
      if (!result) return;

      if (e.ctrlKey || e.metaKey) {
        open(result, 'tab');
      } else if (e.shiftKey) {
        open(result, 'window');
      } else {
        open(result, 'current');
      }
    }
  }, [results, selectedIndex, open, onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-[2147483645]"
        data-theme={theme}
        onClick={onClose}
      />
      <div
        className="fixed z-[2147483645] left-1/2 -translate-x-1/2 top-[20vh] w-[600px] max-w-[95vw]"
        data-theme={theme}
        onKeyDown={e => e.stopPropagation()}
        onKeyUp={e => e.stopPropagation()}
        onKeyPress={e => e.stopPropagation()}
      >
        <div className="rounded-xl shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--os-bg)', border: '1px solid var(--os-border)' }}>
          {/* input row */}
          <div className="flex items-center px-4 py-3 gap-3">
            {activeSite ? (
              <span className="text-sm font-semibold whitespace-nowrap flex-shrink-0" style={{ color: '#a78bfa' }}>
                {activeSite.name}
              </span>
            ) : (
              <IconSearch size={18} color="var(--os-text-secondary)" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => handleQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="サイト・履歴・辞書を検索..."
              className="flex-1 bg-transparent outline-none text-base"
              style={{ color: 'var(--os-text)' }}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); setActiveSite(null); inputRef.current?.focus(); }}
                className="leading-none flex items-center"
                style={{ color: 'var(--os-text-secondary)' }}
              >
                <IconClose size={18} />
              </button>
            )}
          </div>

          {/* results */}
          {results.length > 0 && (
            <div className="px-2 pb-2" style={{ borderTop: '1px solid var(--os-border)' }}>
              <ResultList
                results={results}
                selectedIndex={selectedIndex}
                onSelect={r => open(r, 'current')}
                onHover={setSelectedIndex}
              />
            </div>
          )}

          {/* hint bar */}
          <div className="px-4 py-1.5 flex gap-4 text-xs" style={{ borderTop: '1px solid var(--os-border)', color: 'var(--os-text-secondary)' }}>
            <span><kbd>Enter</kbd> 現タブで開く</span>
            <span><kbd>Ctrl+Enter</kbd> 新しいタブ</span>
            <span><kbd>Shift+Enter</kbd> 新しいウィンドウ</span>
            <span><kbd>↑↓</kbd> 選択</span>
            <span><kbd>Esc</kbd> 閉じる</span>
          </div>
        </div>
      </div>

      {dictEntry && (
        <DictionaryModal
          entry={dictEntry.entry}
          dictionary={dictEntry.dict}
          onClose={() => setDictEntry(null)}
        />
      )}
    </>
  );
}
