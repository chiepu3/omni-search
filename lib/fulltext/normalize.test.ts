import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithMap, toBigramTokens } from './normalize';

describe('normalize', () => {
  it.each([
    ['ＡＢＣ１２３', 'abc123'],
    ['ﾊﾝｶｸ ｶﾞｯﾂﾎﾟｰｽﾞ', 'はんかくがっつぽず'],
    ['カタカナ ヴ ヵヶ ヽヾ', 'かたかなゔかけゝゞ'],
    ['サーバ サーバー ｻｰﾊﾞｰ 〜～‐-', 'さばさばさば'],
    ['髙橋 高橋 﨑 德 邊邉 齋齊 濵 澤 櫻 國', '高橋高橋崎徳辺辺斎斉浜沢桜国'],
    ['東 京\n都\t庁', '東京都庁'],
    ['①㍻ﬃ 𠮷😀𠮟', '1平成ffi𠮷𠮟'],
    ['e\u0301 ｶﾞ カ\u3099', 'éがが'],
    ['각 ㄱㅏ 각', '각가각'],
    ['ΟΣ ΟΣΑ Ϲ', 'οςοσασ'],
    ['İ ㋿', 'i令和'],
  ])('正規化する: %s', (input, expected) => {
    expect(normalize(input)).toBe(expected);
    expect(normalizeWithMap(input).norm).toBe(expected);
  });

  it('対応表は展開文字・サロゲートペア・末尾の除去文字を扱う', () => {
    const input = ' 😀㍻ 𠮷ｶﾞ! ';
    const result = normalizeWithMap(input);
    expect(result.norm).toBe('平成𠮷が');
    expect(Array.from(result.map)).toEqual([3, 3, 5, 5, 7, 9]);
    expect(Array.from(normalizeWithMap(' !!! ').map)).toEqual([0]);
    expect(Array.from(normalizeWithMap('Ａ!').map)).toEqual([0, 1]);
    expect(Array.from(normalizeWithMap('e\u0301!').map)).toEqual([0, 2]);
  });

  it('ランダム文字列の各出力コードポイントは元の対応文字に属する', () => {
    const alphabet = Array.from('AaＺ０①㍻ﬃİかなカナ髙邊漢字𠮷𠮟😀 !\n-ー﨑');
    let seed = 0x12345678;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const input = Array.from({ length: 100 }, () => alphabet[random() % alphabet.length]).join('');
      const { norm, map } = normalizeWithMap(input);
      expect(norm).toBe(normalize(input));
      expect(map.length).toBe(norm.length + 1);
      let offset = 0;
      for (const ch of norm) {
        const source = String.fromCodePoint(input.codePointAt(map[offset])!);
        expect(normalize(source)).toContain(ch);
        for (let j = 0; j < ch.length; j++) expect(map[offset + j]).toBe(map[offset]);
        offset += ch.length;
      }
      for (let i = 1; i < map.length; i++) expect(map[i]).toBeGreaterThanOrEqual(map[i - 1]);
      if (norm) {
        const last = map[norm.length - 1];
        expect(map[norm.length]).toBe(last + String.fromCodePoint(input.codePointAt(last)!).length);
      }
    }
  });

  it('結合文字を含むランダム文字列でも NFKC の結果と一致する', () => {
    const alphabet = Array.from('AeΣΟaｅｶｷﾞﾟカ\u3099\u0301\u0327\u0345각가ㄱㅏ漢𠮷 !');
    let seed = 123;
    for (let trial = 0; trial < 300; trial++) {
      let input = '';
      for (let i = 0; i < 40; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        input += alphabet[seed % alphabet.length];
      }
      expect(normalizeWithMap(input).norm, input).toBe(normalize(input));
    }
  });

  it('20万文字の位置対応を50ms以内で生成する', () => {
    const sample = '東京都庁でサーバーを検索します ABC123。\n';
    const text = sample.repeat(Math.ceil(200_000 / sample.length)).slice(0, 200_000);
    for (let i = 0; i < 4; i++) normalizeWithMap(text);
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const result = normalizeWithMap(text);
      times.push(performance.now() - start);
      expect(result.norm).toBe(normalize(text));
    }
    const median = times.sort((a, b) => a - b)[3];
    console.info(`normalizeWithMap: 200,000 UTF-16 units, median ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(50);
  });
});

describe('toBigramTokens', () => {
  it.each([['', ''], ['a', 'a'], ['東京', '東京'], ['東京都庁', '東京 京都 都庁'],
    ['𠮷', '𠮷'], ['𠮷野家', '𠮷野 野家'], ['𠮷𠮟a', '𠮷𠮟 𠮟a']])('%s', (input, expected) => {
    expect(toBigramTokens(input)).toBe(expected);
  });
});
