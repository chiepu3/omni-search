import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: unknown) => Promise<any> | undefined;
let updated: (id: number, info: { url?: string }) => void;
let removed: (id: number) => void;
let session: Record<string, unknown>;
let api: any;
const sender = (url = 'https://example.com/', extra = {}) => ({
  id: 'test-extension', frameId: 0, tab: { id: 7, url, ...extra },
});

async function start() {
  vi.resetModules();
  const { default: background } = await import('../../entrypoints/background');
  (background as unknown as () => void)();
}

beforeEach(async () => {
  session = {};
  const addListener = vi.fn();
  api = {
    runtime: {
      id: 'test-extension', ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      getContexts: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ pages: 3 })),
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
      openOptionsPage: vi.fn(),
    },
    offscreen: { Reason: { WORKERS: 'WORKERS' }, createDocument: vi.fn(async () => {}), closeDocument: vi.fn(async () => {}) },
    commands: { onCommand: { addListener } },
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: 'https://example.com/' }]),
      create: vi.fn(async () => ({ id: 8 })), update: vi.fn(async () => ({})),
      sendMessage: vi.fn(async () => ({})),
      onUpdated: { addListener: (fn: typeof updated) => { updated = fn; } },
      onRemoved: { addListener: (fn: typeof removed) => { removed = fn; } },
    },
    windows: { create: vi.fn(async () => ({ tabs: [{ id: 9 }] })) },
    storage: {
      local: { get: vi.fn(async () => ({})) },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(session, structuredClone(items)); }),
        remove: vi.fn(async (key: string) => { delete session[key]; }),
      },
    },
    history: { search: vi.fn(async () => [{ id: '1', url: 'https://example.com/', title: '既存の履歴' }]) },
  };
  vi.stubGlobal('chrome', api);
  vi.stubGlobal('browser', api);
  vi.stubGlobal('defineBackground', (fn: () => void) => fn);
  await start();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('同時要求はoffscreenを一度だけ作成し、タブ情報とともに中継する', async () => {
  let finish!: () => void;
  api.offscreen.createDocument.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = listener({ action: 'FT_STATS' }, sender());
  const second = listener({ action: 'FT_SEARCH', query: '東京', limit: 20 }, sender());
  await vi.waitFor(() => expect(api.offscreen.createDocument).toHaveBeenCalledTimes(1));
  finish();
  await Promise.all([first, second]);
  expect(api.runtime.getContexts).toHaveBeenCalledTimes(1);
  expect(api.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ url: 'offscreen.html', reasons: ['WORKERS'] }));
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    target: 'ft-offscreen', req: { action: 'FT_SEARCH', query: '東京', limit: 20 }, tabUrl: 'https://example.com/', tabId: 7,
  });
  expect(listener({ target: 'ft-offscreen', action: 'FT_STATS' }, sender())).toBeUndefined();
});

it('存在するoffscreenを再利用し、Workerエラーを呼び出し元に返す', async () => {
  api.runtime.getContexts.mockResolvedValue([{}]);
  api.runtime.sendMessage.mockResolvedValue({ ftError: 'DB initialization failed' });
  await expect(listener({ action: 'FT_STATS' }, sender())).rejects.toThrow('DB initialization failed');
  expect(api.offscreen.createDocument).not.toHaveBeenCalled();
});

it('取り込みの進捗エラーやルールの入力エラーはプロトコルの応答として返す', async () => {
  const status = { running: false, done: 200, total: null, imported: 200, skipped: 0, error: '不正なJSONです' };
  api.runtime.sendMessage.mockResolvedValue(status);
  expect(await listener({ action: 'FT_IMPORT_STATUS' }, sender())).toEqual(status);
  api.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'ルールが不正です' });
  expect(await listener({ action: 'FT_ADD_RULE', pattern: '', level: 'no_index' }, sender())).toEqual({ ok: false, error: 'ルールが不正です' });
});

it('incognito、拡張ページ、iframe、無効設定では保存しないが検索は許可する', async () => {
  for (const source of [sender('https://example.com/', { incognito: true }), sender('chrome://settings'), { ...sender(), frameId: 2 }]) {
    expect(await listener({ action: 'FT_PAGE_STATUS' }, source)).toEqual({ shouldCapture: false, level: 'no_index' });
    expect(await listener({ action: 'FT_CAPTURE', page: { body: '', title: '' } }, source)).toEqual({ ok: false });
  }
  api.storage.local.get.mockResolvedValue({ omnisearch_settings: { fulltextEnabled: false } });
  expect(await listener({ action: 'FT_PAGE_STATUS' }, sender())).toMatchObject({ shouldCapture: false });
  expect(api.offscreen.createDocument).not.toHaveBeenCalled();
  await listener({ action: 'FT_SEARCH', query: '東京', limit: 20 }, sender());
  expect(api.offscreen.createDocument).toHaveBeenCalledTimes(1);
});

it('同一URLのcurrentは遷移せず、正規化した語で直接フォーカスする', async () => {
  expect(await listener({ action: 'FT_OPEN', url: 'https://example.com/?utm_source=x#part', terms: ['サーバー'], target: 'current' }, sender())).toEqual({ ok: true });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'FT_FOCUS', terms: ['さば'] });
  expect(api.tabs.update).not.toHaveBeenCalled();
});

it('遷移前にsessionへfuzzyも保存し、再起動・リダイレクト後に一度だけ取り出す', async () => {
  api.tabs.update.mockImplementation(async (id: number) => {
    expect(session[`omnisearch_ft_focus_${id}`]).toMatchObject({ terms: ['東京都庁'], fuzzy: true });
    return {};
  });
  await listener({ action: 'FT_OPEN', url: 'https://example.com/article#section', terms: ['東京都庁'], fuzzy: true, target: 'tab' }, sender());
  expect(api.tabs.create).toHaveBeenCalledWith({ url: 'about:blank' });
  await start();
  const source = (url: string) => ({ ...sender(url), tab: { id: 8, url } });
  expect(await listener({ action: 'FT_TAKE_FOCUS' }, source('https://redirect.example.com/article'))).toEqual({ terms: ['東京都庁'], fuzzy: true });
  expect(await listener({ action: 'FT_TAKE_FOCUS' }, source('https://example.com/article'))).toBeNull();
});

it('同じURLへのフォーカス送信がrejectされても再読み込みせず成功を返す', async () => {
  api.tabs.sendMessage.mockRejectedValue(new Error('No response'));
  expect(await listener({ action: 'FT_OPEN', url: 'https://example.com/', terms: ['東京都庁'], fuzzy: true, target: 'current' }, sender())).toEqual({ ok: true });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'FT_FOCUS', terms: ['東京都庁'], fuzzy: true });
  expect(api.tabs.update).not.toHaveBeenCalled();
});

it('初期化失敗ではoffscreenを閉じ、次の要求で作り直す', async () => {
  api.runtime.sendMessage.mockResolvedValueOnce({ ftError: 'OPFS locked', resetOffscreen: true });
  await expect(listener({ action: 'FT_STATS' }, sender())).rejects.toThrow('OPFS locked');
  expect(api.offscreen.closeDocument).toHaveBeenCalledOnce();
  await listener({ action: 'FT_STATS' }, sender());
  expect(api.offscreen.createDocument).toHaveBeenCalledTimes(2);
});

it('offscreenから応答できない初期化失敗でも次の要求で復旧できる', async () => {
  api.runtime.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist'));
  await expect(listener({ action: 'FT_STATS' }, sender())).rejects.toThrow('Receiving end does not exist');
  expect(api.offscreen.closeDocument).toHaveBeenCalledOnce();
  await listener({ action: 'FT_STATS' }, sender());
  expect(api.offscreen.createDocument).toHaveBeenCalledTimes(2);
});

it('並行要求の古い初期化エラーでは作り直したoffscreenを閉じない', async () => {
  let finish!: (value: unknown) => void;
  api.runtime.sendMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = listener({ action: 'FT_STATS' }, sender())!;
  await vi.waitFor(() => expect(api.runtime.sendMessage).toHaveBeenCalledTimes(1));
  api.runtime.sendMessage.mockResolvedValueOnce({ ftError: 'failed', resetOffscreen: true });
  await expect(listener({ action: 'FT_STATS' }, sender())).rejects.toThrow('failed');
  await listener({ action: 'FT_STATS' }, sender());
  const check = expect(old).rejects.toThrow('late failure');
  finish({ ftError: 'late failure', resetOffscreen: true });
  await check;
  expect(api.offscreen.closeDocument).toHaveBeenCalledOnce();
});

it('期限切れフォーカスと閉じたタブの記録を消す', async () => {
  session.omnisearch_ft_focus_7 = { url: 'https://example.com/', terms: ['東京'], expires: 1 };
  expect(await listener({ action: 'FT_TAKE_FOCUS' }, sender())).toBeNull();
  expect(session).toEqual({});
  session.omnisearch_ft_focus_7 = {};
  removed(7);
  await vi.waitFor(() => expect(session).toEqual({}));
});

it('SPAの連続したURL更新を1.5秒でまとめる', async () => {
  vi.useFakeTimers();
  updated(7, { url: 'https://example.com/a' });
  await vi.advanceTimersByTimeAsync(1000);
  updated(7, { url: 'https://example.com/b' });
  await vi.advanceTimersByTimeAsync(1499);
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.tabs.sendMessage).toHaveBeenCalledOnce();
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'FT_RECAPTURE' });
});

it('faviconは拡張内URLから取得し、既存の履歴検索も残す', async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await listener({ action: 'FETCH_FAVICON', domain: 'example.com' }, sender())).toBe('data:image/png;base64,AQID');
  expect(fetchMock).toHaveBeenCalledWith('chrome-extension://test-extension/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=32');
  expect(await listener({ action: 'SEARCH_HISTORY', query: '既存' }, sender())).toEqual([expect.objectContaining({ title: '既存の履歴' })]);
});
