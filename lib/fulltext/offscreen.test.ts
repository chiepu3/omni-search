import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: unknown, response: (result: unknown) => void) => boolean | undefined;
let worker: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage?: (e: unknown) => void; onerror?: (e: unknown) => void };
const send = (query: string) => {
  const response = vi.fn();
  listener({ target: 'ft-offscreen', req: { action: 'FT_SEARCH', query, limit: 20 } }, { id: 'extension' }, response);
  return response;
};

beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules();
  worker = { postMessage: vi.fn(), terminate: vi.fn() };
  vi.stubGlobal('Worker', vi.fn(() => worker));
  vi.stubGlobal('chrome', { runtime: { id: 'extension', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  await import('../../entrypoints/offscreen/main');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('待ち行列の検索をまとめ、実行中の検索の後には最新だけ送る', async () => {
  const first = send('サーバー');
  const second = send('東京');
  expect(first).toHaveBeenCalledWith({ hits: [], tookMs: 0, terms: ['サーバー'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.postMessage).toHaveBeenCalledOnce();
  const third = send('大阪');
  const fourth = send('京都');
  expect(third).toHaveBeenCalledWith({ hits: [], tookMs: 0, terms: ['大阪'] });
  expect(worker.postMessage).toHaveBeenCalledOnce();
  worker.onmessage?.({ data: { id: 2, result: { hits: [], tookMs: 1, terms: ['東京'] } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(second).toHaveBeenCalledWith({ hits: [], tookMs: 1, terms: ['東京'] });
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, req: { action: 'FT_SEARCH', query: '京都', limit: 20 } }));
  worker.onmessage?.({ data: { id: 4, result: { hits: [], tookMs: 1, terms: ['京都'] } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fourth).toHaveBeenCalledOnce();
});

it('初期化失敗は実行中・待機中の両方へ通知し、Workerを終了する', async () => {
  const first = send('東京');
  await vi.advanceTimersByTimeAsync(0);
  const second = send('大阪');
  worker.onmessage?.({ data: { id: 1, error: 'initialization failed', resetOffscreen: true } });
  await vi.advanceTimersByTimeAsync(0);
  for (const response of [first, second]) expect(response).toHaveBeenCalledWith({ ftError: 'initialization failed', resetOffscreen: true });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.postMessage).toHaveBeenCalledOnce();
});
