import type { Database, BindingSpec } from '@sqlite.org/sqlite-wasm';
import { normalize, toIndexTokens, toBigramTokens } from './normalize';
import { parseQuery, buildFtsMatch, buildFuzzyFtsMatch, fuzzyCoverage } from './query';
import { makeSnippet, stripMarkdown } from './locate';
import { DEFAULT_RULES } from './defaultRules';
import { canonicalUrl, compileUrlPattern, sqlUrlPattern } from './url';
import type { CapturedPage, ExcludeRule, FulltextHit, FulltextStats, IndexLevel } from './protocol';

interface PageRow {
  id: number; url: string; title: string; site_name: string; body: string;
  last_visit: number; visit_count: number; indexed_at: number; rank: number;
}

const MAX_BODY = 200_000;
const REINDEX_AFTER = 12 * 60 * 60 * 1000;

// 語彙不足を先に除き、短い語は2つのbigramの近接も要求する。
function fuzzyNearFilter(terms: string[], available: (grams: string[]) => string[]): string | null | false {
  const filters: string[] = [];
  for (const term of terms) {
    let grams = [...new Set(toBigramTokens(term).split(' '))];
    if (Array.from(term).length < 3 || grams.length < 2 || grams.length > 8) continue;
    const needed = Math.ceil(grams.length * 0.6);
    grams = available(grams);
    if (grams.length < needed) return false;
    if (needed !== 2) continue;
    const groups: string[] = [];
    for (let i = 0; i < grams.length; i++) {
      for (let j = i + 1; j < grams.length; j++) {
        groups.push(`NEAR("${grams[i]}" "${grams[j]}",${Array.from(term).length * 2})`);
      }
    }
    filters.push(`(${groups.join(' OR ')})`);
  }
  return filters.length ? filters.join(' AND ') : null;
}

// bigramの位置をindexOfで飛び、条件を満たし得る短い窓だけを精査する。
function hasFuzzyCoverage(text: string, term: string): boolean {
  if (text.includes(term)) return true;
  const grams = [...new Set(toBigramTokens(term).split(' '))];
  const needed = Math.ceil(grams.length * 0.6);
  const positions = grams.map(gram => text.indexOf(gram));
  if (positions.filter(position => position >= 0).length < needed) return false;
  while (true) {
    let first = -1;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= 0 && (first < 0 || positions[i] < positions[first])) first = i;
    }
    if (first < 0) return false;
    const start = positions[first], end = start + term.length * 2;
    let covered = 0;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= start && positions[i] + grams[i].length <= end) covered++;
    }
    if (covered >= needed && fuzzyCoverage(text.slice(start, end), term) >= 0.6) return true;
    positions[first] = text.indexOf(grams[first], start + 1);
  }
}

export class FulltextEngine {
  constructor(readonly db: Database) {
    db.exec(`
      PRAGMA temp_store=MEMORY;
      CREATE TABLE IF NOT EXISTS pages(
        id INTEGER PRIMARY KEY, url TEXT UNIQUE NOT NULL,
        title TEXT, site_name TEXT, excerpt TEXT, body TEXT, body_hash TEXT,
        level TEXT NOT NULL DEFAULT 'full', first_seen INTEGER NOT NULL,
        last_visit INTEGER NOT NULL, visit_count INTEGER NOT NULL DEFAULT 1, indexed_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        title, url, body, content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 0'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_vocab USING fts5vocab(pages_fts,'instance');
      CREATE TABLE IF NOT EXISTS exclude_rules(
        id INTEGER PRIMARY KEY, pattern TEXT UNIQUE NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('no_index','url_only'))
      );
      CREATE INDEX IF NOT EXISTS pages_last_visit ON pages(last_visit DESC);
    `);
    if (Number(db.selectValue('PRAGMA user_version')) === 0) {
      this.transaction(() => {
        for (const rule of DEFAULT_RULES) this.exec('INSERT OR IGNORE INTO exclude_rules(pattern,level) VALUES (?,?)', [rule.pattern, rule.level]);
        db.exec('PRAGMA user_version=1');
      });
    }
  }

  private exec(sql: string, bind?: BindingSpec) { this.db.exec({ sql, bind }); }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listRules(): ExcludeRule[] {
    return this.db.selectObjects('SELECT id,pattern,level FROM exclude_rules ORDER BY id') as unknown as ExcludeRule[];
  }

  private compileRules() {
    return this.listRules().map(rule => ({ pattern: compileUrlPattern(rule.pattern), level: rule.level }));
  }

  levelFor(url: string, rules = this.compileRules()): IndexLevel {
    let level: IndexLevel = 'full';
    for (const rule of rules) {
      if (!rule.pattern.test(url)) continue;
      if (rule.level === 'no_index') return 'no_index';
      level = 'url_only';
    }
    return level;
  }

  addRule(pattern: string, level: ExcludeRule['level']) {
    if (!pattern.trim() || pattern.length > 4096 || !['no_index', 'url_only'].includes(level)) {
      return { ok: false, error: '除外ルールが不正です' };
    }
    this.exec('INSERT INTO exclude_rules(pattern,level) VALUES (?,?) ON CONFLICT(pattern) DO UPDATE SET level=excluded.level', [pattern, level]);
    return { ok: true };
  }

  removeRule(id: number) {
    this.exec('DELETE FROM exclude_rules WHERE id=?', [id]);
    return { ok: true };
  }

  pageStatus(rawUrl: string, now = Date.now()) {
    const url = canonicalUrl(rawUrl);
    const level = url ? this.levelFor(url) : 'no_index';
    if (!url || level === 'no_index') return { shouldCapture: false, level };
    const page = this.db.selectObject('SELECT indexed_at,level FROM pages WHERE url=?', [url]);
    if (page) {
      this.exec('UPDATE pages SET last_visit=?,visit_count=visit_count+1 WHERE url=?', [now, url]);
      if (page.level === level && now - Number(page.indexed_at) < REINDEX_AFTER) return { shouldCapture: false, level };
    }
    return { shouldCapture: true, level };
  }

  capture(rawUrl: string, page: CapturedPage, now = Date.now()) {
    const url = canonicalUrl(rawUrl);
    if (!url) return { ok: false };
    let level = this.levelFor(url);
    if (level === 'no_index') return { ok: false };
    if (!page.body) level = 'url_only';
    this.transaction(() => this.writePage(url, page, level, now));
    return { ok: true };
  }

  private writePage(url: string, page: CapturedPage, level: Exclude<IndexLevel, 'no_index'>, now: number) {
    const body = level === 'full' ? page.body.slice(0, MAX_BODY) : '';
    let hash = 2166136261;
    for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
    this.exec(`INSERT INTO pages(url,title,site_name,excerpt,body,body_hash,level,first_seen,last_visit,indexed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
      title=excluded.title,site_name=excluded.site_name,excerpt=excluded.excerpt,body=excluded.body,
      body_hash=excluded.body_hash,level=excluded.level,last_visit=MAX(pages.last_visit,excluded.last_visit),indexed_at=excluded.indexed_at`,
    [url, page.title, page.siteName ?? '', level === 'full' ? page.excerpt ?? '' : '', body, (hash >>> 0).toString(16), level, now, now, now]);
    const id = Number(this.db.selectValue('SELECT id FROM pages WHERE url=?', [url]));
    this.exec('DELETE FROM pages_fts WHERE rowid=?', [id]);
    this.exec('INSERT INTO pages_fts(rowid,title,url,body) VALUES (?,?,?,?)',
      [id, toIndexTokens(normalize(page.title)), toIndexTokens(normalize(url)), toIndexTokens(normalize(body))]);
  }

  search(query: string, requestedLimit: number, now = Date.now(), fuzzy = true) {
    const started = performance.now();
    const parsed = parseQuery(query);
    const limit = Math.max(0, Math.min(200, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 20)));
    const finish = (hits: FulltextHit[]) => ({ hits, terms: parsed.terms, tookMs: performance.now() - started });
    if (!query.trim() || !parsed.normTerms.length || !limit) return finish([]);
    const match = buildFtsMatch(parsed);
    if (!match) return finish([]);
    const singleCharacter = parsed.normTerms.length === 1 && Array.from(parsed.normTerms[0]).length === 1;
    const candidates = (fts: string, count = 200) => {
      // まずFTSだけで上位200件を選び、本文テーブルの参照を絞る。
      const ranking = count === 30 ? 'bm25(pages_fts,4.0,2.0,1.0)' : 'rank';
      const bodyColumn = count === 30 ? ',substr(p.body,1,20000) AS body' : '';
      const rows = this.db.selectObjects(`SELECT p.id,p.url,p.title,p.site_name,p.last_visit,p.visit_count,f.score AS rank${bodyColumn}
        FROM (SELECT rowid,${ranking} AS score FROM pages_fts WHERE pages_fts MATCH ?
          AND rank MATCH 'bm25(4.0,2.0,1.0)' ORDER BY ${ranking} LIMIT ?) f
        JOIN pages p ON p.id=f.rowid ORDER BY f.score`, [fts, count]) as unknown as PageRow[];
      // bm25 のスケールを保ち、直近の閲覧を最大15%加点する。
      const score = (row: PageRow) => row.rank * (1 + 0.15 / (1 + Math.max(0, now - row.last_visit) / 86400000));
      return rows.sort((a, b) => score(a) - score(b) || b.last_visit - a.last_visit);
    };
    // 1文字は順位計算をせず、最近の最大200ページだけを調べる。
    const exact: PageRow[] = [];
    if (singleCharacter) {
      const recent = this.db.selectObjects(`SELECT id,url,title,site_name,last_visit,visit_count FROM pages
        ORDER BY last_visit DESC LIMIT 200`) as unknown as PageRow[];
      for (const row of recent) {
        row.body = String(this.db.selectValue('SELECT body FROM pages WHERE id=?', [row.id]) ?? '');
        const fields = [normalize(row.title), normalize(row.url), normalize(row.body)];
        if (!fields.some(text => text.includes(parsed.normTerms[0]))
          || parsed.excludes.some(term => fields.some(text => text.includes(term)))) continue;
        exact.push(row);
        if (exact.length >= limit) break;
      }
    } else exact.push(...candidates(match));
    const selected = exact.slice(0, limit).map(row => ({ row, fuzzy: false }));
    let fuzzyMatch = fuzzy && exact.length < 5 ? buildFuzzyFtsMatch(parsed) : null;
    if (fuzzyMatch) {
      const near = fuzzyNearFilter(parsed.normTerms, grams => grams.filter(gram =>
        this.db.selectValue('SELECT term FROM pages_vocab WHERE term=? LIMIT 1', [gram]) !== undefined,
      ));
      if (near === false) fuzzyMatch = null;
      else if (near) fuzzyMatch = `(${fuzzyMatch}) AND (${near})`;
    }
    if (fuzzyMatch && selected.length < limit) {
      const ids = new Set(exact.map(row => row.id));
      const bodyMatches = new Map<string, { matches: boolean[]; excluded: boolean }>();
      for (const row of candidates(fuzzyMatch, 30)) {
        if (ids.has(row.id)) continue;
        const body = row.body;
        let checked = bodyMatches.get(body);
        if (checked === undefined) {
          const normBody = normalize(body);
          checked = {
            matches: parsed.normTerms.map(term => term.length >= 3 ? hasFuzzyCoverage(normBody, term) : normBody.includes(term)),
            excluded: parsed.excludes.some(term => normBody.includes(term)),
          };
          bodyMatches.set(body, checked);
        }
        const metadata = normalize(`${row.title}\n${row.url}`);
        if (!parsed.normTerms.every((term, i) => checked.matches[i] || metadata.includes(term))) continue;
        if (checked.excluded || parsed.excludes.some(term => metadata.includes(term))) continue;
        selected.push({ row: { ...row, body }, fuzzy: true });
        if (selected.length >= limit) break;
      }
    }
    return finish(selected.map(({ row, fuzzy }) => {
      const body = row.body ?? String(this.db.selectValue('SELECT body FROM pages WHERE id=?', [row.id]) ?? '');
      return {
        id: row.id, url: row.url, title: row.title, siteName: row.site_name || undefined,
        lastVisit: row.last_visit, visitCount: row.visit_count, fuzzy,
        snippet: (singleCharacter ? makeSnippet(body.slice(0, 2000), parsed.normTerms) : null)
          ?? makeSnippet(body, parsed.normTerms, { fuzzy }),
      };
    }));
  }

  getPage(id: number) {
    return this.db.selectObject('SELECT url,title,body,last_visit AS lastVisit FROM pages WHERE id=?', [id]) ?? null;
  }

  deletePages(pattern: string) {
    return this.transaction(() => {
      const bind = [sqlUrlPattern(pattern)];
      this.exec("DELETE FROM pages_fts WHERE rowid IN (SELECT id FROM pages WHERE url LIKE ? ESCAPE '\\')", bind);
      this.exec("DELETE FROM pages WHERE url LIKE ? ESCAPE '\\'", bind);
      return { deleted: Number(this.db.changes()) };
    });
  }

  stats(): FulltextStats {
    const row = this.db.selectObject("SELECT COUNT(*) AS pages,COALESCE(SUM(level='full'),0) AS fullPages,MIN(first_seen) AS oldest,MAX(last_visit) AS newest FROM pages")!;
    return {
      pages: Number(row.pages), fullPages: Number(row.fullPages),
      oldest: row.oldest === null ? null : Number(row.oldest), newest: row.newest === null ? null : Number(row.newest),
      dbBytes: Number(this.db.selectValue('PRAGMA page_count')) * Number(this.db.selectValue('PRAGMA page_size')),
    };
  }

  importRows(rows: unknown[][]) {
    const rules = this.compileRules();
    return this.transaction(() => {
      let imported = 0, skipped = 0;
      for (const row of rows) {
        const url = typeof row[2] === 'string' ? canonicalUrl(row[2]) : null;
        if (!url) { skipped++; continue; }
        const level = this.levelFor(url, rules);
        if (level === 'no_index') { skipped++; continue; }
        const timestamp = importTimestamp(row[8]) ?? importTimestamp(row[9]) ?? importTimestamp(row[12]) ?? Date.now();
        if (this.db.selectValue('SELECT id FROM pages WHERE url=?', [url]) !== undefined) {
          this.exec('UPDATE pages SET last_visit=MAX(last_visit,?) WHERE url=?', [timestamp, url]);
          skipped++;
          continue;
        }
        this.writePage(url, {
          title: String(row[1] ?? ''), excerpt: String(row[3] ?? ''),
          body: level === 'full' ? stripMarkdown(String(row[4] ?? '')).slice(0, MAX_BODY) : '',
          siteName: String(row[7] ?? ''),
        }, level, timestamp);
        imported++;
      }
      return { imported, skipped };
    });
  }
}

function importTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string' && value) {
    if (/^\d+(\.\d+)?$/.test(value)) return importTimestamp(Number(value));
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return null;
}
