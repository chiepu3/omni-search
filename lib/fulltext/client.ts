import type { FtRequest, FtResponse } from './protocol';

// content script / options から background へ全文検索系の要求を送る
export function ftRequest<R extends FtRequest>(req: R): Promise<FtResponse<R['action']>> {
  return chrome.runtime.sendMessage(req) as Promise<FtResponse<R['action']>>;
}

// FTTF のエクスポート JSON を拡張機能の OPFS に書き込み、FT_IMPORT_FTTF に渡す名前を返す。
// options ページと offscreen document は同一オリジンなので、Worker がこのファイルをストリームで読める。
export async function uploadImportFile(file: File): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('ft-import', { create: true });
  const name = `fttf-${Date.now()}.json`;
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await file.stream().pipeTo(writable);
  return name;
}
