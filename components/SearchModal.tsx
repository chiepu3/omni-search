import { useState, useEffect, useRef, useCallback } from 'react';
import Fuse from 'fuse.js';
import type { SearchResult, SiteConfig, HistoryEntry, BookmarkEntry, Dictionary, DictionaryEntry } from '@/types';
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
  const [settings, setSettings] = useState({ historyShortcut: 'h', dictShortcut: 'd', maxHistoryResults: 20, maxSiteResults: 5 });
  const [activeSite, setActiveSite] = useState<SiteConfig | null>(null);
  const [activeMode, setActiveMode] = useState<'site' | 'history' | 'dict' | null>(null);
  const [bookmarkShortcuts, setBookmarkShortcuts] = useState<Record<string, string>>({});
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
    storage.getBookmarkShortcuts().then(setBookmarkShortcuts);
    inputRef.current?.focus();
  }, []);

  const handleQuery = useCallback(async (q: string) => {
    setQuery(q);
    setSelectedIndex(0);

    if (!q.trim()) {
      setResults([]);
      setActiveSite(null);
      setActiveMode(null);
      return;
    }

    const newResults: SearchResult[] = [];
    const histPrefix = settings.historyShortcut + ' ';
    const dictPrefix = settings.dictShortcut + ' ';
    const isHistoryOnly = q.startsWith(histPrefix) || q === settings.historyShortcut;
    const isDictOnly = q.startsWith(dictPrefix) || q === settings.dictShortcut;

    // ショートカットモード表示
    if (isHistoryOnly) {
      setActiveSite(null);
      setActiveMode('history');
    } else if (isDictOnly) {
      setActiveSite(null);
      setActiveMode('dict');
    }

    // サイトショートカット（履歴・辞書専用モードでなければ）
    let siteMatch: { site: SiteConfig; query: string } | null = null;
    if (!isHistoryOnly && !isDictOnly) {
      siteMatch = matchSiteShortcut(q, sites);
      if (siteMatch) {
        setActiveSite(siteMatch.site);
        setActiveMode('site');
        newResults.push({ type: 'site', site: siteMatch.site, query: siteMatch.query });
      } else {
        setActiveSite(null);
        setActiveMode(null);
        // ショートカットプレフィックス候補
        for (const site of sites) {
          if (site.shortcut.startsWith(q.trim())) {
            newResults.push({ type: 'site', site, query: '' });
            if (newResults.length >= settings.maxSiteResults) break;
          }
        }
      }
    }

    // ブックマークショートカットチェック（履歴・辞書専用モード以外）
    if (!isHistoryOnly && !isDictOnly && !siteMatch) {
      const trimmed = q.trim();
      const bmShortcutEntry = Object.entries(bookmarkShortcuts).find(([_, sc]) => {
        return trimmed === sc || trimmed.startsWith(sc + ' ');
      });
      if (bmShortcutEntry) {
        const [bmId] = bmShortcutEntry;
        try {
          const [bm] = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
            chrome.bookmarks.get(bmId, resolve);
          });
          if (bm?.url) {
            newResults.unshift({ type: 'bookmark', entry: { id: bm.id, title: bm.title || bm.url, url: bm.url } });
          }
        } catch { /* ignore */ }
      }
    }

    // 辞書専用モード
    if (isDictOnly) {
      const dictQ = q.slice(dictPrefix.length).trim();
      if (dictQ) {
        for (const dict of dicts) {
          searchDictionary(dict, dictQ).slice(0, 5).forEach(entry => {
            newResults.push({ type: 'dictionary', entry, dictionary: dict });
          });
        }
      }
      setResults(newResults);
      return;
    }

    // 履歴検索クエリ
    // siteMatch時: ドメイン名でChrome履歴を取得 → ドメインフィルタ → クエリでfuzzy
    // それ以外: クエリでChrome履歴検索 → fuzzy
    const chromeHistQ = isHistoryOnly
      ? q.slice(histPrefix.length).trim()
      : siteMatch
        ? (siteMatch.site.domains.find(d => d.trim()) ?? '')
        : q.trim();
    const fuseQ = isHistoryOnly ? q.slice(histPrefix.length).trim() : (siteMatch ? siteMatch.query : q.trim());

    if (chromeHistQ !== '' || siteMatch) {
      try {
        const histResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_HISTORY',
          query: chromeHistQ,
        }) as HistoryEntry[];

        if (histResults?.length) {
          const domainFiltered = siteMatch
            ? histResults.filter(e => {
                const site = siteMatch!.site;
                const domainOk = site.domains.some(d => d.trim() && e.url.includes(d.trim()));
                if (!domainOk) return false;
                if (site.pathPrefix?.trim()) {
                  try {
                    const u = new URL(e.url);
                    return u.pathname.startsWith(site.pathPrefix.trim());
                  } catch { return false; }
                }
                return true;
              })
            : histResults;

          const fuse = new Fuse(domainFiltered, { keys: ['title', 'url'], threshold: 0.4 });
          const fuzzy = fuseQ ? fuse.search(fuseQ).map(r => r.item) : domainFiltered;
          fuzzy.slice(0, settings.maxHistoryResults).forEach(entry => {
            newResults.push({ type: 'history', entry });
          });
        }
      } catch { /* ignore */ }
    }

    // ブックマーク検索（履歴専用・辞書専用モード以外かつサイトマッチなし）
    if (!isHistoryOnly && !isDictOnly && !siteMatch && q.trim()) {
      try {
        const bmResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_BOOKMARKS',
          query: siteMatch ? siteMatch.query : q.trim(),
        }) as BookmarkEntry[];
        if (bmResults?.length) {
          bmResults.slice(0, 5).forEach(entry => {
            newResults.push({ type: 'bookmark', entry });
          });
        }
      } catch { /* ignore */ }
    }

    // 辞書検索（サイトマッチ・履歴専用・辞書専用モード以外）
    if (!isHistoryOnly && !isDictOnly && !siteMatch && q.trim()) {
      const dictQ = siteMatch ? siteMatch.query : q.trim();
      if (dictQ) {
        for (const dict of dicts) {
          searchDictionary(dict, dictQ).slice(0, 3).forEach(entry => {
            newResults.push({ type: 'dictionary', entry, dictionary: dict });
          });
        }
      }
    }

    setResults(newResults);
  }, [sites, dicts, settings, bookmarkShortcuts]);

  const open = useCallback((result: SearchResult, target: 'tab' | 'window' | 'current') => {
    if (result.type === 'dictionary') {
      setDictEntry({ entry: result.entry, dict: result.dictionary });
      return;
    }

    let url: string;
    if (result.type === 'site') {
      url = buildUrl(result.site, result.query);
    } else if (result.type === 'bookmark') {
      url = result.entry.url;
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
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      onClose();
      return;
    }

    if (e.key === 'Escape') {
      if (dictEntry) {
        setDictEntry(null);
        return;
      }
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
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
  }, [results, selectedIndex, open, onClose, dictEntry]);

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
            ) : activeMode === 'history' ? (
              <span className="text-sm font-semibold whitespace-nowrap flex-shrink-0" style={{ color: '#60a5fa' }}>
                履歴
              </span>
            ) : activeMode === 'dict' ? (
              <span className="text-sm font-semibold whitespace-nowrap flex-shrink-0" style={{ color: '#34d399' }}>
                辞書
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
                onClick={() => { setQuery(''); setResults([]); setActiveSite(null); setActiveMode(null); inputRef.current?.focus(); }}
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
        <div data-theme={theme}>
          <DictionaryModal
            entry={dictEntry.entry}
            dictionary={dictEntry.dict}
            onClose={() => setDictEntry(null)}
          />
        </div>
      )}
    </>
  );
}
