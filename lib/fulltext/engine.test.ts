import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { FulltextEngine } from './engine';
import { importFttfStream, parseFttfRows, type ImportProgress } from './fttfImport';
import { canonicalUrl, matchesUrlPattern } from './url';
import { normalize } from './normalize';
import { fuzzyCoverage } from './query';

let sqlite: Sqlite3Static;
let db: Database;
let engine: FulltextEngine;
beforeAll(async () => { sqlite = await init(); });
beforeEach(() => { db = new sqlite.oo1.DB(':memory:', 'c'); engine = new FulltextEngine(db); });
afterEach(() => db.close());

function streamJson(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) controller.close();
    else { controller.enqueue(bytes.slice(offset, offset + chunkSize)); offset += chunkSize; }
  } });
}
const progress = (): ImportProgress => ({ running: true, done: 0, total: null, imported: 0, skipped: 0 });
const row = (id: number, body = '# 東京都庁\n\n保存する本文', visit: unknown = 1700000000) =>
  [id, 'インポート', `https://example.com/import/${id}`, '概要', body, 'hash', null, 'example.com', visit, null, 'readability', null, null];

describe('SQLite保存エンジン', () => {
  it('挿入、正規化検索、同一URLの更新、FTSを含む削除', () => {
    expect(engine.capture('https://example.com/a?utm_source=test#part', {
      title: '東京都庁の案内', body: '謎の空白がある 東京 都庁 とサーバーの記録。',
    }, 1000)).toEqual({ ok: true });
    const found = engine.search('東京都庁 サーバー', 20);
    expect(found.terms).toEqual(['東京都庁', 'サーバー']);
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0].fuzzy).toBe(false);
    expect(found.hits[0].snippet).not.toBeNull();
    expect(found.tookMs).toBeGreaterThanOrEqual(0);
    const id = found.hits[0].id;
    expect(found.hits[0].url).toBe('https://example.com/a');
    expect(engine.getPage(id)).toMatchObject({ body: expect.stringContaining('東京 都庁') });
    engine.capture('https://example.com/a', { title: '大阪の記録', body: '大阪城と城下町について。' }, 2000);
    expect(engine.search('東京都庁', 20).hits).toHaveLength(0);
    expect(engine.search('大阪城', 20).hits[0].id).toBe(id);
    expect(engine.deletePages('https://example.com/%')).toEqual({ deleted: 1 });
    expect(engine.search('大阪城', 20).hits).toHaveLength(0);
    expect(engine.getPage(id)).toBeNull();
    expect(engine.stats()).toMatchObject({ pages: 0, fullPages: 0, oldest: null, newest: null });
  });

  it('空クエリ、NOTのみ、記号、検索件数の上限', () => {
    engine.capture('https://example.com/', { title: '東京', body: '東京都庁' });
    for (const query of ['', '　 ', 'ーー。', '-東京']) expect(engine.search(query, 20).hits).toEqual([]);
    expect(engine.search('東京', 0).hits).toEqual([]);
    expect(engine.search('東京 -都庁', 20).hits).toEqual([]);
  });

  it('完全一致の後に、連続窓のカバレッジ0.6以上の曖昧一致を加える', () => {
    engine.capture('https://example.com/exact', { title: '完全一致', body: '東京都庁見学' });
    engine.capture('https://example.com/fuzzy', { title: '曖昧一致', body: '東京都長見学' });
    engine.capture('https://example.com/far', { title: '離れた語', body: '東京' + '山川'.repeat(40) + '都庁' });
    const results = engine.search('東京都庁見学', 20).hits;
    expect(results.map(hit => hit.url)).toEqual(['https://example.com/exact', 'https://example.com/fuzzy']);
    expect(results.map(hit => hit.fuzzy)).toEqual([false, true]);
    expect(results[1].snippet).not.toBeNull();
    expect(engine.search('東京都庁見学', 20, Date.now(), false).hits.map(hit => hit.fuzzy)).toEqual([false]);
  });

  it('12時間以内は閲覧回数と最終閲覧だけを更新する', () => {
    const url = 'https://example.com/recent';
    const now = 1800000000000;
    expect(engine.pageStatus(url, now)).toEqual({ shouldCapture: true, level: 'full' });
    engine.capture(url, { title: '東京', body: '本文' }, now);
    expect(engine.pageStatus(url, now + 1000).shouldCapture).toBe(false);
    expect(engine.search('東京', 1).hits[0]).toMatchObject({ visitCount: 2, lastVisit: now + 1000 });
    expect(engine.pageStatus(url, now + 12 * 3600000).shouldCapture).toBe(true);
    expect(engine.stats()).toMatchObject({ pages: 1, fullPages: 1, oldest: now, newest: now + 12 * 3600000 });
    expect(engine.stats().dbBytes).toBeGreaterThan(0);
  });

  it('除外ルールの追加、優先順位、削除とurl_onlyを適用する', () => {
    expect(engine.pageStatus('file:///secret')).toEqual({ shouldCapture: false, level: 'no_index' });
    expect(engine.pageStatus('https://mail.google.com/inbox').shouldCapture).toBe(false);
    engine.addRule('https://example.com/%', 'url_only');
    engine.addRule('https://example.com/private%', 'no_index');
    expect(engine.capture('https://example.com/private', { title: '', body: '秘密' }).ok).toBe(false);
    engine.capture('https://example.com/public', { title: '東京都庁', body: '秘密文字列' });
    const hit = engine.search('東京都庁', 20).hits[0];
    expect(hit.snippet).toBeNull();
    expect(engine.getPage(hit.id)).toMatchObject({ body: '' });
    expect(engine.search('秘密文字列', 20).hits).toEqual([]);
    const rule = engine.listRules().find(rule => rule.pattern === 'https://example.com/%')!;
    engine.removeRule(rule.id);
    expect(engine.pageStatus('https://example.com/public').shouldCapture).toBe(true);
    engine.removeRule(engine.listRules()[0].id);
    const count = engine.listRules().length;
    new FulltextEngine(db);
    expect(engine.listRules()).toHaveLength(count);
    expect(engine.addRule('', 'no_index').ok).toBe(false);
  });

  it('本文を200,000文字に制限し、%だけをURLワイルドカードとして扱う', () => {
    engine.capture('https://example.com/a_b', { title: '大きい本文', body: '東'.repeat(200010) });
    engine.capture('https://example.com/axb', { title: '', body: '' });
    const id = Number(db.selectValue('SELECT id FROM pages WHERE url=?', ['https://example.com/a_b']));
    expect(engine.getPage(id)?.body).toHaveLength(200000);
    expect(engine.deletePages('https://example.com/a_b').deleted).toBe(1);
    expect(engine.stats().pages).toBe(1);
  });
});

describe('FTTFストリーム取り込み', () => {
  it('UTF-8、括弧、引用符、バックスラッシュ、エスケープをチャンク境界で復元する', async () => {
    const rows = [row(1, '# 東京\n[リンク](https://example.com)\n配列 [ ], 引用 " と \\ と 😀'), row(2)];
    const text = JSON.stringify({ metadata: { ignored: ['document', '["],'] }, document: rows, tail: [] });
    const actual = [];
    for await (const item of parseFttfRows(streamJson(text, 1))) actual.push(item);
    expect(actual).toEqual(rows);
    const state = progress();
    await importFttfStream(engine, streamJson(text), state);
    expect(state).toMatchObject({ done: 2, total: 2, imported: 2, skipped: 0 });
    expect(engine.search('東京', 20).hits).toHaveLength(2);
    expect(engine.getPage(1)?.body).toContain('リンク');
    expect(engine.getPage(1)?.body).not.toContain('https://example.com');
  });

  it('200件単位でコミットし、既存本文を保持して最終閲覧だけ新しい日時にする', async () => {
    engine.capture('https://example.com/import/1', { title: '既存', body: '既存の本文' }, 1600000000000);
    const rows = Array.from({ length: 402 }, (_, i) => row(i));
    rows.push(row(1, '上書き禁止', 1500000000));
    const state = progress();
    const rules = vi.spyOn(engine, 'listRules');
    await importFttfStream(engine, streamJson(JSON.stringify({ document: rows }), 103), state);
    expect(state).toMatchObject({ done: 403, imported: 401, skipped: 2, total: 403 });
    expect(engine.getPage(1)).toMatchObject({ body: '既存の本文', lastVisit: 1700000000000 });
    expect(db.selectValue('SELECT count(*) FROM pages_fts')).toBe(402);
    expect(rules).toHaveBeenCalledTimes(3);
  });

  it('不完全なJSONと不正な行を拒否する', async () => {
    for (const text of ['{}', '{"document":[[1,"unfinished', '{"document":[{},[]]}', '{"document":[[],]}', '{"document":[]}garbage']) {
      await expect(importFttfStream(engine, streamJson(text), progress())).rejects.toThrow();
    }
  });
});

it('URL正規化とURL全体への%パターン', () => {
  expect(canonicalUrl('https://example.com/a?x=1&utm_source=x&UTM_CAMPAIGN=y#z')).toBe('https://example.com/a?x=1');
  expect(canonicalUrl('https://example.com/?q=a%20b&utm_source=x')).toBe(canonicalUrl('https://example.com/?q=a%20b'));
  expect(canonicalUrl('https://example.com/?foo&a=%20&b=+&c=%2f#section')).toBe('https://example.com/?foo&a=%20&b=+&c=%2f');
  expect(canonicalUrl('https://example.com/?foo&utm_source=x&a=%20&b=+&c=%2f')).toBe('https://example.com/?foo&a=%20&b=+&c=%2f');
  expect(canonicalUrl('https://example.com/?foo&%75tm_campaign=x#section')).toBe('https://example.com/?foo');
  expect(canonicalUrl('https://example.com/?utm_source=x&foo#!route')).toBe('https://example.com/?foo#!route');
  expect(canonicalUrl('https://example.com/?foo#/route?utm_source=hash')).toBe('https://example.com/?foo#/route?utm_source=hash');
  expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  expect(canonicalUrl('https://user:password@example.com/')).toBeNull();
  expect(matchesUrlPattern('https://example.com/a_b', 'https://%.com/a_b')).toBe(true);
  expect(matchesUrlPattern('https://example.com/axb', 'https://%.com/a_b')).toBe(false);
  expect(matchesUrlPattern('https://example.com/a?b=1', 'https://example.com/a?b=1')).toBe(true);
  expect(matchesUrlPattern('https://evil.com/https://example.com/', 'https://example.com/%')).toBe(false);
});

it('空の本文はurl_onlyとして保存する', () => {
  engine.capture('https://example.com/login', { title: 'ログイン', body: '' });
  expect(db.selectValue('SELECT level FROM pages')).toBe('url_only');
});

it('既定のプライベートIPは保存せず、DiscordとSlackはURLのみ', () => {
  for (const host of ['192.168.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255']) {
    expect(engine.pageStatus(`http://${host}/secret`).shouldCapture).toBe(false);
  }
  for (const host of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1']) {
    expect(engine.pageStatus(`http://${host}/`).shouldCapture).toBe(true);
  }
  for (const url of ['https://discord.com/channels/123/456', 'https://app.slack.com/client/123']) {
    expect(engine.pageStatus(url).level).toBe('url_only');
  }
});

it('曖昧判定は先頭20,000文字までに制限する', () => {
  engine.capture('https://example.com/late', { title: '', body: '山'.repeat(20000) + '東京都長見学' });
  expect(engine.search('東京都庁見学', 20).hits).toEqual([]);
});

it.each([
  ['abcdefghi', 'abcxefghi'],
  ['ああああ', 'ああ'],
  ['𠮷山東京大阪', '𠮷山東京阪'],
  ['abcdefg', 'abcdefx'],
  ['東京都庁', '東京' + '山'.repeat(20) + '京都' + '川'.repeat(20) + '都庁'],
])('近接条件でカバレッジ判定の結果を変えない: %s', (query, body) => {
  engine.capture('https://sample.test/item', { title: '資料', body });
  expect(engine.search(query, 20).hits.length > 0).toBe(fuzzyCoverage(normalize(body), normalize(query)) >= 0.6);
});

it('1文字検索は最近200ページの中から最終閲覧順で返す', () => {
  engine.capture('https://example.com/old', { title: '', body: '鷺' }, 1);
  for (let i = 0; i < 200; i++) engine.capture(`https://example.com/${i}`, { title: '', body: '東の記録' }, 1000 + i);
  expect(engine.search('鷺', 20).hits).toEqual([]);
  expect(engine.search('の', 2).hits.map(hit => hit.url)).toEqual(['https://example.com/199', 'https://example.com/198']);
});

it('1文字クエリが本文末尾の文字にも当たる', async () => {
  const sqlite = await (await import('@sqlite.org/sqlite-wasm')).default();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  const engine = new FulltextEngine(db);
  engine.capture('https://tail.example/', { title: 'x', body: 'ここは末尾が鷺' }, 1);
  expect(engine.search('鷺', 5).hits.map(h => h.url)).toEqual(['https://tail.example/']);
  db.close();
});

it('FTTF由来の既定ルールで x.com のタイムラインはURLのみ、個別ポストは本文保存', async () => {
  const { matchesUrlPattern } = await import('./url');
  const { DEFAULT_RULES } = await import('./defaultRules');
  const level = (u: string) => DEFAULT_RULES.find(r => matchesUrlPattern(u, r.pattern))?.level ?? 'full';
  expect(level('https://x.com/home')).toBe('url_only');
  expect(level('https://x.com/')).toBe('url_only');
  expect(level('https://x.com/someone/status/1')).toBe('full');
  expect(level('https://docs.google.com/document/d/abc/edit')).toBe('url_only');
  expect(level('https://www.amazon.co.jp/dp/B000')).toBe('url_only');
  expect(level('https://yandex.com/search/?text=a')).toBe('full');
});
