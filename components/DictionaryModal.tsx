import type { DictionaryEntry, Dictionary } from '@/types';

interface Props {
  entry: DictionaryEntry;
  dictionary: Dictionary;
  onClose: () => void;
}

export function DictionaryModal({ entry, dictionary, onClose }: Props) {
  const color = dictionary.themeColor || '#7c3aed';

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6 text-gray-100"
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
              <span className="text-xs text-gray-400">{dictionary.name}</span>
            </div>
            <h2 className="text-xl font-bold mt-1">{entry.term}</h2>
            {entry.reading && (
              <p className="text-sm text-gray-400">({entry.reading})</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none ml-4"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* description */}
        {entry.description && (
          <p className="text-sm leading-relaxed text-gray-200 whitespace-pre-wrap">
            {entry.description}
          </p>
        )}

        {/* tags */}
        {entry.tags && entry.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.tags.map(tag => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* close hint */}
        <p className="mt-4 text-xs text-gray-500 text-right">Esc or click outside to close</p>
      </div>
    </div>
  );
}
