import { expect, it } from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import { FulltextEngine } from './engine';

it('5,000ページ×約5,000字の日本語で検索時間を計測する', async () => {
  const sqlite = await init();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  try {
    const engine = new FulltextEngine(db);
    const topics = [
      '東京都庁見学の予約方法を調べて記録します。',
      '全文検索とローカルデータ保存について検証します。',
      '機械学習による日本語処理の仕組みを紹介します。',
      'サーバーの運用と障害の調査方法について説明します。',
      '大阪城の歴史と京都の文化について記録します。',
      '週末の登山とキャンプの準備についてまとめます。',
      '料理の材料と季節の野菜の育て方を紹介します。',
      '鉄道旅行で訪問した地域の観光情報を記録します。',
    ];
    const insertionStart = performance.now();
    for (let i = 0; i < 5000; i++) {
      let body = '';
      for (let j = 0; body.length < 5000; j++) {
        body += `${topics[(i + j * 3) % topics.length]}資料番号${i}の第${j}段落。\n`;
      }
      engine.capture(`https://example.com/page/${i}`, { title: `日本語の資料${i}`, body: body.slice(0, 5000) }, 1800000000000 - i * 60000);
    }
    const insertionMs = performance.now() - insertionStart;
    const queries = ['全文検索', '東京都庁見学', '機械学習 日本語', 'サーバー 運用', '東京都長見学'];
    const results: Record<string, { p50: number; p95: number; max: number }> = {};
    const all: number[] = [];
    for (const query of queries) {
      const samples: number[] = [];
      for (let i = 0; i < 11; i++) {
        const result = engine.search(query, 20, 1800000000000);
        expect(result.hits).toHaveLength(20);
        if (i) samples.push(result.tookMs);
      }
      samples.sort((a, b) => a - b);
      all.push(...samples);
      results[query] = { p50: samples[4], p95: samples[9], max: samples[9] };
    }
    all.sort((a, b) => a - b);
    console.log('FT_PERFORMANCE', JSON.stringify({ pages: 5000, bodyChars: 5000, insertionMs, samples: all.length, p50: all[24], p95: all[47], queries: results }));
  } finally { db.close(); }
}, 180000);

it('2,000ページ×30,000字でも不一致・非隣接・1文字検索が150ms以内', async () => {
  const sqlite = await init();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  try {
    const engine = new FulltextEngine(db);
    // 個々のbigramは大量に出るが、対象の語句は連続していない。
    const sentence = '東京の記録。山川を眺める日々の出来事。京都の旅行。山川を眺める日々の出来事。都庁の案内。サーバーの構成と運用の記録、障害の調査。';
    const body = sentence.repeat(Math.ceil(30000 / sentence.length)).slice(0, 30000);
    for (let i = 0; i < 2000; i++) engine.capture(`https://heavy.example.com/${i}`, {
      title: `資料${i}`, body: `資料番号${i}\n${body}`.slice(0, 30000),
    }, 1800000000000 - i);
    const results: Record<string, { max: number; hits: number }> = {};
    for (const query of ['サーバー運用障害xyz', '東京都庁', 'の']) {
      const samples = Array.from({ length: 3 }, () => engine.search(query, 20));
      results[query] = { max: Math.max(...samples.map(sample => sample.tookMs)), hits: samples[0].hits.length };
    }
    console.log('FT_HEAVY_PERFORMANCE', JSON.stringify(results));
    expect(results['サーバー運用障害xyz'].hits).toBe(0);
    expect(results['東京都庁'].hits).toBe(0);
    expect(results['の'].hits).toBe(20);
    for (const result of Object.values(results)) expect(result.max).toBeLessThan(150);
  } finally { db.close(); }
}, 180000);
