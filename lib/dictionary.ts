import Fuse from 'fuse.js';
import type { Dictionary, DictionaryEntry, ColumnMapping } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, (entity) => {
    const map: Record<string, string> = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ',
    };
    return map[entity] ?? entity;
  });
}

export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  const lines = csvText.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === '') continue;
    // simple CSV parse (handles quoted fields)
    const cells: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    rows.push(cells);
  }
  return rows;
}

export function csvToEntries(rows: string[][], mapping: ColumnMapping): DictionaryEntry[] {
  return rows.map(row => ({
    id: uuidv4(),
    term: row[mapping.termColumn]?.trim() ?? '',
    reading: mapping.readingColumn !== undefined ? row[mapping.readingColumn]?.trim() : undefined,
    description: mapping.descriptionColumn !== undefined
      ? stripHtmlTags(row[mapping.descriptionColumn]?.trim() ?? '')
      : undefined,
    tags: mapping.tagColumn !== undefined
      ? row[mapping.tagColumn]?.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
      : undefined,
  })).filter(e => e.term !== '');
}

export function detectFormatChange(oldRows: string[][], newRows: string[][]): boolean {
  if (oldRows.length === 0 || newRows.length === 0) return false;
  const oldCols = oldRows[0].length;
  const newCols = newRows[0].length;
  return oldCols !== newCols;
}

export function searchDictionary(dict: Dictionary, query: string): DictionaryEntry[] {
  if (!query.trim()) return [];
  const fuse = new Fuse(dict.entries, {
    keys: ['term', 'reading', 'description', 'tags'],
    threshold: 0.4,
    includeScore: true,
  });
  return fuse.search(query).map(r => r.item);
}

export function createDictionary(
  name: string,
  themeColor: string,
  csvText: string,
  mapping: ColumnMapping,
): Dictionary {
  const rows = parseCsv(csvText);
  const entries = csvToEntries(rows, mapping);
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name,
    themeColor,
    format: mapping,
    entries,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDictionary(
  existing: Dictionary,
  csvText: string,
): { updated: Dictionary } | { error: string } {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { error: 'CSVが空です' };

  const mapping = existing.format;
  const usedCols = [
    mapping.termColumn,
    mapping.readingColumn ?? -1,
    mapping.descriptionColumn ?? -1,
    mapping.tagColumn ?? -1,
  ].filter(c => c >= 0);
  const maxCol = Math.max(...usedCols);
  const actualCols = rows[0].length;

  if (actualCols <= maxCol) {
    return {
      error: `形式が一致しません（必要列数: ${maxCol + 1}、実際: ${actualCols}）。この辞書の形式で再インポートしてください。`,
    };
  }

  const entries = csvToEntries(rows, mapping);
  return {
    updated: {
      ...existing,
      entries,
      updatedAt: new Date().toISOString(),
    },
  };
}
