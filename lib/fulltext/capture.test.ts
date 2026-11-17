// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const readability = vi.hoisted(() => ({ parse: vi.fn(), construct: vi.fn() }));
vi.mock('@mozilla/readability', () => ({ Readability: class {
  constructor(...args: unknown[]) { readability.construct(...args); }
  parse = readability.parse;
} }));

let messages: ReturnType<typeof vi.fn>;
let listener: (message: unknown) => void;
let cleanup: () => void;
let enabled: boolean;
let status: { shouldCapture: boolean; level: string };
let pending: { terms: string[]; fuzzy?: boolean } | null;
let response: ReturnType<typeof vi.fn>;
let highlights: Map<string, unknown>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '<main><p>本文です。</p></main>';
  history.replaceState(null, '', '/');
  enabled = true; pending = null;
  status = { shouldCapture: false, level: 'full' };
  highlights = new Map();
  response = vi.fn();
  readability.construct.mockClear();
  readability.parse.mockReset().mockReturnValue({
    title: '抽出したタイトル', content: `<p>${'第一段落の本文です。'.repeat(25)}</p><p>第二段落です。</p>`,
  });
  messages = vi.fn(async (message: { action: string }) => {
    if (message.action === 'FT_TAKE_FOCUS') return pending;
    if (message.action === 'FT_PAGE_STATUS') return status;
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: messages,
      onMessage: { addListener: (fn: (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void) => {
        listener = message => fn(message, {}, response);
      }, removeListener: vi.fn() },
    },
    storage: { local: { get: async () => ({ omnisearch_settings: { fulltextEnabled: enabled } }) } },
  });
  vi.stubGlobal('defineContentScript', (config: unknown) => config);
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => setTimeout(fn, 0));
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', class { constructor(readonly range: Range) {} });
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});

async function start() {
  const { default: config } = await import('../../entrypoints/capture.content');
  (config as unknown as { main(ctx: unknown): void }).main({ onInvalidated: (fn: () => void) => { cleanup = fn; } });
  await vi.advanceTimersByTimeAsync(0);
}

afterEach(() => {
  cleanup?.();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  getSelection()?.removeAllRanges();
});

it('無効設定と保存不要のページではReadabilityを実行しない', async () => {
  enabled = false;
  await start();
  expect(messages.mock.calls.map(([m]) => m.action)).toEqual(['FT_TAKE_FOCUS']);
  enabled = true;
  history.replaceState(null, '', '/new-page');
  listener({ action: 'FT_RECAPTURE' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(messages).toHaveBeenCalledWith({ action: 'FT_PAGE_STATUS' });
  expect(readability.parse).not.toHaveBeenCalled();
  expect(messages.mock.calls.some(([m]) => m.action === 'FT_CAPTURE')).toBe(false);
});

it('url_onlyはタイトルだけを即座に保存する', async () => {
  document.title = 'URLだけのページ';
  status = { shouldCapture: true, level: 'url_only' };
  await start();
  expect(messages).toHaveBeenCalledWith({ action: 'FT_CAPTURE', page: { title: 'URLだけのページ', body: '' } });
  expect(readability.parse).not.toHaveBeenCalled();
});

it('本文が落ち着いてから抽出し、段落の改行を保持する', async () => {
  status = { shouldCapture: true, level: 'full' };
  await start();
  expect(readability.parse).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1100);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
  expect(readability.parse).toHaveBeenCalledOnce();
  expect(readability.construct).toHaveBeenCalledWith(expect.anything(), { maxElemsToParse: 3000 });
  const capture = messages.mock.calls.find(([m]) => m.action === 'FT_CAPTURE')?.[0];
  expect(capture?.page.title).toBe('抽出したタイトル');
  expect(capture?.page.body).toContain('\n\n第二段落です。');
});

it('ノード境界をまたぐ正規化一致にスクロールし、Escでハイライトを消す', async () => {
  document.body.innerHTML = '<p>東京 <b>都庁</b> の見学</p>';
  pending = { terms: ['東京都庁'] };
  await start();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  expect(highlights.has('omnisearch-ft')).toBe(true);
  expect(document.querySelectorAll('#omnisearch-ft-style')).toHaveLength(1);
  expect(getSelection()?.toString()).toBe('東京 都庁');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(highlights.has('omnisearch-ft')).toBe(false);
});

it('遅れて挿入された本文を再試行し、8秒で解除する', async () => {
  pending = { terms: ['東京都庁'] };
  await start();
  expect(highlights.size).toBe(0);
  document.body.innerHTML = '<p>東京都庁</p>';
  await vi.advanceTimersByTimeAsync(250);
  expect(highlights.has('omnisearch-ft')).toBe(true);
  await vi.advanceTimersByTimeAsync(8000);
  expect(highlights.size).toBe(0);
});

it('6秒で再試行を打ち切り、CSS.highlightsがなくても選択する', async () => {
  pending = { terms: ['東京都庁'] };
  await start();
  await vi.advanceTimersByTimeAsync(6100);
  document.body.innerHTML = '<p>東京都庁</p>';
  await vi.advanceTimersByTimeAsync(250);
  expect(highlights.size).toBe(0);
  vi.stubGlobal('CSS', {});
  listener({ action: 'FT_FOCUS', terms: ['東京都庁'] });
  expect(getSelection()?.toString()).toBe('東京都庁');
  expect(response).toHaveBeenCalledWith({ ok: true });
});

it('同じ正規化URLへの再通知を無視し、ハッシュルートの変更は保存判定する', async () => {
  await start();
  for (const suffix of ['?utm_source=x#section', '#anchor', '?utm_campaign=x']) {
    history.replaceState(null, '', '/' + suffix);
    listener({ action: 'FT_RECAPTURE' });
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(messages.mock.calls.filter(([m]) => m.action === 'FT_PAGE_STATUS')).toHaveLength(1);
  history.replaceState(null, '', '/#/next');
  listener({ action: 'FT_RECAPTURE' });
  await vi.advanceTimersByTimeAsync(0);
  expect(messages.mock.calls.filter(([m]) => m.action === 'FT_PAGE_STATUS')).toHaveLength(2);
});

it('落ち着き待ち中のアンカー変更で本文保存を中断しない', async () => {
  status = { shouldCapture: true, level: 'full' };
  const innerText = vi.spyOn(document.body, 'innerText', 'get').mockImplementation(() => { throw new Error('layout'); });
  const computed = vi.spyOn(window, 'getComputedStyle');
  await start();
  history.replaceState(null, '', '/#anchor');
  listener({ action: 'FT_RECAPTURE' });
  await vi.advanceTimersByTimeAsync(1100);
  await vi.dynamicImportSettled();
  expect(messages.mock.calls.filter(([m]) => m.action === 'FT_PAGE_STATUS')).toHaveLength(1);
  expect(messages.mock.calls.filter(([m]) => m.action === 'FT_CAPTURE')).toHaveLength(1);
  expect(innerText).not.toHaveBeenCalled();
  expect(computed).not.toHaveBeenCalled();
});

it('パスワード入力ページは本文を送らない', async () => {
  status = { shouldCapture: true, level: 'full' };
  document.body.innerHTML = '<p>秘密の本文</p><input type="password">';
  await start();
  expect(readability.parse).not.toHaveBeenCalled();
  expect(messages).toHaveBeenCalledWith({ action: 'FT_CAPTURE', page: { title: document.title, body: '' } });
});

it.each(['text', 'elements'])('巨大ページはReadabilityを使わない: %s', async kind => {
  status = { shouldCapture: true, level: 'full' };
  document.body.innerHTML = kind === 'text' ? `<p>${'東'.repeat(200001)}</p>` : '<span>東京</span>'.repeat(3001);
  await start();
  await vi.advanceTimersByTimeAsync(1100);
  expect(readability.parse).not.toHaveBeenCalled();
  const capture = messages.mock.calls.find(([m]) => m.action === 'FT_CAPTURE')?.[0];
  expect(capture?.page.body.length).toBeGreaterThan(0);
  expect(capture?.page.body.length).toBeLessThanOrEqual(200000);
});

it('曖昧フォーカスで近い語を選択する', async () => {
  document.body.innerHTML = '<p>東京都長見学</p>';
  pending = { terms: ['東京都庁見学'], fuzzy: true };
  await start();
  expect(highlights.has('omnisearch-ft')).toBe(true);
  expect(getSelection()?.toString()).toContain('東京');
});

it('フォーカスは属性変更では再試行せず、本文が変わっても最大10回', async () => {
  const locate = await import('./locate');
  const find = vi.spyOn(locate, 'locateInDom').mockReturnValue(null);
  pending = { terms: ['東京都庁'] };
  await start();
  document.body.setAttribute('data-state', 'updated');
  await vi.advanceTimersByTimeAsync(200);
  expect(find).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++) {
    document.body.textContent = String(i);
    await vi.advanceTimersByTimeAsync(200);
  }
  expect(find).toHaveBeenCalledTimes(10);
});
