import { useState } from 'react';

interface Props {
  url: string;
  size?: number;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function getInitial(url: string, title?: string): string {
  if (title) return title.charAt(0).toUpperCase();
  const domain = getDomain(url);
  return domain.charAt(0).toUpperCase() || '?';
}

export function FaviconImg({ url, size = 16 }: Props) {
  const [error, setError] = useState(false);
  const domain = getDomain(url);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size * 2}`;

  if (error || !domain) {
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
        {getInitial(url)}
      </span>
    );
  }

  return (
    <img
      src={faviconUrl}
      width={size}
      height={size}
      style={{ borderRadius: 2, flexShrink: 0 }}
      onError={() => setError(true)}
      alt=""
    />
  );
}
