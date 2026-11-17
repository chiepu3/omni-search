import { normalize, toBigramTokens } from './normalize';

export interface ParsedQuery {
  terms: string[];
  normTerms: string[];
  excludes: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], normTerms: [], excludes: [] };
  for (const raw of q.split(/[\s\u3000]+/u)) {
    const excluded = raw.startsWith('-');
    const norm = normalize(excluded ? raw.slice(1) : raw);
    if (!norm) continue;
    if (excluded) parsed.excludes.push(norm);
    else {
      parsed.terms.push(raw);
      parsed.normTerms.push(norm);
    }
  }
  return parsed;
}

function quote(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function phrase(term: string): string {
  return quote(toBigramTokens(term)) + (Array.from(term).length === 1 ? '*' : '');
}

export function buildFtsMatch(p: ParsedQuery): string | null {
  if (!p.normTerms.length) return null;
  const positive = p.normTerms.map(phrase).join(' AND ');
  return positive + p.excludes.map(term => ` NOT ${phrase(term)}`).join('');
}

export function buildFuzzyFtsMatch(p: ParsedQuery): string | null {
  const tokens = new Set<string>();
  for (const term of p.normTerms) {
    if (Array.from(term).length < 3) continue;
    for (const token of toBigramTokens(term).split(' ')) tokens.add(token);
  }
  if (!tokens.size) return null;
  const positive = `(${Array.from(tokens, quote).join(' OR ')})`;
  return positive + p.excludes.map(term => ` NOT ${phrase(term)}`).join('');
}

export interface FuzzyWindow {
  start: number;
  end: number;
  coverage: number;
}

// 本文を一度走査し、語の長さの2倍の窓内で異なる bigram を数える。
export function findFuzzyWindow(normText: string, normTerm: string): FuzzyWindow | null {
  const term = Array.from(normTerm);
  if (!term.length) return null;
  if (term.length === 1) {
    const start = normText.indexOf(normTerm);
    return start < 0 ? null : { start, end: start + normTerm.length, coverage: 1 };
  }
  const ids = new Map<string, number>();
  for (let i = 0; i < term.length - 1; i++) {
    const token = term[i] + term[i + 1];
    if (!ids.has(token)) ids.set(token, ids.size);
  }
  const counts = new Int32Array(ids.size);
  const positions: number[] = [];
  const offsets: number[] = [];
  const hitIds: number[] = [];
  let left = 0;
  let distinct = 0;
  let best: FuzzyWindow | null = null;
  let previous = '';
  let previousOffset = 0;
  let point = 0;
  let offset = 0;
  for (const ch of normText) {
    const id = ids.get(previous + ch);
    if (previous && id !== undefined) {
      positions.push(point - 1);
      offsets.push(previousOffset);
      hitIds.push(id);
      if (counts[id]++ === 0) distinct++;
      while (point + 1 - positions[left] > term.length * 2) {
        if (--counts[hitIds[left++]] === 0) distinct--;
      }
      const start = offsets[left];
      const end = offset + ch.length;
      const coverage = distinct / ids.size;
      if (!best || coverage > best.coverage
        || (coverage === best.coverage && end - start < best.end - best.start)) {
        best = { start, end, coverage };
      }
    }
    previous = ch;
    previousOffset = offset;
    offset += ch.length;
    point++;
  }
  return best;
}

export function fuzzyCoverage(normText: string, normTerm: string): number {
  return findFuzzyWindow(normText, normTerm)?.coverage ?? 0;
}
