import { useEffect, useRef } from 'react';
import type { SearchResult, SiteConfig } from '@/types';
import { buildUrl } from '@/lib/sites';
import { FaviconImg } from './FaviconImg';
import { displayDomain, formatRelativeTime } from './relativeTime';

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
    <div ref={listRef} className="mt-1 max-h-[min(28rem,60vh)] overflow-y-auto">
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

export function resultKey(result: SearchResult, i: number): string {
  if (result.type === 'site') return `site-${result.site.id}-${i}`;
  if (result.type === 'history') return `hist-${result.entry.id}`;
  if (result.type === 'bookmark') return `bm-${result.entry.id}`;
  if (result.type === 'google') return `google-${i}`;
  if (result.type === 'fulltext') return `ft-${result.hit.id}`;
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
  const itemStyle: React.CSSProperties = selected
    ? { backgroundColor: 'var(--os-selected, #7c3aed)', color: '#ffffff' }
    : { color: 'var(--os-text, #f0f0f5)' };

  const subStyle: React.CSSProperties = {
    color: selected ? 'rgba(255,255,255,0.7)' : 'var(--os-text-secondary, #8888aa)',
  };

  if (result.type === 'site') {
    return (
      <div className={base} style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <SiteIcon site={result.site} />
        <div className="flex-1 min-w-0">
          {result.query ? (
            <span className="font-medium">
              {result.site.name}で&quot;{result.query}&quot;を検索する
            </span>
          ) : (
            <span className="font-medium">{result.site.name} を検索</span>
          )}
        </div>
        <span className="text-xs" style={subStyle}>Enter</span>
      </div>
    );
  }

  if (result.type === 'history') {
    return (
      <div className={base} style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <FaviconImg url={result.entry.url} size={16} />
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{result.entry.title || result.entry.url}</div>
          <div className="truncate text-xs" style={subStyle}>{result.entry.url}</div>
        </div>
      </div>
    );
  }

  if (result.type === 'bookmark') {
    return (
      <div className={base} style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <FaviconImg url={result.entry.url} size={16} />
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{result.entry.title || result.entry.url}</div>
          <div className="truncate text-xs" style={subStyle}>{result.entry.url}</div>
        </div>
        <span className="text-xs" style={subStyle}>★</span>
      </div>
    );
  }

  if (result.type === 'dictionary') {
    const color = result.dictionary.themeColor || '#7c3aed';
    return (
      <div className={base} style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <span className="font-medium">{result.entry.term}</span>
          {result.entry.reading && (
            <span className="ml-1 text-xs" style={subStyle}>({result.entry.reading})</span>
          )}
          {result.entry.description && (
            <div className="truncate text-xs" style={subStyle}>{result.entry.description}</div>
          )}
        </div>
        <span className="text-xs" style={subStyle}>Enter</span>
      </div>
    );
  }

  if (result.type === 'google') {
    return (
      <div className={base} style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-xs font-bold" style={{ color: '#4285f4' }}>G</span>
        <div className="flex-1 min-w-0">
          <span className="font-medium">Googleで&quot;{result.query}&quot;を検索する</span>
        </div>
        <span className="text-xs" style={subStyle}>Enter</span>
      </div>
    );
  }

  if (result.type === 'fulltext') {
    const { hit } = result;
    const snippet = hit.snippet;
    return (
      <div className="px-3 py-2 cursor-pointer flex items-start gap-2 rounded text-sm" style={itemStyle} onClick={onSelect} onMouseEnter={onHover}>
        <span className="mt-0.5 flex-shrink-0 flex"><FaviconImg url={hit.url} size={16} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{hit.title || hit.url}</span>
            {hit.fuzzy && (
              <span
                className="flex-shrink-0 rounded px-1.5 text-[10px] leading-4"
                style={{
                  border: `1px solid ${selected ? 'rgba(255,255,255,0.35)' : 'var(--os-border)'}`,
                  color: subStyle.color,
                }}
              >
                あいまい
              </span>
            )}
          </div>
          {snippet && (
            <div
              className="text-xs leading-relaxed mt-0.5 line-clamp-2 break-all"
              style={{ color: selected ? 'rgba(255,255,255,0.85)' : 'var(--os-text, #f0f0f5)', opacity: selected ? 1 : 0.78 }}
            >
              {oneLine(snippet.before)}
              <mark
                style={{
                  backgroundColor: selected ? 'rgba(255,255,255,0.22)' : 'var(--os-mark-bg, rgba(245,158,11,0.3))',
                  color: 'inherit',
                  borderRadius: 2,
                  padding: '0 1px',
                }}
              >
                {oneLine(snippet.match)}
              </mark>
              {oneLine(snippet.after)}
            </div>
          )}
          <div className="truncate text-[11px] mt-0.5" style={subStyle}>
            {displayDomain(hit.url)} · {formatRelativeTime(hit.lastVisit)}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// スニペット内の改行・連続空白を1つの空白にまとめる
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ');
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
