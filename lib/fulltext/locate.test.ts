// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMatch, locateInDom, makeSnippet, stripMarkdown } from './locate';

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; vi.restoreAllMocks(); });

describe('findMatch / makeSnippet', () => {
  it('正規化した語の元の UTF-16 範囲を返す', () => {
    const text = '前😀東 京\n都 庁。後';
    expect(findMatch(text, ['東京都庁'])).toEqual({ start: 3, end: 10 });
    expect(makeSnippet(text, ['東京都庁'])).toEqual({ before: '前😀', match: '東 京\n都 庁', after: '。後' });
    expect(findMatch('前髙橋サーバー後', ['高橋さば'])).toEqual({ start: 1, end: 6 });
    expect(findMatch('あ東京 余白', ['東京'])).toEqual({ start: 1, end: 3 });
  });

  it('展開文字の途中・サロゲートペア・結合濁点を分断しない', () => {
    expect(findMatch('x㍻y', ['平'])).toEqual({ start: 1, end: 2 });
    expect(findMatch('x㍻y', ['成'])).toEqual({ start: 1, end: 2 });
    expect(findMatch('😀𠮷野😀', ['𠮷'])).toEqual({ start: 2, end: 4 });
    expect(findMatch('xｶﾞy', ['が'])).toEqual({ start: 1, end: 3 });
    expect(findMatch('xカ\u3099y', ['が'])).toEqual({ start: 1, end: 3 });
    expect(findMatch('e\u0301!', ['é'])).toEqual({ start: 0, end: 2 });
    expect(findMatch('x각y', ['각'])).toEqual({ start: 1, end: 4 });
    expect(findMatch('x각y', ['각'])).toEqual({ start: 1, end: 3 });
  });

  it('全語が最も密集する場所の先頭語を返す', () => {
    const text = '東京' + '遠'.repeat(30) + '都庁 東京';
    expect(findMatch(text, ['東京', '都庁'])).toEqual({ start: 32, end: 34 });
    expect(findMatch('最初東京次都庁', ['東京', '存在しない', '都庁'])).toEqual({ start: 2, end: 4 });
    expect(findMatch('何もなし', ['東京'])).toBeNull();
    expect(findMatch('東京', [])).toBeNull();
    expect(findMatch('東京', [''])).toBeNull();
  });

  it('重なり合う語・重複する語も扱う', () => {
    expect(findMatch('abcxxabc', ['ab', 'bc', 'ab'])).toEqual({ start: 0, end: 2 });
  });

  it('曖昧一致の被覆率が最大になる窓を返す', () => {
    const text = 'ab' + 'x'.repeat(30) + 'abcxef';
    expect(findMatch(text, ['abcdef'], { fuzzy: true })).toEqual({ start: 32, end: 38 });
    expect(findMatch('xxxxx', ['abcdef'], { fuzzy: true })).toBeNull();
  });

  it('スニペットの前後だけ空白を詰め、切れた部分に省略記号を付ける', () => {
    expect(makeSnippet('0123a \n東京\n  b4567', ['東京'], { radius: 4 }))
      .toEqual({ before: '…3a ', match: '東京', after: ' b…' });
    expect(makeSnippet('前東京後', ['東京'], { radius: 0 }))
      .toEqual({ before: '…', match: '東京', after: '…' });
    expect(makeSnippet('x😀東京😀y', ['東京'], { radius: 1 }))
      .toEqual({ before: '…😀', match: '東京', after: '😀…' });
    expect(makeSnippet('東京', ['都庁'])).toBeNull();
    expect(makeSnippet('<b>東京</b>', ['東京'])?.match).toBe('東京');
  });
});

describe('locateInDom', () => {
  it.each(['<b>東京</b>都庁', '東京<br>都庁', '<b>東</b> 京\n<span>都</span> 庁'])
    ('ノードと改行をまたぐ: %s', html => {
      document.body.innerHTML = `<main>${html}</main>`;
      const range = locateInDom(document.body, ['東京都庁']);
      expect(range).not.toBeNull();
      expect(range!.toString().replace(/\s/g, '')).toBe('東京都庁');
      expect(range!.startOffset).toBe(0);
    });

  it('不可視・本文以外のサブツリーを除外する', () => {
    document.head.innerHTML = '<style>.hidden { display: none } .invisible { visibility: hidden }</style><title>対象語</title>';
    document.body.innerHTML = `
      <script>対象語</script><style>対象語</style><noscript>対象語</noscript>
      <template>対象語</template><textarea>対象語</textarea>
      <p hidden><b>対象語</b></p><p class="hidden"><b>対象語</b></p>
      <p class="invisible"><b>対象語</b></p><p id="visible">対象語</p>`;
    const range = locateInDom(document, ['対象語']);
    expect(range!.startContainer.parentElement?.id).toBe('visible');
    expect(range!.toString()).toBe('対象語');
    expect(locateInDom(document.querySelector('[hidden]')!.firstChild!, ['対象語'])).toBeNull();
  });

  it('正規化と展開・サロゲートペア・1文字の範囲を扱う', () => {
    document.body.innerHTML = '<span>😀㍻</span><b>𠮷</b><i>ｶ</i>ﾞ';
    expect(locateInDom(document.body, ['平'])!.toString()).toBe('㍻');
    expect(locateInDom(document.body, ['𠮷が'])!.toString()).toBe('𠮷ｶﾞ');
    expect(locateInDom(document.body, ['𠮷'])!.toString()).toBe('𠮷');
    const text = document.querySelector('b')!.firstChild!;
    expect(locateInDom(text, ['𠮷'])!.toString()).toBe('𠮷');
  });

  it('曖昧一致と、一致しない場合を扱う', () => {
    document.body.innerHTML = '<b>abc</b>xef';
    expect(locateInDom(document.body, ['abcdef'], { fuzzy: true })!.toString()).toBe('abcxef');
    expect(locateInDom(document.body, ['zzz'])).toBeNull();
    expect(locateInDom(document.body, [])).toBeNull();
    expect(locateInDom(document.createElement('div'), ['abc'])).toBeNull();
  });

  it('同じ要素のスタイルを繰り返し取得しない', () => {
    const root = document.createElement('main');
    document.body.append(root);
    for (let i = 0; i < 1000; i++) root.append(document.createTextNode('文'));
    root.append(document.createTextNode('検索対象'));
    const spy = vi.spyOn(window, 'getComputedStyle');
    expect(locateInDom(root, ['検索対象'])!.toString()).toBe('検索対象');
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(new Set(spy.mock.calls.map(([element]) => element)).size).toBe(spy.mock.calls.length);
  });

});

describe('stripMarkdown', () => {
  it('見出し・強調・リンク・画像・コードフェンス・表を処理する', () => {
    const md = '# 見出し\n**強調**と_斜体_ [リンク](https://example.test)\n![画像](image.png)\n```ts\nconst code = 1;\n```\n| 名前 | 値 |\n| --- | --- |\n| 東京 | 都庁 |';
    const text = stripMarkdown(md);
    expect(text).toContain('見出し');
    expect(text).toContain('強調と斜体 リンク');
    expect(text).toContain('const code = 1;');
    expect(text).toContain(' 東京   都庁 ');
    expect(text).not.toMatch(/[#*`|]|https:|画像|image\.png|---/);
  });
});
