import { useEffect } from 'react';
import type { DictionaryEntry, Dictionary } from '@/types';

interface Props {
  entry: DictionaryEntry;
  dictionary: Dictionary;
  onClose: () => void;
}

export function DictionaryModal({ entry, dictionary, onClose }: Props) {
  const color = dictionary.themeColor || '#7c3aed';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6"
        style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text)', border: '1px solid var(--os-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs" style={{ color: 'var(--os-text-secondary)' }}>{dictionary.name}</span>
            </div>
            <h2 className="text-xl font-bold mt-1" style={{ color: 'var(--os-text)' }}>{entry.term}</h2>
            {entry.reading && (
              <p className="text-sm" style={{ color: 'var(--os-text-secondary)' }}>({entry.reading})</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none ml-4"
            style={{ color: 'var(--os-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* description */}
        {entry.description && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--os-text)' }}>
            {entry.description}
          </p>
        )}

        {/* tags */}
        {entry.tags && entry.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.tags.map(tag => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--os-border)', color: 'var(--os-text-secondary)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* close hint */}
        <p className="mt-4 text-xs text-right" style={{ color: 'var(--os-text-secondary)' }}>Esc or click outside to close</p>
      </div>
    </div>
  );
}
