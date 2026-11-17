import { useState, useEffect, useRef, useCallback } from 'react';
import Fuse from 'fuse.js';
import type { SearchResult, SiteConfig, HistoryEntry, BookmarkEntry, Dictionary, DictionaryEntry, Settings } from '@/types';
import type { FulltextHit, FulltextStats } from '@/lib/fulltext/protocol';
import { storage, DEFAULT_SETTINGS } from '@/lib/storage';
import { matchSiteShortcut, buildUrl } from '@/lib/sites';
import { searchDictionary } from '@/lib/dictionary';
import { ftRequest } from '@/lib/fulltext/client';
import { canonicalUrl } from '@/lib/fulltext/url';
import { ResultList } from './ResultList';
import { DictionaryModal } from './DictionaryModal';
import { FulltextPreviewModal } from './FulltextPreviewModal';
import { IconSearch, IconClose } from './icons';

type FulltextResult = Extract<SearchResult, { type: 'fulltext' }>;
type OpenTarget = 'tab' | 'window' | 'current';

// キー入力ごとに全文検索を投げないための待ち時間
const FT_DEBOUNCE_MS = 120;
// プレフィックスなしの通常検索に混ぜる全文検索の件数
const FT_MIX_LIMIT = 3;

// プレフィックスなしの検索で、先に出した結果へ全文検索の結果を後から差し込むための状態
interface FulltextMix {
  id: number;
  insertAt: number; // 履歴結果の直後（ブックマーク検索結果の前）
  base: SearchResult[] | null;
  ft: FulltextResult[] | null;
}

function isPrefixed(q: string, shortcut: string): boolean {
  return shortcut !== '' && (q.startsWith(shortcut + ' ') || q === shortcut);
}

function urlKey(url: string): string {
  return canonicalUrl(url) ?? url;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// 履歴と同じURLの全文結果はその位置で置き換え、残りを履歴の直後に差し込む
function mergeFulltext(base: SearchResult[], insertAt: number, ft: FulltextResult[]): SearchResult[] {
  if (ft.length === 0) return base;
  const ftByUrl = new Map(ft.map(r => [urlKey(r.hit.url), r] as const));
  const placed = new Set<string>();
  const out: SearchResult[] = [];
  let insertPos = insertAt;
  base.forEach((r, i) => {
    if (r.type === 'history') {
      const key = urlKey(r.entry.url);
      const hit = ftByUrl.get(key);
      if (hit) {
        if (!placed.has(key)) {
          placed.add(key);
          out.push(hit);
        } else if (i < insertAt) {
          insertPos--;
        }
        return;
      }
    }
    out.push(r);
  });
  const rest = ft.filter(r => !placed.has(urlKey(r.hit.url)));
  out.splice(insertPos, 0, ...rest);
  return out;
}

interface Props {
  onClose: () => void;
}

export function SearchModal({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeSite, setActiveSite] = useState<SiteConfig | null>(null);
  const [activeMode, setActiveMode] = useState<'site' | 'history' | 'dict' | 'fulltext' | null>(null);
  const [ftState, setFtState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; error?: string }>({ status: 'idle' });
  const [ftStats, setFtStats] = useState<FulltextStats | null>(null);
  const [preview, setPreview] = useState<{ result: FulltextResult; highlightTerms: string[] } | null>(null);
  const [bookmarkShortcuts, setBookmarkShortcuts] = useState<Record<string, string>>({});
  const [dictEntry, setDictEntry] = useState<{ entry: DictionaryEntry; dict: Dictionary } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
  const inputRef = useRef<HTMLInputElement>(null);
  const latestResultsRef = useRef<SearchResult[]>([]);
  const queryIdRef = useRef(0);
  const selectedIndexRef = useRef(0);
  // キーボードで選択を動かしたか（動かしていなければ差し込み後も先頭を選ぶ）
  const userMovedRef = useRef(false);
  const ftTimerRef = useRef<number | null>(null);
  const ftMixRef = useRef<FulltextMix | null>(null);
  const ftStatsRequestedRef = useRef(false);

  useEffect(() => {
    Promise.all([storage.getSites(), storage.getDictionaries(), storage.getSettings()]).then(
      ([s, d, cfg]) => {
        setSites(s);
        setDicts(d);
        setSettings(cfg);
        setTheme(cfg.theme || 'dark');
      }
    );
    storage.getBookmarkShortcuts().then(setBookmarkShortcuts);
    inputRef.current?.focus();
    return () => {
      if (ftTimerRef.current !== null) window.clearTimeout(ftTimerRef.current);
    };
  }, []);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // 全文モードの空入力ヒント用。開いている間に1回だけ取る
  const loadFtStats = useCallback(() => {
    if (ftStatsRequestedRef.current) return;
    ftStatsRequestedRef.current = true;
    ftRequest({ action: 'FT_STATS' })
      .then(stats => { if (stats) setFtStats(stats); })
      .catch((err: unknown) => console.warn('[OmniSearch] 全文検索の統計を取得できません', err));
  }, []);

  // デバウンスしてから FT_SEARCH。新しい入力が来たら null を返す（古い応答は捨てる）
  const searchFulltext = useCallback((ftQ: string, limit: number, myId: number, fuzzy = true) => {
    return new Promise<FulltextResult[] | null>((resolve, reject) => {
      ftTimerRef.current = window.setTimeout(() => {
        ftTimerRef.current = null;
        if (myId !== queryIdRef.current) return resolve(null);
        ftRequest({ action: 'FT_SEARCH', query: ftQ, limit, fuzzy })
          .then(res => {
            if (myId !== queryIdRef.current) return resolve(null);
            if (!res) return reject(new Error('全文検索エンジンから応答がありません'));
            resolve(res.hits.map((hit: FulltextHit) => ({ type: 'fulltext' as const, hit, terms: res.terms })));
          })
          .catch(reject);
      }, FT_DEBOUNCE_MS);
    });
  }, []);

  const handleQuery = useCallback(async (q: string) => {
    const myId = ++queryIdRef.current;
    setQuery(q);
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
    userMovedRef.current = false;
    if (ftTimerRef.current !== null) {
      window.clearTimeout(ftTimerRef.current);
      ftTimerRef.current = null;
    }
    ftMixRef.current = null;

    if (!q.trim()) {
      latestResultsRef.current = [];
      setResults([]);
      setActiveSite(null);
      setActiveMode(null);
      setFtState({ status: 'idle' });
      return;
    }

    const newResults: SearchResult[] = [];
    const histPrefix = settings.historyShortcut + ' ';
    const dictPrefix = settings.dictShortcut + ' ';
    const isHistoryOnly = q.startsWith(histPrefix) || q === settings.historyShortcut;
    const isDictOnly = q.startsWith(dictPrefix) || q === settings.dictShortcut;
    const isFulltextOnly = !isHistoryOnly && !isDictOnly && isPrefixed(q, settings.fulltextShortcut);

    // 全文検索専用モード（サイトショートカットより優先）
    if (isFulltextOnly) {
      setActiveSite(null);
      setActiveMode('fulltext');
      latestResultsRef.current = [];
      const ftQ = q.slice(settings.fulltextShortcut.length).trim();
      if (!ftQ) {
        setResults([]);
        setFtState({ status: 'idle' });
        loadFtStats();
        return;
      }
      // 他モードの結果は消し、直前の全文結果は新しい応答が来るまで残す（ちらつき防止）
      setResults(prev => (prev.every(r => r.type === 'fulltext') ? prev : []));
      setFtState({ status: 'loading' });
      searchFulltext(ftQ, settings.maxFulltextResults, myId)
        .then(items => {
          if (!items) return;
          latestResultsRef.current = items;
          setResults(items);
          setFtState({ status: 'done' });
        })
        .catch((err: unknown) => {
          if (myId !== queryIdRef.current) return;
          console.warn('[OmniSearch] 全文検索に失敗', err);
          latestResultsRef.current = [];
          setResults([]);
          setFtState({ status: 'error', error: errorMessage(err) });
        });
      return;
    }
    setFtState({ status: 'idle' });

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

    // 通常検索に全文検索の上位を混ぜる。既存の結果は待たずに出し、全文結果は届き次第差し込む
    if (settings.fulltextInDefault && !isHistoryOnly && !isDictOnly && !siteMatch && q.trim().length >= 2) {
      const mix: FulltextMix = { id: myId, insertAt: -1, base: null, ft: null };
      ftMixRef.current = mix;
      searchFulltext(q.trim(), FT_MIX_LIMIT, myId, false)
        .then(items => {
          if (!items || ftMixRef.current !== mix) return;
          // 通常検索ではあいまい一致はノイズになりやすいので混ぜない
          mix.ft = items.filter(r => !r.hit.fuzzy).slice(0, FT_MIX_LIMIT);
          if (!mix.base) return;
          const prevSelected = latestResultsRef.current[selectedIndexRef.current];
          const merged = mergeFulltext(mix.base, mix.insertAt, mix.ft);
          latestResultsRef.current = merged;
          setResults(merged);
          // キーボードで選んでいた場合は、差し込みで選択中の項目がずれないよう同じ項目を選び直す
          if (prevSelected && userMovedRef.current) {
            let idx = merged.indexOf(prevSelected);
            if (idx < 0 && prevSelected.type === 'history') {
              const key = urlKey(prevSelected.entry.url);
              idx = merged.findIndex(r => r.type === 'fulltext' && urlKey(r.hit.url) === key);
            }
            if (idx >= 0 && idx !== selectedIndexRef.current) {
              // 次の描画を待たずに ref も更新し、直後の Enter が古い番号で新しい一覧を引かないようにする
              selectedIndexRef.current = idx;
              setSelectedIndex(idx);
            }
          }
        })
        .catch((err: unknown) => console.warn('[OmniSearch] 全文検索に失敗', err));
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
    if (ftMixRef.current?.id === myId) ftMixRef.current.insertAt = newResults.length;

    // ブックマーク検索（履歴専用・辞書専用モード以外かつサイトマッチなし）
    if (!isHistoryOnly && !isDictOnly && !siteMatch && q.trim()) {
      try {
        const bmResults = await chrome.runtime.sendMessage({
          action: 'SEARCH_BOOKMARKS',
          query: q.trim(),
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
      const dictQ = q.trim();
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

    const mix = ftMixRef.current;
    let finalResults = newResults;
    if (mix?.id === myId) {
      mix.base = newResults;
      if (mix.ft) finalResults = mergeFulltext(newResults, mix.insertAt, mix.ft);
    }
    latestResultsRef.current = finalResults;
    setResults(finalResults);
  }, [sites, dicts, settings, bookmarkShortcuts, loadFtStats, searchFulltext]);

  const open = useCallback((result: SearchResult, target: OpenTarget) => {
    if (result.type === 'dictionary') {
      setDictEntry({ entry: result.entry, dict: result.dictionary });
      return;
    }

    if (result.type === 'fulltext') {
      const url = result.hit.url;
      // 一致箇所へのスクロールは background 側が遷移先へ引き継ぐ。失敗したら普通に開く
      const fallback = () => chrome.runtime.sendMessage({ action: 'OPEN_URL', url, target });
      ftRequest({ action: 'FT_OPEN', url, terms: result.terms, target, fuzzy: result.hit.fuzzy })
        .then(res => { if (!res?.ok) fallback(); })
        .catch((err: unknown) => {
          console.warn('[OmniSearch] FT_OPEN に失敗したため通常の方法で開きます', err);
          fallback();
        });
      onClose();
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

  // 現在のクエリからショートカットプレフィックスを除いた純粋なクエリを返す
  const extractBareQuery = useCallback((q: string): string => {
    const histPrefix = settings.historyShortcut + ' ';
    if (q.startsWith(histPrefix)) return q.slice(histPrefix.length);
    if (q === settings.historyShortcut) return '';

    const dictPrefix = settings.dictShortcut + ' ';
    if (q.startsWith(dictPrefix)) return q.slice(dictPrefix.length);
    if (q === settings.dictShortcut) return '';

    if (isPrefixed(q, settings.fulltextShortcut)) return q.slice(settings.fulltextShortcut.length + 1);

    for (const site of sites) {
      const sitePrefix = site.shortcut + ' ';
      if (q.toLowerCase().startsWith(sitePrefix.toLowerCase())) return q.slice(sitePrefix.length);
      if (q.toLowerCase() === site.shortcut.toLowerCase()) return '';
    }

    return q;
  }, [settings.historyShortcut, settings.dictShortcut, settings.fulltextShortcut, sites]);

  const openPreview = useCallback((result: FulltextResult) => {
    // 正規化前の入力語も強調に使う（プレビュー側は単純な部分一致のため）
    const rawWords = extractBareQuery(query).split(/[\s\u3000]+/);
    const highlightTerms = [...new Set([...result.terms, ...rawWords])]
      .filter(t => t && !t.startsWith('-'));
    setPreview({ result, highlightTerms });
  }, [extractBareQuery, query]);

  const closePreview = useCallback(() => {
    setPreview(null);
    inputRef.current?.focus();
  }, []);

  const openFromPreview = useCallback((target: OpenTarget) => {
    if (preview) open(preview.result, target);
  }, [preview, open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
      onClose();
      return;
    }

    if (e.key === 'Escape') {
      if (preview) {
        closePreview();
        return;
      }
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
      } else if (settings.fulltextShortcut && pressed === settings.fulltextShortcut.toLowerCase()) {
        targetPrefix = settings.fulltextShortcut;
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
      userMovedRef.current = true;
      const max = latestResultsRef.current.length - 1;
      const next = max < 0 ? 0 : Math.min(selectedIndexRef.current + 1, max);
      selectedIndexRef.current = next;
      setSelectedIndex(next);
      return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      userMovedRef.current = true;
      const prev = Math.max(selectedIndexRef.current - 1, 0);
      selectedIndexRef.current = prev;
      setSelectedIndex(prev);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // refを参照することでasync処理中でも最新クエリの結果を使う
      const result = latestResultsRef.current[selectedIndexRef.current] ?? results[selectedIndex];
      if (!result) return;

      // Alt+Enter: 全文結果は保存済みテキストのプレビュー
      if (e.altKey && result.type === 'fulltext') {
        openPreview(result);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        open(result, 'tab');
      } else if (e.shiftKey) {
        open(result, 'window');
      } else {
        open(result, 'current');
      }
    }
  }, [results, selectedIndex, open, onClose, dictEntry, preview, closePreview, openPreview, settings, sites, query, extractBareQuery, handleQuery]);

  // 全文モードで結果が無いときの1行表示
  let ftNotice: string | null = null;
  if (activeMode === 'fulltext' && results.length === 0) {
    const bare = query.slice(settings.fulltextShortcut.length).trim();
    if (!bare) {
      ftNotice = ftStats ? `本文を検索（保存済み ${ftStats.pages.toLocaleString()} ページ）` : '本文を検索';
      if (!settings.fulltextEnabled) ftNotice += ' · 本文の保存は停止中';
    } else if (ftState.status === 'done') {
      ftNotice = '保存済みページに一致なし';
    } else if (ftState.status === 'error') {
      ftNotice = `全文検索を利用できません（${ftState.error ?? '不明なエラー'}）`;
    }
  }

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
            ) : activeMode === 'fulltext' ? (
              <span className="text-sm font-semibold whitespace-nowrap flex-shrink-0" style={{ color: 'var(--os-fulltext, #f59e0b)' }}>
                全文
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
              placeholder="サイト・履歴・辞書・本文を検索..."
              className="flex-1 bg-transparent outline-none text-base"
              style={{ color: 'var(--os-text)' }}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => { handleQuery(''); inputRef.current?.focus(); }}
                className="leading-none flex items-center"
                style={{ color: 'var(--os-text-secondary)' }}
              >
                <IconClose size={18} />
              </button>
            )}
          </div>

          {/* results */}
          {ftNotice && (
            <div className="px-4 py-2.5 text-sm" style={{ borderTop: '1px solid var(--os-border)', color: 'var(--os-text-secondary)' }}>
              {ftNotice}
            </div>
          )}
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
          <div className="px-4 py-1.5 flex gap-3 text-xs" style={{ borderTop: '1px solid var(--os-border)', color: 'var(--os-text-secondary)' }}>
            <span><kbd>↑↓</kbd> 選択</span>
            <span><kbd>Enter</kbd> 開く</span>
            <span><kbd>Ctrl+Enter</kbd> 新Tab</span>
            {activeMode === 'fulltext' && <span><kbd>Alt+Enter</kbd> 保存版</span>}
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

      {preview && (
        <div
          data-theme={theme}
          onKeyDown={e => e.stopPropagation()}
          onKeyUp={e => e.stopPropagation()}
          onKeyPress={e => e.stopPropagation()}
        >
          <FulltextPreviewModal
            hit={preview.result.hit}
            highlightTerms={preview.highlightTerms}
            onOpen={openFromPreview}
            onClose={closePreview}
          />
        </div>
      )}
    </>
  );
}
