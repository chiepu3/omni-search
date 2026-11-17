import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { FulltextEngine } from './engine';
import { importFttfStream, type ImportProgress } from './fttfImport';
import type { FtRequest } from './protocol';
import { parseQuery } from './query';

export interface WorkerRequest { id: number; req: FtRequest; tabUrl?: string; tabId?: number }

let initializationFailed = false;
const ready = (async () => {
  const sqlite = await sqlite3InitModule();
  for (let attempt = 0; ; attempt++) {
    try {
      // 失敗したPromiseをsqlite側がキャッシュするため、再試行時は解除する。
      const options = { preserveOnInitFailure: true, forceReinitIfPreviouslyFailed: attempt > 0 };
      const pool = await sqlite.installOpfsSAHPoolVfs(options);
      return new FulltextEngine(new pool.OpfsSAHPoolDb('/omnisearch.sqlite3'));
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
})().catch(error => { initializationFailed = true; throw error; });
// 初期化エラーは要求ごとの応答で通知する。
void ready.catch(() => {});

let progress: ImportProgress = { running: false, done: 0, total: null, imported: 0, skipped: 0 };
let activeImport: string | undefined;
const validImportName = (name: string) => !!name && !/[/\\]/.test(name) && !['.', '..'].includes(name);

async function discardImport(name: string) {
  if (!validImportName(name) || name === activeImport) return;
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ft-import');
    await dir.removeEntry(name);
  } catch { /* ファイル未作成・削除済みなら後始末は不要。 */ }
}

async function runImport(engine: FulltextEngine, name: string) {
  let dir: FileSystemDirectoryHandle | undefined;
  try {
    dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ft-import');
    const file = await (await dir.getFileHandle(name)).getFile();
    await importFttfStream(engine, file.stream(), progress);
  } catch (error) {
    progress.error = String(error instanceof Error ? error.message : error);
  } finally {
    if (dir) {
      try { await dir.removeEntry(name); }
      catch (error) { progress.error ??= `一時ファイルを削除できません: ${String(error)}`; }
    }
    progress.running = false;
    activeImport = undefined;
  }
}

async function handle({ req, tabUrl }: WorkerRequest) {
  const engine = await ready;
  switch (req.action) {
    case 'FT_PAGE_STATUS': return engine.pageStatus(tabUrl ?? '');
    case 'FT_CAPTURE': return engine.capture(tabUrl ?? '', req.page);
    case 'FT_SEARCH': return engine.search(req.query, req.limit, Date.now(), req.fuzzy);
    case 'FT_GET_PAGE': return engine.getPage(req.id);
    case 'FT_STATS': return engine.stats();
    case 'FT_LIST_RULES': return engine.listRules();
    case 'FT_ADD_RULE': return engine.addRule(req.pattern, req.level);
    case 'FT_REMOVE_RULE': return engine.removeRule(req.id);
    case 'FT_DELETE_PAGES': return engine.deletePages(req.urlPattern);
    case 'FT_IMPORT_STATUS': return { ...progress };
    case 'FT_IMPORT_FTTF': {
      if (progress.running) {
        await discardImport(req.fileHandleId);
        return { ok: false, error: '取り込み中です' };
      }
      if (!validImportName(req.fileHandleId)) return { ok: false, error: 'ファイル名が不正です' };
      progress = { running: true, done: 0, total: null, imported: 0, skipped: 0 };
      activeImport = req.fileHandleId;
      void runImport(engine, req.fileHandleId);
      return { ok: true };
    }
    default: throw new Error('Workerで処理できない要求です');
  }
}

async function respond(request: WorkerRequest) {
  try {
    globalThis.postMessage({ id: request.id, result: await handle(request) });
  } catch (error) {
    if (request.req.action === 'FT_IMPORT_FTTF') await discardImport(request.req.fileHandleId);
    globalThis.postMessage({ id: request.id, error: String(error instanceof Error ? error.message : error), resetOffscreen: initializationFailed });
  }
}

let queuedSearch: WorkerRequest | undefined;
let searchScheduled = false;
function scheduleSearch() {
  if (searchScheduled) return;
  searchScheduled = true;
  setTimeout(async () => {
    await ready.catch(() => {});
    const request = queuedSearch;
    queuedSearch = undefined;
    if (request) await respond(request);
    searchScheduled = false;
    if (queuedSearch) scheduleSearch();
  }, 0);
}

globalThis.onmessage = ({ data: request }: MessageEvent<WorkerRequest>) => {
  if (request.req.action !== 'FT_SEARCH') { void respond(request); return; }
  if (queuedSearch?.req.action === 'FT_SEARCH') globalThis.postMessage({
    id: queuedSearch.id, result: { hits: [], tookMs: 0, terms: parseQuery(queuedSearch.req.query).terms },
  });
  queuedSearch = request;
  scheduleSearch();
};
