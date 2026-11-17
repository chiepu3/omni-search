# 全文ページ検索（Full Text Tabs Forever 相当機能の取り込み）設計

## 目的
- 閲覧したページの本文をローカルに保存し、OmniSearch のランチャー（Alt+Shift+K）から全文検索する。
- 日本語に最適化する。ページ内の「謎の空白」・全角半角・カタカナ/ひらがな・長音の有無・異体字の揺れで検索漏れしない。
- Enter で元ページへ飛び、該当文字列の位置へスクロールしてハイライト＋選択する。
- 外部へのデータ送信をしない（ネットワーク通信は閲覧中のページ自身以外ゼロ）。

FTTF のコードは流用しない（PGlite＋`to_tsvector('simple')` は日本語を単語分割できず、ほぼ検索できないため）。参考にするのは「Readability で本文抽出」「除外ルール（url_only / no_index）」「エクスポートJSON形式」だけ。

## 全体構成

```
[各ページ] content script (capture)  ──FT_CAPTURE──▶  background (SW)  ──relay──▶  offscreen doc ──postMessage──▶  Worker (sqlite-wasm + OPFS)
[各ページ] content script (ランチャー) ──FT_SEARCH───▶  background (SW)  ──relay──▶  offscreen doc ──▶ Worker
[遷移先ページ] content script (focus) ◀── FT_FOCUS ── background（遷移前に tabId ごとに保持）
```

- DB: `@sqlite.org/sqlite-wasm` を **offscreen document 内の専用 Worker** で動かす。VFS は `opfs-sahpool`（COOP/COEP不要）。SW では Worker も OPFS 同期ハンドルも使えないため。
- offscreen document は reason `WORKERS` で1つだけ作る。SW は FT_* メッセージを受けたら `ensureOffscreen()` してから `{target:'ft-offscreen', ...}` で転送する。
- manifest: permissions に `offscreen`, `unlimitedStorage`, `favicon` を追加。CSP `extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`。

## 正規化（lib/fulltext/normalize.ts） — 索引とクエリで同一関数を使う
1. NFKC（全角英数→半角、半角カナ→全角、①→1 等）
2. 小文字化
3. カタカナ→ひらがな（ァ-ヶ, ヽヾ。ヴ→ゔ, ヵヶ→かけ）
4. 長音・波ダッシュ類（ー ｰ 〜 ～ ‐ - 等）は削除（「サーバ」と「サーバー」を同一視）
5. 異体字の小さな対応表（髙→高, 﨑→崎, 德→徳, 邊/邉→辺, 齋/齊→斎/斉, 濵→浜, 澤→沢, 櫻→桜, 國→国 など20〜40字程度）
6. `\p{L}` `\p{N}` 以外（空白・改行・記号・句読点・絵文字）はすべて削除 ← 「謎の空白」対策の本体
- 出力: `normalize(s): string` と、元文字列への位置対応つき `normalizeWithMap(s): { norm: string; map: Int32Array }`（`map[i]` = norm の i 文字目に対応する元文字列の UTF-16 インデックス。末尾用に `map[norm.length]` = 最後の対応文字の直後）
- `toBigramTokens(norm): string` … 長さ1ならその1文字、2以上なら隣接2文字を空白区切りで列挙。

## 索引（Worker 内 SQLite）
```sql
CREATE TABLE pages(
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,        -- hash除去・utm_*除去済み
  title TEXT, site_name TEXT, excerpt TEXT,
  body TEXT,                       -- 抽出した元テキスト（スニペット・フォーカス・プレビュー用、最大 200,000 文字）
  body_hash TEXT,
  level TEXT NOT NULL DEFAULT 'full',  -- 'full' | 'url_only'
  first_seen INTEGER NOT NULL, last_visit INTEGER NOT NULL, visit_count INTEGER NOT NULL DEFAULT 1,
  indexed_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE pages_fts USING fts5(title, url, body, content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 0');
-- rowid = pages.id。各列には toBigramTokens(normalize(...)) を入れる
CREATE TABLE exclude_rules(id INTEGER PRIMARY KEY, pattern TEXT UNIQUE NOT NULL, level TEXT NOT NULL CHECK(level IN ('no_index','url_only')));
```
- 実測（node, 3000件×2,800字）: 挿入 1.2ms/件、フレーズ検索 1〜5ms。

## クエリ（lib/fulltext/query.ts）
- 入力を空白（半角・全角）で分割 → 各語 AND。先頭 `-` の語は NOT。
- 各語を normalize。長さ≥2 → `"ab bc cd"`（bigram のフレーズ＝正規化後の部分文字列一致）。長さ1 → `a*`。正規化後に空になる語は捨てる。
- 正規化で空白を消しているので「東京 都庁」と書かれたページも「東京都庁」で当たる（逆も、クエリ側は AND になるので当たる）。
- 並び: `bm25(pages_fts, 4.0, 2.0, 1.0)` 上位200件を取得 → JS 側で 最近の閲覧を少し加点して再ランク → 上位 N 件。
- 曖昧検索（フォールバック）: 完全一致が5件未満のとき、長さ≥3の語について bigram の OR で候補（bm25上位200件）を取り、JS で「語の bigram の何割が本文の連続窓内に出るか」を計算し、0.6以上を「あいまい一致」として後ろに付ける。
- 目標: 1万ページで p95 < 80ms（ランチャーのキー入力ごとに呼ぶ。呼び出し側で 120ms デバウンス）。

## スニペットとフォーカス（lib/fulltext/locate.ts）
- `findMatch(text, terms)`: `normalizeWithMap(text)` 上で各語の出現位置を探し、元テキストの [start,end) を返す。曖昧一致時は最良窓を返す。
- `makeSnippet(text, terms, radius=40)`: 一致箇所の前後を切り出し、`{ before, match, after }[]` 形式（HTML文字列を返さない＝XSS防止）。
- `locateInDom(root, terms)`: テキストノードを走査し（script/style/noscript/非表示要素を除く）、ノード境界をまたいで正規化文字列＋(node, offset) 対応表を作り、一致を DOM `Range` で返す。

## 保存（capture content script）
- 対象: `http(s)` のみ。incognito、拡張ページ、除外ルール `no_index` は保存しない。`url_only` はタイトルとURLだけ。
- 背景に `FT_PAGE_STATUS` を問い合わせ、保存不要なら何もしない（既存かつ 12 時間以内に索引済みなら last_visit だけ更新）。
- 必要なら DOM が落ち着くまで待つ（innerText 長が1秒変化しない、最大10秒）→ `requestIdleCallback` → `Readability` を clone に対して実行。失敗・短すぎ（<200字）なら `document.body.innerText` を使う。
- SPA: background の `tabs.onUpdated` で `changeInfo.url` を受けたら、そのタブへ `FT_RECAPTURE` を送る（1.5秒デバウンス）。
- 既定の除外ルール: FTTF の既定リスト相当（銀行・メール・パスワード管理・検索結果ページ・localhost/.local/.internal）に日本の主要ネット銀行・証券を数件足す。

## FTTF からの移行
- 設定画面から FTTF のエクスポート JSON（`{"document":[[id,title,url,excerpt,md_content,md_content_hash,publication_date,hostname,last_visit,last_visit_date,extractor,created_at,updated_at], ...]}`）を読み込む。
- md_content は Markdown を簡易にプレーンテキスト化して body に入れる。数百MBでも落ちないよう、ファイルはストリームで読み、行単位（配列要素単位）で逐次パースして 200件ずつコミットする。進捗を返す。

## 開くとフォーカス
- 結果で Enter → background `FT_OPEN { url, terms, target }`。background は対象タブ（current は現タブ、tab/window は新規）に `pendingFocus[tabId] = { url, terms, expires: now+60s }` を置いてから遷移。現タブの URL が同一（hash以外）なら遷移せず直接 `FT_FOCUS` を送る。
- 遷移先の content script は読み込み後 `FT_TAKE_FOCUS` を問い合わせ、あれば `locateInDom` → `scrollIntoView({block:'center'})` → `CSS.highlights` でハイライト（DOM を書き換えない）＋ `getSelection()` で選択。見つからなければ MutationObserver で最大6秒再試行。
- Alt+Enter は保存済みテキストのプレビュー（ページが消えた時用）。

## プライバシー
- 新規コードはネットワーク API（fetch/XHR/WebSocket/sendBeacon）を一切使わない。例外は無し。
- 既存の `FETCH_FAVICON`（閲覧ドメインを `google.com/s2/favicons` へ送っていた）を、Chrome 内蔵の `_favicon` API（`chrome-extension://<id>/_favicon/?pageUrl=…&size=32` を background で fetch → dataURL）に置き換える。
