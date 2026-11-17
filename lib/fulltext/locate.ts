import type { SnippetPart } from './protocol';
import { normalizeWithMap } from './normalize';
import { findFuzzyWindow } from './query';

interface Match { start: number; end: number }

function findNormalizedMatch(norm: string, terms: string[], fuzzy: boolean): Match | null {
  terms = [...new Set(terms.filter(Boolean))];
  if (!terms.length) return null;
  if (fuzzy) {
    let best: ReturnType<typeof findFuzzyWindow> = null;
    for (const term of terms) {
      const found = findFuzzyWindow(norm, term);
      if (found && (!best || found.coverage > best.coverage
        || (found.coverage === best.coverage && found.start < best.start))) best = found;
    }
    return best && { start: best.start, end: best.end };
  }

  const positions = terms.map(term => norm.indexOf(term));
  if (positions.some(pos => pos < 0)) {
    let first: Match | null = null;
    positions.forEach((pos, i) => {
      if (pos >= 0 && (!first || pos < first.start)) first = { start: pos, end: pos + terms[i].length };
    });
    return first;
  }
  let best: Match | null = null;
  let bestWidth = Infinity;
  while (true) {
    let first = 0;
    let end = 0;
    for (let i = 0; i < terms.length; i++) {
      if (positions[i] < positions[first]) first = i;
      end = Math.max(end, positions[i] + terms[i].length);
    }
    const start = positions[first];
    if (end - start < bestWidth) {
      bestWidth = end - start;
      best = { start, end: start + terms[first].length };
    }
    positions[first] = norm.indexOf(terms[first], start + 1);
    if (positions[first] < 0) break;
  }
  return best;
}

function sourceMatch(text: string, map: Int32Array, match: Match): Match {
  const start = map[match.start];
  const last = map[match.end - 1];
  let end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
  // 結合濁点や異体字セレクタも元の文字と一緒に選択する。
  while (end < text.length) {
    const ch = String.fromCodePoint(text.codePointAt(end)!);
    if (!/[\p{M}\uFF9E\uFF9F]/u.test(ch)) {
      if (!/[\u1100-\u11ff\u3130-\u318f\uffa0-\uffdc]/u.test(ch)) break;
      const before = text.slice(last, end).normalize('NFKC');
      const next = ch.normalize('NFKC');
      if ((before + next).normalize('NFKC') === before + next) break;
    }
    end += ch.length;
  }
  if (match.end === map.length - 1) end = Math.max(end, map[match.end]);
  return { start, end };
}

export function findMatch(text: string, normTerms: string[], opts?: { fuzzy?: boolean }): Match | null {
  const { norm, map } = normalizeWithMap(text);
  const match = findNormalizedMatch(norm, normTerms, opts?.fuzzy ?? false);
  return match ? sourceMatch(text, map, match) : null;
}

function safeBoundary(text: string, offset: number, direction: -1 | 1): number {
  if (offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/.test(text[offset])
    && /[\uD800-\uDBFF]/.test(text[offset - 1])) return offset + direction;
  return offset;
}

export function makeSnippet(text: string, normTerms: string[], opts?: { radius?: number; fuzzy?: boolean }): SnippetPart | null {
  const match = findMatch(text, normTerms, opts);
  if (!match) return null;
  const radius = Math.max(0, Math.floor(opts?.radius ?? 40));
  const start = safeBoundary(text, Math.max(0, match.start - radius), -1);
  const end = safeBoundary(text, Math.min(text.length, match.end + radius), 1);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, match.start).replace(/\s+/gu, ' '),
    match: text.slice(match.start, match.end),
    after: text.slice(match.end, end).replace(/\s+/gu, ' ') + (end < text.length ? '…' : ''),
  };
}

export function locateInDom(root: Node, normTerms: string[], opts?: { fuzzy?: boolean }): Range | null {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument;
  if (!doc || !normTerms.some(Boolean)) return null;
  const win = doc.defaultView;
  const hidden = new WeakMap<Element, boolean>();
  const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'HEAD']);
  function isHidden(element: Element): boolean {
    const cached = hidden.get(element);
    if (cached !== undefined) return cached;
    let value = excluded.has(element.tagName.toUpperCase()) || element.hasAttribute('hidden');
    if (!value && win) {
      const style = win.getComputedStyle(element);
      value = style.display === 'none' || style.visibility === 'hidden';
    }
    hidden.set(element, value);
    return value;
  }
  for (let element = root.nodeType === 1 ? root as Element : root.parentElement;
    element; element = element.parentElement) {
    if (isHidden(element)) return null;
  }
  const walker = doc.createTreeWalker(root, 1 | 4, {
    acceptNode(node) {
      if (node.nodeType === 1) return isHidden(node as Element) ? 2 : 3;
      return node.nodeValue ? 1 : 2;
    },
  });
  const nodes: Text[] = [];
  const offsets: number[] = [];
  const parts: string[] = [];
  let length = 0;
  function append(node: Text) {
    if (!node.data.length) return;
    nodes.push(node);
    offsets.push(length);
    parts.push(node.data);
    length += node.data.length;
  }
  if (root.nodeType === 3) append(root as Text);
  let node: Node | null;
  while ((node = walker.nextNode())) append(node as Text);
  const match = findMatch(parts.join(''), normTerms, opts);
  if (!match) return null;
  function nodeAt(offset: number): number {
    let low = 0;
    let high = offsets.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid] <= offset) low = mid;
      else high = mid;
    }
    return low;
  }
  const first = nodeAt(match.start);
  const last = nodeAt(match.end - 1);
  const range = doc.createRange();
  range.setStart(nodes[first], match.start - offsets[first]);
  range.setEnd(nodes[last], match.end - offsets[last]);
  return range;
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^\n)]*\)|!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ');
}
