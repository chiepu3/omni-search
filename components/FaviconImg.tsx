import { useState, useEffect } from 'react';

// Module-level cache shared across all FaviconImg instances
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function fetchFaviconViaBackground(domain: string): Promise<string | null> {
  if (cache.has(domain)) return Promise.resolve(cache.get(domain) ?? null);
  if (pending.has(domain)) return pending.get(domain)!;

  const p = (chrome.runtime.sendMessage({ action: 'FETCH_FAVICON', domain }) as Promise<string | null>)
    .then(url => { cache.set(domain, url); return url; })
    .catch(() => { cache.set(domain, null); return null; })
    .finally(() => { pending.delete(domain); });

  pending.set(domain, p);
  return p;
}

interface Props {
  url: string;
  size?: number;
}

export function FaviconImg({ url, size = 16 }: Props) {
  const domain = getDomain(url);
  const [src, setSrc] = useState<string | null>(() => cache.get(domain) ?? null);

  useEffect(() => {
    if (!domain) return;
    if (cache.has(domain)) { setSrc(cache.get(domain) ?? null); return; }
    fetchFaviconViaBackground(domain).then(setSrc);
  }, [domain]);

  if (!src) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 3,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.6,
          fontWeight: 700,
          backgroundColor: '#7c3aed',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {domain.charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      style={{ borderRadius: 2, flexShrink: 0 }}
      onError={() => { cache.set(domain, null); setSrc(null); }}
      alt=""
    />
  );
}
