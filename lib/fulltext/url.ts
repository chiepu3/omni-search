// 同じページの追跡パラメータとフラグメントをまとめる。
export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (!/^#(?:\/|!)/.test(url.hash)) url.hash = '';
    // 残すパラメータの表記（foo、%20、+など）は変更しない。
    const parameters = url.search.slice(1).split('&');
    const retained = parameters.filter(parameter => {
      try { return !/^utm_/i.test(decodeURIComponent(parameter.split('=', 1)[0].replace(/\+/g, ' '))); }
      catch { return true; }
    });
    if (retained.length !== parameters.length) url.search = retained.length ? `?${retained.join('&')}` : '';
    return url.href;
  } catch {
    return null;
  }
}

export function matchesUrlPattern(url: string, pattern: string): boolean {
  return compileUrlPattern(pattern).test(url);
}

export function compileUrlPattern(pattern: string): RegExp {
  const source = pattern.split('%').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`, 'i');
}

// SQLite LIKE の「_」はワイルドカードにしない。
export function sqlUrlPattern(pattern: string): string {
  return pattern.replace(/\\/g, '\\\\').replace(/_/g, '\\_');
}
