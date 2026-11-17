// 「3日前」のような相対時刻表記
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'たった今';
  if (diff < hour) return `${Math.floor(diff / min)}分前`;
  if (diff < day) return `${Math.floor(diff / hour)}時間前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}日前`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}か月前`;
  return `${Math.floor(diff / (365 * day))}年前`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
