import { useState, useEffect } from 'react';
import { storage } from '@/lib/storage';

interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

interface FlatBookmark {
  id: string;
  title: string;
  url: string;
}

function flattenBookmarks(nodes: BookmarkNode[]): FlatBookmark[] {
  const results: FlatBookmark[] = [];
  for (const node of nodes) {
    if (node.url) results.push({ id: node.id, title: node.title || node.url, url: node.url });
    if (node.children) results.push(...flattenBookmarks(node.children));
  }
  return results;
}

export function BookmarkShortcutsSection() {
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([]);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      chrome.bookmarks.getTree(),
      storage.getBookmarkShortcuts(),
    ]).then(([tree, sc]) => {
      setBookmarks(flattenBookmarks(tree as BookmarkNode[]));
      setShortcuts(sc);
      setLoading(false);
    });
  }, []);

  const setShortcut = async (bookmarkId: string, shortcut: string) => {
    const next = { ...shortcuts };
    if (shortcut.trim()) {
      next[bookmarkId] = shortcut.trim();
    } else {
      delete next[bookmarkId];
    }
    setShortcuts(next);
    await storage.saveBookmarkShortcuts(next);
  };

  const filtered = search.trim()
    ? bookmarks.filter(b => b.title.toLowerCase().includes(search.toLowerCase()) || b.url.toLowerCase().includes(search.toLowerCase()))
    : bookmarks;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
        ブックマークにショートカットキーワードを設定すると、検索窓からすばやくアクセスできます。
      </p>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="ブックマークを検索..."
        style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
      />

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>読み込み中...</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '60vh', overflowY: 'auto' }}>
        {filtered.map(bm => (
          <div key={bm.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', backgroundColor: 'var(--surface)', borderRadius: '6px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bm.title}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bm.url}</div>
            </div>
            <input
              type="text"
              value={shortcuts[bm.id] || ''}
              onChange={e => setShortcut(bm.id, e.target.value)}
              placeholder="ショートカット"
              style={{ width: '100px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
            />
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>
            ブックマークが見つかりません。
          </p>
        )}
      </div>
    </div>
  );
}
