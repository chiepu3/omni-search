import type { FulltextEngine } from './engine';

// 文字列と構造記号を分離する。チャンク境界にあるエスケープやUTF-8も保持する。
async function* jsonTokens(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let token = '', quoted = false, escaped = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      const chunk = decoder.decode(value, { stream: !done });
      for (const char of chunk) {
        if (quoted) {
          token += char;
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') { quoted = false; yield token; token = ''; }
        } else if (char === '"') {
          if (token) throw new Error('JSON文字列の区切りが不正です');
          quoted = true; token = char;
        } else if ('{}[],:'.includes(char) || /\s/.test(char)) {
          if (token) { yield token; token = ''; }
          if (!/\s/.test(char)) yield char;
        } else token += char;
      }
      if (done) break;
    }
    if (quoted) throw new Error('JSON文字列が閉じられていません');
    if (token) yield token;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// document の各行だけ JSON.parse する。ほかのトップレベル値は蓄積しない。
export async function* parseFttfRows(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown[]> {
  const tokens = jsonTokens(stream)[Symbol.asyncIterator]();
  const next = async () => {
    const result = await tokens.next();
    if (result.done) throw new Error('JSONが途中で終了しました');
    return result.value;
  };
  const expect = async (value: string) => {
    if (await next() !== value) throw new Error(`JSONに ${value} が必要です`);
  };
  const readValue = async (first: string, collect: boolean) => {
    const parts = collect ? [first] : [];
    if (first === '[' || first === '{') {
      const stack = [first];
      while (stack.length) {
        const token = await next();
        if (collect) parts.push(token);
        if (token === '[' || token === '{') stack.push(token);
        else if (token === ']' || token === '}') {
          if (stack.pop() !== (token === ']' ? '[' : '{')) throw new Error('JSONの括弧が不正です');
        }
      }
    } else JSON.parse(first);
    return parts.join('');
  };
  try {
    await expect('{');
    let key = await next(), found = false;
    while (key !== '}') {
      if (!key.startsWith('"')) throw new Error('JSONのキーが不正です');
      const name = JSON.parse(key);
      await expect(':');
      if (name === 'document') {
        if (found) throw new Error('document が重複しています');
        found = true;
        await expect('[');
        let first = await next();
        while (first !== ']') {
          if (first !== '[') throw new Error('document の要素は行配列である必要があります');
          yield JSON.parse(await readValue(first, true)) as unknown[];
          const separator = await next();
          if (separator === ']') break;
          if (separator !== ',') throw new Error('行の区切りが不正です');
          first = await next();
          if (first === ']') throw new Error('末尾のカンマは使えません');
        }
      } else await readValue(await next(), false);
      const separator = await next();
      if (separator === '}') break;
      if (separator !== ',') throw new Error('プロパティの区切りが不正です');
      key = await next();
      if (key === '}') throw new Error('末尾のカンマは使えません');
    }
    if (!found) throw new Error('document 配列がありません');
    if (!(await tokens.next()).done) throw new Error('JSON末尾に余分なデータがあります');
  } finally {
    await tokens.return?.(undefined);
  }
}

export interface ImportProgress {
  running: boolean; done: number; total: number | null; imported: number; skipped: number; error?: string;
}

export async function importFttfStream(
  engine: FulltextEngine, stream: ReadableStream<Uint8Array>, progress: ImportProgress,
) {
  let batch: unknown[][] = [];
  const flush = () => {
    const counts = engine.importRows(batch);
    progress.imported += counts.imported;
    progress.skipped += counts.skipped;
    progress.done += batch.length;
    batch = [];
  };
  for await (const row of parseFttfRows(stream)) {
    batch.push(row);
    if (batch.length === 200) {
      flush();
      // 検索要求と進捗ポーリングを処理できるようにする。
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (batch.length) flush();
  progress.total = progress.done;
}
