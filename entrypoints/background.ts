import type { FtRequest } from '../lib/fulltext/protocol';
import { canonicalUrl } from '../lib/fulltext/url';
import { normalize } from '../lib/fulltext/normalize';

let creatingOffscreen: Promise<void> | undefined;
let closingOffscreen: Promise<void> | undefined;
let offscreenGeneration = 0;
async function ensureOffscreen() {
  if (closingOffscreen) await closingOffscreen;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const url = chrome.runtime.getURL('/offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url],
    });
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS],
      justification: '閲覧ページをローカルのSQLite Workerで保存・検索する',
    });
  })();
  try { await creatingOffscreen; }
  finally { creatingOffscreen = undefined; }
}

async function resetOffscreen(generation: number) {
  if (generation !== offscreenGeneration) return;
  offscreenGeneration++;
  closingOffscreen = chrome.offscreen.closeDocument().catch(() => {});
  try { await closingOffscreen; }
  finally { closingOffscreen = undefined; }
}

interface PendingFocus { terms: string[]; fuzzy?: boolean; expires: number }
const focusKey = (id: number) => `omnisearch_ft_focus_${id}`;
const takingFocus = new Set<number>();

async function rememberFocus(tabId: number, terms: string[], fuzzy?: boolean) {
  await chrome.storage.session.set({
    [focusKey(tabId)]: { terms, fuzzy, expires: Date.now() + 60_000 } satisfies PendingFocus,
  });
}

async function openFulltext(req: Extract<FtRequest, { action: 'FT_OPEN' }>, sender: chrome.runtime.MessageSender) {
  const url = canonicalUrl(req.url);
  if (!url) return { ok: false };
  const terms = req.terms.map(normalize).filter(Boolean);
  let tab: chrome.tabs.Tab | undefined;
  if (req.target === 'tab') tab = await chrome.tabs.create({ url: 'about:blank' });
  else if (req.target === 'window') tab = (await chrome.windows.create({ url: 'about:blank' }))?.tabs?.[0];
  else if (req.target === 'current') {
    tab = sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id !== undefined && canonicalUrl(tab.url ?? '') === url) {
      void chrome.tabs.sendMessage(tab.id, { action: 'FT_FOCUS', terms, fuzzy: req.fuzzy }).catch(() => {});
      return { ok: true };
    }
  } else return { ok: false };
  if (tab?.id === undefined) return { ok: false };
  await rememberFocus(tab.id, terms, req.fuzzy);
  try {
    await chrome.tabs.update(tab.id, { url: req.url });
    return { ok: true };
  } catch (error) {
    await chrome.storage.session.remove(focusKey(tab.id));
    throw error;
  }
}

async function handleFulltext(req: FtRequest, sender: chrome.runtime.MessageSender) {
  if (req.action === 'FT_OPEN') return openFulltext(req, sender);
  if (req.action === 'FT_TAKE_FOCUS') {
    if (sender.tab?.id === undefined || sender.frameId !== 0) return null;
    const tabId = sender.tab.id;
    if (takingFocus.has(tabId)) return null;
    takingFocus.add(tabId);
    try {
      const key = focusKey(tabId);
      const pending = (await chrome.storage.session.get(key))[key] as PendingFocus | undefined;
      if (!pending) return null;
      if (pending.expires <= Date.now()) { await chrome.storage.session.remove(key); return null; }
      await chrome.storage.session.remove(key);
      return { terms: pending.terms, fuzzy: pending.fuzzy };
    } finally { takingFocus.delete(tabId); }
  }
  if (req.action === 'FT_PAGE_STATUS' || req.action === 'FT_CAPTURE') {
    const settings = (await chrome.storage.local.get('omnisearch_settings')).omnisearch_settings as { fulltextEnabled?: boolean } | undefined;
    if (settings?.fulltextEnabled === false || sender.tab?.incognito || sender.frameId !== 0 || !canonicalUrl(sender.tab?.url ?? '')) {
      return req.action === 'FT_CAPTURE' ? { ok: false } : { shouldCapture: false, level: 'no_index' };
    }
  }
  await ensureOffscreen();
  const generation = offscreenGeneration;
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      target: 'ft-offscreen', req, tabUrl: sender.tab?.url, tabId: sender.tab?.id,
    });
  } catch (error) {
    await resetOffscreen(generation);
    throw error;
  }
  if (response?.resetOffscreen) await resetOffscreen(generation);
  if (response?.ftError) throw new Error(response.ftError);
  return response;
}

export default defineBackground(() => {
  const recaptures = new Map<number, ReturnType<typeof setTimeout>>();
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    clearTimeout(recaptures.get(tabId));
    recaptures.set(tabId, setTimeout(() => {
      recaptures.delete(tabId);
      void chrome.tabs.sendMessage(tabId, { action: 'FT_RECAPTURE' }).catch(() => {});
    }, 1500));
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    clearTimeout(recaptures.get(tabId));
    recaptures.delete(tabId);
    void chrome.storage.session.remove(focusKey(tabId));
  });
  // キーボードショートカットでコンテンツスクリプトにトグル通知
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-search') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await browser.tabs.sendMessage(tab.id, { action: 'TOGGLE_SEARCH' });
        } catch {
          // content script not loaded yet
        }
      }
    }
  });

  // 履歴検索・URLオープンはバックグラウンドで処理
  browser.runtime.onMessage.addListener((message: Record<string, unknown>, sender) => {
    if (message.target === 'ft-offscreen') return;
    if (typeof message.action === 'string' && message.action.startsWith('FT_')) {
      if (sender.id !== chrome.runtime.id) return;
      return handleFulltext(message as unknown as FtRequest, sender as chrome.runtime.MessageSender);
    }
    if (message.action === 'SEARCH_HISTORY') {
      const query = message.query as string;
      return chrome.history.search({
        text: query,
        maxResults: 100,
        startTime: 0,
      }).then(items =>
        items
          .filter(item => item.url && !item.url.startsWith('data:') && !item.url.startsWith('blob:'))
          .map(item => ({
            id: item.id ?? '',
            url: item.url ?? '',
            title: item.title ?? '',
            lastVisitTime: item.lastVisitTime ?? 0,
            visitCount: item.visitCount ?? 0,
          }))
      );
    }

    if (message.action === 'OPEN_URL') {
      const url = message.url as string;
      const target = message.target as string;
      if (target === 'tab') {
        browser.tabs.create({ url });
      } else if (target === 'window') {
        browser.windows.create({ url });
      } else {
        browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) browser.tabs.update(tab.id, { url });
        });
      }
    }

    if (message.action === 'SEARCH_BOOKMARKS') {
      const query = (message.query as string).toLowerCase();
      const flattenBookmarks = (nodes: chrome.bookmarks.BookmarkTreeNode[]): { id: string; title: string; url: string }[] => {
        const results: { id: string; title: string; url: string }[] = [];
        for (const node of nodes) {
          if (node.url) {
            results.push({ id: node.id, title: node.title || node.url, url: node.url });
          }
          if (node.children) {
            results.push(...flattenBookmarks(node.children));
          }
        }
        return results;
      };
      return chrome.bookmarks.getTree().then(tree => {
        const all = flattenBookmarks(tree);
        if (!query) return all.slice(0, 20);
        return all.filter(b =>
          b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query)
        ).slice(0, 20);
      });
    }

    if (message.action === 'OPEN_OPTIONS') {
      browser.runtime.openOptionsPage();
    }

    if (message.action === 'FETCH_FAVICON') {
      const domain = message.domain as string;
      const url = chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent('https://' + domain) + '&size=32';
      return fetch(url)
        .then(r => r.blob())
        .then(async blob => {
          let binary = '';
          for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
          return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
        })
        .catch(() => null);
    }
  });
});
