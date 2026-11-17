import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FulltextHit } from '@/lib/fulltext/protocol';
import { ftRequest } from '@/lib/fulltext/client';
import { formatDate, formatRelativeTime } from './relativeTime';

type Target = 'current' | 'tab' | 'window';

interface Props {
  hit: FulltextHit;
  highlightTerms: string[];
  onOpen: (target: Target) => void;
  onClose: () => void;
}

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; title: string; body: string; lastVisit: number }
  | { status: 'missing' }
  | { status: 'error'; message: string };

// 長文で1文字語などが大量に当たっても DOM が膨らみすぎないよう、強調は先頭からこの件数まで
const MAX_MARKS = 1000;

export function FulltextPreviewModal({ hit, highlightTerms, onOpen, onClose }: Props) {
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    ftRequest({ action: 'FT_GET_PAGE', id: hit.id })
      .then(res => {
        if (cancelled) return;
        setPage(res ? { status: 'ready', ...res } : { status: 'missing' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPage({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [hit.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !e.altKey) {
        e.stopPropagation();
        e.preventDefault();
        onOpen(e.ctrlKey || e.metaKey ? 'tab' : e.shiftKey ? 'window' : 'current');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose, onOpen]);

  const body = page.status === 'ready' ? page.body : '';
  const { nodes, count } = useMemo(() => highlight(body, highlightTerms), [body, highlightTerms]);

  // 本文が出たら最初の一致箇所を中央付近へ。矢印キー・PageDown で読めるようフォーカスも移す
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || page.status !== 'ready') return;
    const mark = el.querySelector('mark');
    if (mark) {
      el.scrollTop = Math.max(0, mark.offsetTop - el.clientHeight / 3);
    }
    el.focus({ preventScroll: true });
  }, [page.status, nodes]);

  const title = page.status === 'ready' ? page.title || page.url : hit.title || hit.url;
  const url = page.status === 'ready' ? page.url : hit.url;
  const lastVisit = page.status === 'ready' ? page.lastVisit : hit.lastVisit;
  const secondary = 'var(--os-text-secondary)';

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col"
        style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text)', border: '1px solid var(--os-border)', maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs" style={{ color: secondary }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--os-fulltext)' }} />
              <span>保存版</span>
              <span>·</span>
              <span title={formatDate(lastVisit)}>最終閲覧 {formatRelativeTime(lastVisit)}（{formatDate(lastVisit)}）</span>
            </div>
            <h2 className="text-lg font-bold mt-1 leading-snug" style={{ color: 'var(--os-text)' }}>{title}</h2>
            <p className="text-xs truncate mt-0.5" style={{ color: secondary }}>{url}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none ml-4"
            style={{ color: secondary, background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* body */}
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto px-6 py-4 text-sm leading-relaxed whitespace-pre-wrap break-words outline-none"
          style={{ borderTop: '1px solid var(--os-border)', borderBottom: '1px solid var(--os-border)', minHeight: '8rem' }}
        >
          {page.status === 'loading' && <p style={{ color: secondary }}>読み込み中...</p>}
          {page.status === 'missing' && <p style={{ color: secondary }}>このページの保存データが見つかりません。</p>}
          {page.status === 'error' && <p style={{ color: secondary }}>保存データを読み込めませんでした：{page.message}</p>}
          {page.status === 'ready' && (body
            ? nodes
            : <p style={{ color: secondary }}>本文は保存されていません（URLとタイトルのみ）。</p>)}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-6 py-3 text-xs" style={{ color: secondary }}>
          <span>
            {page.status === 'ready' && body && (count > 0 ? `一致 ${count >= MAX_MARKS ? `${MAX_MARKS}+` : count} 件` : '本文中の一致なし')}
            <span className="ml-3"><kbd>Esc</kbd> 閉じる</span>
          </span>
          <button
            onClick={() => onOpen('current')}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: 'var(--os-selected)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
          >
            ページを開く
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 大文字小文字を無視した単純な部分一致で強調する（正規化をまたぐ一致は扱わない）
function highlight(text: string, terms: string[]): { nodes: ReactNode[]; count: number } {
  const words = [...new Set(terms.map(t => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!text || words.length === 0) return { nodes: text ? [text] : [], count: 0 };

  const re = new RegExp(words.map(escapeRegExp).join('|'), 'gi');
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;
  for (const m of text.matchAll(re)) {
    if (count >= MAX_MARKS) break;
    const start = m.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <mark
        key={start}
        style={{ backgroundColor: 'var(--os-mark-bg)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}
      >
        {m[0]}
      </mark>
    );
    last = start + m[0].length;
    count++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, count };
}
