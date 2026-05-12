import { useEffect, useRef } from 'react';
import type { SearchResult, SiteConfig } from '@/types';
import { buildUrl } from '@/lib/sites';

interface Props {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
}

export function ResultList({ results, selectedIndex, onSelect, onHover }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (results.length === 0) return null;

  return (
    <div ref={listRef} className="mt-1 max-h-80 overflow-y-auto">
      {results.map((result, i) => (
        <ResultItem
          key={resultKey(result, i)}
          result={result}
          selected={i === selectedIndex}
          onSelect={() => onSelect(result)}
          onHover={() => onHover(i)}
        />
      ))}
    </div>
  );
}

function resultKey(result: SearchResult, i: number): string {
  if (result.type === 'site') return `site-${result.site.id}-${i}`;
  if (result.type === 'history') return `hist-${result.entry.id}`;
  return `dict-${result.entry.id}`;
}

interface ItemProps {
  result: SearchResult;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function ResultItem({ result, selected, onSelect, onHover }: ItemProps) {
  const base = 'px-3 py-2 cursor-pointer flex items-center gap-2 rounded text-sm';
  const cls = selected
    ? `${base} bg-violet-600 text-white`
    : `${base} hover:bg-white/10 text-gray-200`;

  if (result.type === 'site') {
    return (
      <div className={cls} onClick={onSelect} onMouseEnter={onHover}>
        <SiteIcon site={result.site} />
        <div className="flex-1 min-w-0">
          <span className="font-medium">{result.site.name}</span>
          {result.query && (
            <span className="ml-2 opacity-70">"{result.query}"</span>
          )}
        </div>
        <span className="text-xs opacity-50">Enter</span>
      </div>
    );
  }

  if (result.type === 'history') {
    return (
      <div className={cls} onClick={onSelect} onMouseEnter={onHover}>
        <span className="text-base">🕐</span>
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{result.entry.title || result.entry.url}</div>
          <div className="truncate text-xs opacity-60">{result.entry.url}</div>
        </div>
      </div>
    );
  }

  if (result.type === 'dictionary') {
    const color = result.dictionary.themeColor || '#7c3aed';
    return (
      <div className={cls} onClick={onSelect} onMouseEnter={onHover}>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <span className="font-medium">{result.entry.term}</span>
          {result.entry.reading && (
            <span className="ml-1 text-xs opacity-60">({result.entry.reading})</span>
          )}
          {result.entry.description && (
            <div className="truncate text-xs opacity-60">{result.entry.description}</div>
          )}
        </div>
        <span className="text-xs opacity-50">Enter</span>
      </div>
    );
  }

  return null;
}

function SiteIcon({ site }: { site: SiteConfig }) {
  if (site.icon) {
    return <img src={site.icon} className="w-4 h-4 rounded" alt="" />;
  }
  const initial = site.name.charAt(0).toUpperCase();
  return (
    <span
      className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: site.color || '#7c3aed' }}
    >
      {initial}
    </span>
  );
}
