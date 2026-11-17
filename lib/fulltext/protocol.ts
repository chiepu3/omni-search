// 全文ページ検索のメッセージ定義（content script / options ⇔ background ⇔ offscreen ⇔ worker で共有）

export type IndexLevel = 'full' | 'url_only' | 'no_index';

export interface CapturedPage {
  title: string;
  siteName?: string;
  excerpt?: string;
  body: string; // url_only の場合は空文字
  publishedAt?: number;
}

export interface SnippetPart {
  before: string;
  match: string;
  after: string;
}

export interface FulltextHit {
  id: number;
  url: string;
  title: string;
  siteName?: string;
  lastVisit: number;
  visitCount: number;
  fuzzy: boolean; // 曖昧一致（フォールバック）由来か
  snippet: SnippetPart | null; // 本文中の一致箇所（タイトル/URLのみ一致なら null）
}

export interface FulltextStats {
  pages: number;
  fullPages: number;
  dbBytes: number;
  oldest: number | null;
  newest: number | null;
}

export interface ExcludeRule {
  id: number;
  pattern: string; // `%` をワイルドカードとする前方一致パターン（FTTF互換）
  level: Exclude<IndexLevel, 'full'>;
}

// content script / options → background
export type FtRequest =
  | { action: 'FT_PAGE_STATUS' } // sender.tab.url を使う
  | { action: 'FT_CAPTURE'; page: CapturedPage }
  | { action: 'FT_SEARCH'; query: string; limit: number }
  | { action: 'FT_GET_PAGE'; id: number } // プレビュー用
  | { action: 'FT_OPEN'; url: string; terms: string[]; target: 'current' | 'tab' | 'window' }
  | { action: 'FT_TAKE_FOCUS' } // 遷移先ページが読み込み後に問い合わせる
  | { action: 'FT_STATS' }
  | { action: 'FT_LIST_RULES' }
  | { action: 'FT_ADD_RULE'; pattern: string; level: ExcludeRule['level'] }
  | { action: 'FT_REMOVE_RULE'; id: number }
  | { action: 'FT_DELETE_PAGES'; urlPattern: string } // `%` ワイルドカード、'%' で全削除
  | { action: 'FT_IMPORT_FTTF'; fileHandleId: string } // options が OPFS 一時ファイルへ書いた名前
  | { action: 'FT_IMPORT_STATUS' };

export type FtResponse<A extends FtRequest['action']> =
  A extends 'FT_PAGE_STATUS' ? { shouldCapture: boolean; level: IndexLevel } :
  A extends 'FT_CAPTURE' ? { ok: boolean } :
  A extends 'FT_SEARCH' ? { hits: FulltextHit[]; tookMs: number; terms: string[] } :
  A extends 'FT_GET_PAGE' ? { url: string; title: string; body: string; lastVisit: number } | null :
  A extends 'FT_OPEN' ? { ok: boolean } :
  A extends 'FT_TAKE_FOCUS' ? { terms: string[] } | null :
  A extends 'FT_STATS' ? FulltextStats :
  A extends 'FT_LIST_RULES' ? ExcludeRule[] :
  A extends 'FT_ADD_RULE' | 'FT_REMOVE_RULE' ? { ok: boolean; error?: string } :
  A extends 'FT_DELETE_PAGES' ? { deleted: number } :
  A extends 'FT_IMPORT_FTTF' ? { ok: boolean; error?: string } :
  A extends 'FT_IMPORT_STATUS' ? { running: boolean; done: number; total: number | null; imported: number; skipped: number; error?: string } :
  never;

// background → content script
export type FtPush =
  | { action: 'FT_RECAPTURE' } // SPA の URL 変化
  | { action: 'FT_FOCUS'; terms: string[] }; // 同一URLのタブに直接フォーカス指示
