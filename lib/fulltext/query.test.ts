import { beforeAll, describe, expect, it } from 'vitest';
import init, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { normalize, toBigramTokens } from './normalize';
import { buildFtsMatch, buildFuzzyFtsMatch, findFuzzyWindow, fuzzyCoverage, parseQuery } from './query';

let sqlite: Sqlite3Static;
beforeAll(async () => { sqlite = await init(); });

describe('クエリ', () => {
  it('元の語と正規化語を同じ順序で保持し、除外・空の語を取り除く', () => {
    expect(parseQuery(' ＡＢＣ　東京都庁 -サーバー - -😀 !!! 𠮷 ')).toEqual({
      terms: ['ＡＢＣ', '東京都庁', '𠮷'],
      normTerms: ['abc', '東京都庁', '𠮷'],
      excludes: ['さば'],
    });
  });

  it('bigram フレーズと1文字のプレフィックスを AND / NOT で結ぶ', () => {
    expect(buildFtsMatch(parseQuery('ＡＢＣ 東 -サーバー -a')))
      .toBe('"ab bc" AND "東"* NOT "さば" NOT "a"*');
    expect(buildFtsMatch(parseQuery('𠮷'))).toBe('"𠮷"*');
    expect(buildFtsMatch(parseQuery('𠮷野'))).toBe('"𠮷野"');
    expect(buildFtsMatch(parseQuery('-東京 !!!'))).toBeNull();
  });

  it('念のため二重引用符をエスケープする', () => {
    expect(buildFtsMatch({ terms: [], normTerms: ['"'], excludes: [] })).toBe('""""*');
  });

  it('3文字以上の語の bigram を重複を除いて OR で結ぶ', () => {
    expect(buildFuzzyFtsMatch(parseQuery('ab abc abcd abc -東京')))
      .toBe('("ab" OR "bc" OR "cd") NOT "東京"');
    expect(buildFuzzyFtsMatch(parseQuery('𠮷野家'))).toBe('("𠮷野" OR "野家")');
    expect(buildFuzzyFtsMatch(parseQuery('a 東京 𠮷野'))).toBeNull();
  });

  it('実際の FTS5 で1文字プレフィックス・AND・複数 NOT・曖昧 OR が動く', () => {
    const db = new sqlite.oo1.DB(':memory:', 'c');
    try {
      db.exec("CREATE VIRTUAL TABLE docs USING fts5(body, tokenize='unicode61 remove_diacritics 0')");
      for (const [id, text] of [[1, '東京都庁 abc'], [2, '東京サーバー'], [3, '東京都長'], [4, '東京駅 xyz']] as const) {
        db.exec({ sql: 'INSERT INTO docs(rowid,body) VALUES (?,?)', bind: [id, toBigramTokens(normalize(text))] });
      }
      const rows = (match: string | null) => db.exec({
        sql: 'SELECT rowid FROM docs WHERE body MATCH ? ORDER BY rowid',
        bind: [match], rowMode: 'array', returnValue: 'resultRows',
      });
      expect(rows(buildFtsMatch(parseQuery('東')))).toEqual([[1], [2], [3], [4]]);
      expect(rows(buildFtsMatch(parseQuery('東 abc')))).toEqual([[1]]);
      expect(rows(buildFtsMatch(parseQuery('東 -abc -サーバー -xyz')))).toEqual([[3]]);
      expect(rows(buildFuzzyFtsMatch(parseQuery('東京都庁 -サーバー -xyz')))).toEqual([[1], [3]]);
    } finally { db.close(); }
  });
});

describe('fuzzyCoverage', () => {
  it('窓内の異なる bigram の最大被覆率を返す', () => {
    expect(fuzzyCoverage('abcxef', 'abcdef')).toBeCloseTo(3 / 5);
    expect(fuzzyCoverage('abcxxxdef', 'abcdef')).toBeCloseTo(4 / 5);
    expect(fuzzyCoverage('abxxxxxxxxxxxxxxxxxxxxbc', 'abc')).toBe(0.5);
    expect(fuzzyCoverage('aaaaa', 'aaaa')).toBe(1);
    expect(fuzzyCoverage('abc', '')).toBe(0);
    expect(fuzzyCoverage('', 'abc')).toBe(0);
    expect(fuzzyCoverage('abc', 'b')).toBe(1);
    expect(fuzzyCoverage('abc', 'z')).toBe(0);
    expect(fuzzyCoverage('𠮷野屋', '𠮷野家')).toBe(0.5);
  });

  it('結果の位置は UTF-16 の境界になる', () => {
    expect(findFuzzyWindow('xxx𠮷野屋zzz', '𠮷野家')).toEqual({ start: 3, end: 6, coverage: 0.5 });
  });

  it('総当たりした窓の被覆率と一致する', () => {
    let seed = 123;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let trial = 0; trial < 150; trial++) {
      const chars = Array.from({ length: 60 }, () => 'abcd'[random() % 4]);
      const term = Array.from({ length: 3 + random() % 7 }, () => 'abcd'[random() % 4]).join('');
      const tokens = new Set(Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2)));
      let expected = 0;
      for (let i = 0; i < chars.length; i++) {
        const window = chars.slice(i, i + term.length * 2).join('');
        expected = Math.max(expected, [...tokens].filter(token => window.includes(token)).length / tokens.size);
      }
      expect(fuzzyCoverage(chars.join(''), term)).toBe(expected);
    }
  });

  it('1万文字の本文を走査する簡単なベンチ', () => {
    const text = '東京都庁検索サーバー本文'.repeat(1000).slice(0, 10_000);
    const term = '東京都庁本文';
    for (let i = 0; i < 5; i++) fuzzyCoverage(text, term);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      fuzzyCoverage(text, term);
      times.push(performance.now() - start);
    }
    const median = times.sort((a, b) => a - b)[4];
    console.info(`fuzzyCoverage: 10,000 UTF-16 units, median ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(20);
  });
});
