import type { WorkerRequest } from '../../lib/fulltext/db.worker';
import { parseQuery } from '../../lib/fulltext/query';

const worker = new Worker(new URL('../../lib/fulltext/db.worker.ts', import.meta.url), { type: 'module' });
let nextId = 0;
let failure: string | undefined;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let searching = false;
let queuedSearch: { request: WorkerRequest; sendResponse: (response: unknown) => void } | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let activeSearchId: number | undefined;

function dispatch(request: WorkerRequest, sendResponse: (response: unknown) => void) {
  void new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    worker.postMessage(request);
  }).then(sendResponse, error => sendResponse({ ftError: String(error.message), resetOffscreen: failure !== undefined }));
}

function scheduleSearch() {
  if (searching || searchTimer !== undefined || !queuedSearch) return;
  searchTimer = setTimeout(() => {
    searchTimer = undefined;
    if (!queuedSearch) return;
    const { request, sendResponse } = queuedSearch;
    queuedSearch = undefined;
    searching = true; activeSearchId = request.id;
    dispatch(request, sendResponse);
  }, 0);
}

worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string; resetOffscreen?: boolean }>) => {
  const request = pending.get(data.id);
  if (!request) return;
  if (data.resetOffscreen) { fail(data.error || '全文検索Workerの初期化に失敗しました'); return; }
  pending.delete(data.id);
  if (data.error) request.reject(new Error(data.error));
  else request.resolve(data.result);
  if (data.id === activeSearchId) { searching = false; activeSearchId = undefined; scheduleSearch(); }
};
function fail(message: string) {
  failure = message;
  clearTimeout(searchTimer); searchTimer = undefined;
  for (const request of pending.values()) request.reject(new Error(failure));
  pending.clear();
  if (queuedSearch) queuedSearch.sendResponse({ ftError: failure, resetOffscreen: true });
  queuedSearch = undefined;
  worker.terminate();
}
worker.onerror = event => fail(event.message || '全文検索Workerが停止しました');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'ft-offscreen') return;
  if (failure) { sendResponse({ ftError: failure, resetOffscreen: true }); return; }
  const id = ++nextId;
  const request = { id, req: message.req, tabUrl: message.tabUrl, tabId: message.tabId } satisfies WorkerRequest;
  if (request.req.action === 'FT_SEARCH') {
    if (queuedSearch?.request.req.action === 'FT_SEARCH') queuedSearch.sendResponse({
      hits: [], tookMs: 0, terms: parseQuery(queuedSearch.request.req.query).terms,
    });
    queuedSearch = { request, sendResponse };
    scheduleSearch();
  } else dispatch(request, sendResponse);
  return true;
});
