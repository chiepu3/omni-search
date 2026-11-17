import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FtRequest } from './protocol';

const mocks = vi.hoisted(() => ({ init: vi.fn(), install: vi.fn(), engine: vi.fn(), importStream: vi.fn() }));
vi.mock('@sqlite.org/sqlite-wasm', () => ({ default: mocks.init }));
vi.mock('./engine', () => ({ FulltextEngine: mocks.engine }));
vi.mock('./fttfImport', () => ({ importFttfStream: mocks.importStream }));
let replies: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;
const request = (id: number, req: FtRequest) => (globalThis.onmessage as (event: unknown) => void)({ data: { id, req } });

beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  replies = vi.fn(); remove = vi.fn(async () => {});
  search = vi.fn((query: string) => ({ hits: [], tookMs: 1, terms: [query] }));
  mocks.engine.mockReset().mockImplementation(() => ({ search, stats: () => ({ pages: 1 }) }));
  mocks.install.mockReset().mockResolvedValue({ OpfsSAHPoolDb: class {} });
  mocks.init.mockReset().mockImplementation(async () => ({ installOpfsSAHPoolVfs: mocks.install }));
  mocks.importStream.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('postMessage', replies);
  vi.stubGlobal('onmessage', undefined);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({
    removeEntry: remove,
    getFileHandle: async () => ({ getFile: async () => ({ stream: () => new ReadableStream() }) }),
  }) }) } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('初期化待ちの古い検索を空で返し、最新のfuzzy=falseだけを実行する', async () => {
  let finish!: (value: unknown) => void;
  mocks.init.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await import('./db.worker');
  request(1, { action: 'FT_SEARCH', query: 'サーバー', limit: 20 });
  await vi.advanceTimersByTimeAsync(0);
  request(2, { action: 'FT_SEARCH', query: '東京都庁', limit: 20, fuzzy: false });
  expect(replies).toHaveBeenCalledWith({ id: 1, result: { hits: [], tookMs: 0, terms: ['サーバー'] } });
  expect(search).not.toHaveBeenCalled();
  finish({ installOpfsSAHPoolVfs: mocks.install });
  await vi.advanceTimersByTimeAsync(1);
  expect(search).toHaveBeenCalledOnce();
  expect(search).toHaveBeenCalledWith('東京都庁', 20, expect.any(Number), false);
  expect(replies).toHaveBeenCalledWith({ id: 2, result: { hits: [], tookMs: 1, terms: ['東京都庁'] } });
});

it('VFSインストールを250ms・500ms空けて再試行し、失敗キャッシュを解除する', async () => {
  mocks.install.mockRejectedValueOnce(new Error('locked')).mockRejectedValueOnce(new Error('still locked'));
  await import('./db.worker');
  request(1, { action: 'FT_STATS' });
  await vi.advanceTimersByTimeAsync(249);
  expect(mocks.install).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.install).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.install).toHaveBeenCalledTimes(3);
  expect(mocks.install).toHaveBeenLastCalledWith({ preserveOnInitFailure: true, forceReinitIfPreviouslyFailed: true });
  expect(replies).toHaveBeenCalledWith({ id: 1, result: { pages: 1 } });
});

it('初期化が失敗し続けたら作り直しを通知し、取り込み一時ファイルも消す', async () => {
  mocks.install.mockRejectedValue(new Error('OPFS unavailable'));
  await import('./db.worker');
  request(1, { action: 'FT_IMPORT_FTTF', fileHandleId: 'failed.json' });
  await vi.advanceTimersByTimeAsync(751);
  expect(remove).toHaveBeenCalledWith('failed.json');
  expect(replies).toHaveBeenCalledWith({ id: 1, error: 'OPFS unavailable', resetOffscreen: true });
});

it('取り込み中に拒否した別ファイルは消し、取り込み中のファイルは残す', async () => {
  await import('./db.worker');
  request(1, { action: 'FT_IMPORT_FTTF', fileHandleId: 'active.json' });
  await vi.advanceTimersByTimeAsync(0);
  request(2, { action: 'FT_IMPORT_FTTF', fileHandleId: 'rejected.json' });
  request(3, { action: 'FT_IMPORT_FTTF', fileHandleId: 'active.json' });
  await vi.advanceTimersByTimeAsync(0);
  expect(remove).toHaveBeenCalledExactlyOnceWith('rejected.json');
  expect(replies).toHaveBeenCalledWith({ id: 2, result: { ok: false, error: '取り込み中です' } });
  expect(replies).toHaveBeenCalledWith({ id: 3, result: { ok: false, error: '取り込み中です' } });
});
