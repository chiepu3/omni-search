const variants: Record<string, string> = {
  髙: '高', 﨑: '崎', 德: '徳', 邊: '辺', 邉: '辺', 齋: '斎', 齊: '斉',
  濵: '浜', 濱: '浜', 澤: '沢', 櫻: '桜', 國: '国', 廣: '広', 會: '会',
  學: '学', 體: '体', 舊: '旧', 眞: '真', 龍: '竜', 瀧: '滝', 嶋: '島',
  嶌: '島', 冨: '富', 惠: '恵', 壽: '寿', 壱: '一', 壹: '一', 貳: '二',
  參: '三', 萬: '万', 與: '与', 亞: '亜', 圓: '円', 黑: '黒', 神: '神',
};
const variantPattern = new RegExp(`[${Object.keys(variants).join('')}]`, 'gu');
const nonLetters = /[^\p{L}\p{N}]/gu;
const longMarks = /[ーｰ〜～\p{Dash_Punctuation}\u2212]/gu;
const utf16 = new TextDecoder('utf-16le');

function fold(nfkc: string): string {
  return nfkc.toLowerCase()
    .replace(/[ァ-ヶヽヾ]/g, ch => ch === 'ヵ' ? 'か' : ch === 'ヶ' ? 'け'
      : String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(longMarks, '')
    .replace(variantPattern, ch => variants[ch])
    .replace(nonLetters, '');
}

export function normalize(s: string): string {
  return fold(s.normalize('NFKC'));
}

function isJamo(code: number): boolean {
  return (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x3130 && code <= 0x318f)
    || (code >= 0xffa0 && code <= 0xffdc);
}

// -1 は NFKC が必要、0 は除去、正の値は変換先の UTF-16 コード単位。
const fastChars = new Int32Array(0x10000).fill(-1);
fastChars.fill(0, 0, 0x80);
for (let code = 0x30; code <= 0x39; code++) fastChars[code] = code;
for (let code = 0x41; code <= 0x5a; code++) fastChars[code] = code + 0x20;
for (let code = 0x61; code <= 0x7a; code++) fastChars[code] = code;
for (const [start, end] of [[0x3041, 0x3096], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xac00, 0xd7a3]]) {
  for (let code = start; code <= end; code++) fastChars[code] = code;
}
for (let code = 0x30a1; code <= 0x30f6; code++) fastChars[code] = code - 0x60;
fastChars[0x30f5] = 0x304b;
fastChars[0x30f6] = 0x3051;
for (const code of [0x309d, 0x309e, 0x30fd, 0x30fe]) fastChars[code] = code >= 0x30fd ? code - 0x60 : code;
for (let code = 0xff01; code <= 0xff5e; code++) fastChars[code] = fastChars[code - 0xfee0];
for (const [from, to] of Object.entries(variants)) fastChars[from.charCodeAt(0)] = to.charCodeAt(0);
for (const code of [0x3000, 0x30fc, 0xff70]) fastChars[code] = 0;

export function normalizeWithMap(s: string): { norm: string; map: Int32Array } {
  let map = new Int32Array(s.length + 1);
  let output = new Uint8Array((s.length + 1) * 2);
  let length = 0;
  let lastEnd = 0;
  let contextualLowercase = false;
  // 結合文字の位置を先読みし、通常の文字ごとの正規表現判定を避ける。
  const marks = /[\p{M}\uFF9E\uFF9F]/gu;
  let nextMark = marks.exec(s)?.index ?? Infinity;
  const cache = new Map<string, string>();

  for (let start = 0; start < s.length;) {
    const code = s.codePointAt(start)!;
    let end = start + (code > 0xffff ? 2 : 1);
    while (true) {
      if (nextMark === end) {
        end += s.codePointAt(end)! > 0xffff ? 2 : 1;
        nextMark = marks.exec(s)?.index ?? Infinity;
      } else if (end < s.length && isJamo(s.charCodeAt(end))) {
        const nextEnd = end + 1;
        const before = s.slice(start, end).normalize('NFKC');
        const next = s.slice(end, nextEnd).normalize('NFKC');
        if ((before + next).normalize('NFKC') === before + next) break;
        end = nextEnd;
      } else break;
    }
    while (nextMark < end) nextMark = marks.exec(s)?.index ?? Infinity;

    const fast = end === start + 1 ? fastChars[code] : -1;
    if (fast > 0) {
      reserve(1);
      output[length * 2] = fast;
      output[length * 2 + 1] = fast >>> 8;
      map[length++] = start;
      lastEnd = end;
    } else if (fast !== 0) {
      const value = slowFold(s.slice(start, end));
      if (value) {
        reserve(value.length);
        for (let j = 0; j < value.length; j++) {
          const unit = value.charCodeAt(j);
          output[length * 2] = unit;
          output[length * 2 + 1] = unit >>> 8;
          map[length++] = start;
        }
        lastEnd = end;
      }
    }
    start = end;
  }
  map[length] = lastEnd;
  // ギリシャ語の語末シグマだけは、文字をまたぐ小文字化が必要。
  const norm = contextualLowercase ? normalize(s) : utf16.decode(output.subarray(0, length * 2));
  return { norm, map: map.subarray(0, length + 1) };

  function reserve(extra: number) {
    if (length + extra < map.length) return;
    const capacity = Math.max(map.length * 2, length + extra + 1);
    const grownMap = new Int32Array(capacity);
    const grownOutput = new Uint8Array(capacity * 2);
    grownMap.set(map);
    grownOutput.set(output);
    map = grownMap;
    output = grownOutput;
  }

  function slowFold(raw: string): string {
    const cached = cache.get(raw);
    if (cached !== undefined) return cached;
    const nfkc = raw.normalize('NFKC');
    if (nfkc.includes('Σ')) contextualLowercase = true;
    const value = fold(nfkc);
    if (cache.size < 1024) cache.set(raw, value);
    return value;
  }
}

export function toBigramTokens(norm: string): string {
  const chars = Array.from(norm);
  if (chars.length < 2) return norm;
  const tokens = new Array<string>(chars.length - 1);
  for (let i = 0; i < tokens.length; i++) tokens[i] = chars[i] + chars[i + 1];
  return tokens.join(' ');
}

// 索引用: bigram に末尾の1文字を足し、1文字クエリ（前方一致）が末尾の文字にも当たるようにする
export function toIndexTokens(norm: string): string {
  const chars = Array.from(norm);
  return chars.length < 2 ? norm : `${toBigramTokens(norm)} ${chars[chars.length - 1]}`;
}
