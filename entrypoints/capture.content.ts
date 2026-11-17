import { ftRequest } from '../lib/fulltext/client';
import { locateInDom } from '../lib/fulltext/locate';
import { normalize } from '../lib/fulltext/normalize';
import { canonicalUrl } from '../lib/fulltext/url';
import type { FtPush } from '../lib/fulltext/protocol';
import type { Readability as ReadabilityParser } from '@mozilla/readability';

const MAX_BODY = 200_000;
const BLOCKS = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|DT|DD|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;

// textContent 相当の文字を集め、段落境界は改行として残す。
function bodyText(root: Node): string {
  const parts: string[] = [];
  let size = 0;
  const add = (text: string) => {
    const part = text.slice(0, MAX_BODY - size);
    parts.push(part); size += part.length;
  };
  const walk = (node: Node) => {
    if (size >= MAX_BODY) return;
    if (node.nodeType === Node.TEXT_NODE) { add(node.textContent ?? ''); return; }
    if (node instanceof Element) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/.test(node.tagName) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return;
      if (node.tagName === 'BR') { add('\n'); return; }
      if (BLOCKS.test(node.tagName)) add('\n\n');
    }
    for (const child of node.childNodes) walk(child);
    if (node instanceof Element && BLOCKS.test(node.tagName)) add('\n\n');
  };
  walk(root);
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    let generation = 0;
    let disposed = false;
    let previousUrl: string | null = null;
    let stopFocus = () => {};
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    async function capture() {
      const run = ++generation;
      const url = canonicalUrl(location.href);
      previousUrl = url;
      const valid = () => !disposed && run === generation && canonicalUrl(location.href) === url;
      const titleOnly = () => ftRequest({ action: 'FT_CAPTURE', page: { title: document.title, body: '' } });
      try {
        const settings = (await chrome.storage.local.get('omnisearch_settings')).omnisearch_settings as { fulltextEnabled?: boolean } | undefined;
        if (settings?.fulltextEnabled === false || !valid()) return;
        const status = await ftRequest({ action: 'FT_PAGE_STATUS' });
        if (!valid() || status.level === 'no_index') return;
        if (document.querySelector('input[type="password"]')) { await titleOnly(); return; }
        if (!status.shouldCapture) return;
        if (status.level === 'url_only') {
          await titleOnly();
          return;
        }
        const started = Date.now();
        let stableSince = started;
        const settling = new MutationObserver(() => { stableSince = Date.now(); });
        if (document.body) settling.observe(document.body, { subtree: true, childList: true, characterData: true });
        try {
          while (valid() && Date.now() - started < 10_000 && Date.now() - stableSince < 1000) await sleep(250);
        } finally { settling.disconnect(); }
        if (!valid()) return;
        await new Promise<void>(resolve => {
          if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
          else setTimeout(resolve, 0);
        });
        if (!valid() || !document.body) return;
        if (document.querySelector('input[type="password"]')) { await titleOnly(); return; }
        let article: ReturnType<ReadabilityParser<string>['parse']> = null;
        let body = '';
        const text = document.body.textContent ?? '';
        const elements = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let count = 0;
        while (count <= 3000 && elements.nextNode()) count++;
        if (count > 3000 || text.length > MAX_BODY) body = text.slice(0, MAX_BODY);
        else {
          const { Readability } = await import('@mozilla/readability');
          if (!valid()) return;
          try {
            article = new Readability<string>(document.cloneNode(true) as Document, { maxElemsToParse: 3000 }).parse();
            if (article?.content) {
              const template = document.createElement('template');
              template.innerHTML = article.content;
              body = bodyText(template.content);
            }
          } catch { /* 抽出できないページは本文のテキストを使う。 */ }
          if (body.length < 200) body = bodyText(document.body);
        }
        if (!valid()) return;
        if (document.querySelector('input[type="password"]')) { await titleOnly(); return; }
        await ftRequest({ action: 'FT_CAPTURE', page: {
          title: article?.title || document.title, siteName: article?.siteName || undefined,
          excerpt: article?.excerpt || undefined, body,
        } });
      } catch { /* ページ遷移や拡張更新で接続が切れた場合は終了する。 */ }
    }

    function focus(rawTerms: string[], fuzzy = false) {
      stopFocus();
      const terms = rawTerms.map(normalize).filter(Boolean);
      if (!terms.length || !document.body) return;
      let observer: MutationObserver | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let expireTimer: ReturnType<typeof setTimeout> | undefined;
      let range: Range | null = null;
      let attempts = 0;
      const clear = () => {
        observer?.disconnect();
        clearTimeout(retryTimer); clearTimeout(expireTimer);
        CSS.highlights?.delete('omnisearch-ft');
        const selection = getSelection();
        if (range && selection?.rangeCount && selection.getRangeAt(0) === range) selection.removeAllRanges();
        document.removeEventListener('click', clear, true);
        document.removeEventListener('keydown', onKey, true);
      };
      const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
      stopFocus = clear;
      const attempt = () => {
        range = locateInDom(document.body, terms, { fuzzy });
        if (++attempts >= 10 && !range) { clear(); return; }
        if (!range) return;
        observer?.disconnect();
        clearTimeout(retryTimer); clearTimeout(expireTimer);
        const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        anchor?.scrollIntoView({ block: 'center' });
        if (CSS.highlights && typeof Highlight !== 'undefined') {
          if (!document.getElementById('omnisearch-ft-style')) {
            const style = document.createElement('style');
            style.id = 'omnisearch-ft-style';
            style.textContent = '::highlight(omnisearch-ft){background:#fde047;color:#111}';
            (document.head ?? document.documentElement).append(style);
          }
          CSS.highlights.set('omnisearch-ft', new Highlight(range));
        }
        const selection = getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
        document.addEventListener('click', clear, true);
        document.addEventListener('keydown', onKey, true);
        expireTimer = setTimeout(clear, 8000);
      };
      attempt();
      if (!range) {
        observer = new MutationObserver(() => {
          if (retryTimer !== undefined) return;
          retryTimer = setTimeout(() => { retryTimer = undefined; attempt(); }, 100);
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        expireTimer = setTimeout(clear, 6000);
      }
    }

    async function takeFocus() {
      try {
        const pending = await ftRequest({ action: 'FT_TAKE_FOCUS' });
        if (pending && !disposed) focus(pending.terms, pending.fuzzy);
      } catch { /* 遷移中は次のcontent scriptに任せる。 */ }
    }

    const handler = (message: FtPush, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
      if (message.action === 'FT_RECAPTURE') {
        void takeFocus();
        if (canonicalUrl(location.href) !== previousUrl) void capture();
      }
      if (message.action === 'FT_FOCUS') {
        focus(message.terms, message.fuzzy);
        sendResponse({ ok: true });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    ctx.onInvalidated(() => {
      disposed = true; generation++; stopFocus();
      chrome.runtime.onMessage.removeListener(handler);
    });
    void takeFocus();
    void capture();
  },
});
