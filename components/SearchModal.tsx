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
  const latestResultsRef = useRef<SearchResult[]>([]);
  const queryIdRef = useRef(0);

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
    const myId = ++queryIdRef.current;
    setQuery(q);
    setSelectedIndex(0);

    if (!q.trim()) {
      latestResultsRef.current = [];
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

    // ここまでは同期処理 — Enterキーが使える最新結果をrefに保存
    latestResultsRef.current = [...newResults];

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
          if (myId !== queryIdRef.current) return;
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
      latestResultsRef.current = newResults;
      setResults(newResults);
      return;
    }

    // 履歴検索
    const fuseQ = isHistoryOnly
      ? q.slice(histPrefix.length).trim()
      : siteMatch ? siteMatch.query : q.trim();

    if (fuseQ || siteMatch) {
      try {
        const validDomains = siteMatch
          ? siteMatch.site.domains.filter(d => d.trim())
          : [];

        // ドメインがあればドメイン名でChrome履歴を引く、なければクエリで引く
        const chromeQ = siteMatch
          ? (validDomains[0] ?? fuseQ)
          : fuseQ;

        const histResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_HISTORY',
          query: chromeQ,
        }) as HistoryEntry[];

        if (myId !== queryIdRef.current) return;

        if (histResults?.length) {
          let filtered = histResults;
          if (siteMatch && validDomains.length > 0) {
            filtered = histResults.filter(e => {
              const domainOk = validDomains.some(d => e.url.includes(d));
              if (!domainOk) return false;
              if (siteMatch.site.pathPrefix?.trim()) {
                try {
                  const u = new URL(e.url);
                  return u.pathname.startsWith(siteMatch.site.pathPrefix.trim());
                } catch { return false; }
              }
              return true;
            });
          }

          if (fuseQ) {
            // URLの末尾マッチも拾えるようdistanceを広げる
            const fuse = new Fuse(filtered, {
              keys: ['title', 'url'],
              threshold: 0.4,
              distance: 1000,
              includeScore: false,
            });
            filtered = fuse.search(fuseQ).map(r => r.item);
          }

          filtered.slice(0, settings.maxHistoryResults).forEach(entry => {
            newResults.push({ type: 'history', entry });
          });
        }
      } catch { /* ignore */ }
    }

    if (myId !== queryIdRef.current) return;

    // ブックマーク検索（履歴専用・辞書専用モード以外かつサイトマッチなし）
    if (!isHistoryOnly && !isDictOnly && !siteMatch && q.trim()) {
      try {
        const bmResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_BOOKMARKS',
          query: siteMatch ? siteMatch.query : q.trim(),
        }) as BookmarkEntry[];
        if (myId !== queryIdRef.current) return;
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

    // Google検索を最下位に追加（通常クエリのみ）
    if (!siteMatch && q.trim()) {
      newResults.push({ type: 'google', query: q.trim() });
    }

    latestResultsRef.current = newResults;
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
    } else if (result.type === 'google') {
      url = `https://www.google.com/search?q=${encodeURIComponent(result.query)}`;
    } else if (result.type === 'bookmark') {
      url = result.entry.url;
    } else {
      url = (result as { entry: { url: string } }).entry.url;
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

  // 現在のクエリからショートカットプレフィックスを除いた純粋なクエリを返す
  const extractBareQuery = useCallback((q: string): string => {
    const histPrefix = settings.historyShortcut + ' ';
    if (q.startsWith(histPrefix)) return q.slice(histPrefix.length);
    if (q === settings.historyShortcut) return '';

    const dictPrefix = settings.dictShortcut + ' ';
    if (q.startsWith(dictPrefix)) return q.slice(dictPrefix.length);
    if (q === settings.dictShortcut) return '';

    for (const site of sites) {
      const sitePrefix = site.shortcut + ' ';
      if (q.toLowerCase().startsWith(sitePrefix.toLowerCase())) return q.slice(sitePrefix.length);
      if (q.toLowerCase() === site.shortcut.toLowerCase()) return '';
    }

    return q;
  }, [settings.historyShortcut, settings.dictShortcut, sites]);

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

    // Alt+[ショートカットキー] で入力済みクエリを保持したままモード切替
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1 && e.key !== ' ') {
      const pressed = e.key.toLowerCase();
      let targetPrefix: string | null = null;

      if (pressed === settings.historyShortcut.toLowerCase()) {
        targetPrefix = settings.historyShortcut;
      } else if (pressed === settings.dictShortcut.toLowerCase()) {
        targetPrefix = settings.dictShortcut;
      } else {
        const site = sites.find(s => s.shortcut.length === 1 && s.shortcut.toLowerCase() === pressed);
        if (site) targetPrefix = site.shortcut;
      }

      if (targetPrefix !== null) {
        e.preventDefault();
        const bare = extractBareQuery(query);
        const fullPrefix = targetPrefix + ' ';
        const isAlreadyActive =
          query.toLowerCase().startsWith(fullPrefix.toLowerCase()) ||
          query.toLowerCase() === targetPrefix.toLowerCase();
        const newQuery = isAlreadyActive ? bare : (bare ? fullPrefix + bare : targetPrefix);
        handleQuery(newQuery);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(newQuery.length, newQuery.length);
          }
        }, 0);
        return;
      }
    }

    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setSelectedIndex(i => {
        const max = results.length - 1;
        return max < 0 ? 0 : Math.min(i + 1, max);
      });
      return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // refを参照することでasync処理中でも最新クエリの結果を使う
      const result = latestResultsRef.current[selectedIndex] ?? results[selectedIndex];
      if (!result) return;

      if (e.ctrlKey || e.metaKey) {
        open(result, 'tab');
      } else if (e.shiftKey) {
        open(result, 'window');
      } else {
        open(result, 'current');
      }
    }
  }, [results, selectedIndex, open, onClose, dictEntry, settings, sites, query, extractBareQuery, handleQuery]);

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
        tabIndex={-1}
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
            <span><kbd>Alt+{settings.historyShortcut.toUpperCase()}</kbd>/<kbd>{settings.dictShortcut.toUpperCase()}</kbd> モード切替</span>
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
